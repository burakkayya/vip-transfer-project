"""K-83: olay (incident) kaydı ve bildirimi.

- `report()` hiçbir zaman istisna fırlatmaz; kendi veritabanı oturumunda çalışır (hatanın geri aldığı istek
  işleminden bağımsız kalır).
- Aynı hata (kaynak + tür + kod + kod konumu) tek olayda toplanır; her tekrar `incident_occurrences`'a senaryosuyla
  yazılır. Çözülmüş olay tekrar ederse yeniden açılır.
- Hata ve kritik seviyede yeni / yeniden açılan olay e-postayla bildirilir; aynı olay için en fazla
  `incident_alert_min_interval_minutes`'ta bir. E-posta kişisel veri içermez.
- Ayrıntı ve bağlam maskelenir (anahtar ve desen) ve şifreli tutulur.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from app import request_context
from app.config import get_settings
from app.models import Incident, IncidentOccurrence
from app.providers.email import ConsoleEmail, get_email_sender
from app.services import audit

log = logging.getLogger(__name__)

LEVELS = ("warning", "error", "critical")
SOURCES = frozenset({"backend", "worker", "web", "admin", "mobile_customer", "mobile_driver"})
STATUSES = ("open", "acknowledged", "resolved")
DETAIL_MAX = 4000
TITLE_MAX = 200
_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def frames(exc: BaseException, limit: int = 8) -> str:
    """Hatanın kod konumu (dosya:satır işlev), uygulamanın kendi çerçeveleri önce. İleti ve yerel değişkenler
    yazılmaz: SQL parametresi, ad ya da telefon taşıyabilir (REV-C-8 ile aynı ilke)."""
    tb = traceback.extract_tb(exc.__traceback__)
    own = [f for f in tb if os.path.abspath(f.filename).startswith(_APP_ROOT)][-limit:]
    inner = [f for f in tb[-2:] if f not in own]
    picked = list(reversed(own)) + list(reversed(inner))
    return " <- ".join(f"{os.path.basename(f.filename)}:{f.lineno} {f.name}" for f in picked) or "?"


def _location(exc: BaseException) -> str:
    """Parmak izi için en içteki uygulama çerçevesi (satır numarası olmadan: küçük düzenlemeler olayı bölmesin)."""
    tb = traceback.extract_tb(exc.__traceback__)
    own = [f for f in tb if os.path.abspath(f.filename).startswith(_APP_ROOT)]
    f = (own or tb or [None])[-1]
    return f"{os.path.basename(f.filename)}:{f.name}" if f else "?"


def fingerprint(source: str, kind: str, code: str, location: str = "") -> str:
    return hashlib.sha256(f"{source}|{kind}|{code}|{location}".encode()).hexdigest()


def _context_payload(extra: dict[str, Any] | None) -> dict[str, Any]:
    ctx = request_context.current()
    payload = {
        "request_id": ctx.request_id,
        "method": ctx.method,
        "route": ctx.route,
        "platform": ctx.platform,
        "app": ctx.app,
        "app_version": ctx.app_version,
        "actor_type": ctx.actor_type,
        "actor_id": ctx.actor_id,
    }
    if extra:
        payload.update(extra)
    cleaned = audit.clean({k: v for k, v in payload.items() if v is not None})
    return {k: (audit.scrub_text(v, 500) if isinstance(v, str) else v) for k, v in cleaned.items()}


def report(
    *,
    source: str,
    kind: str,
    code: str,
    title: str,
    level: str = "error",
    detail: str | None = None,
    location: str = "",
    booking_id: uuid.UUID | str | None = None,
    context: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> uuid.UUID | None:
    """Olayı kaydeder ve gerekiyorsa bildirir. Dönüş: olay kimliği (kayıt başarısızsa None)."""
    from app.db import SessionLocal  # döngüsel içe aktarımı önler

    try:
        source = source if source in SOURCES else "backend"
        level = level if level in LEVELS else "error"
        now = now or datetime.now(timezone.utc)
        fp = fingerprint(source, kind, code, location)
        safe_title = audit.scrub_text(title, TITLE_MAX)
        safe_detail = audit.scrub_text(detail, DETAIL_MAX) if detail else None
        payload = _context_payload(context)
        booking_uuid = _as_uuid(booking_id)
        with SessionLocal() as db:
            # İsteğin kendi işlemi kilit tutuyor olabilir; olay kaydı onu beklerken asılı kalmasın.
            db.execute(text("SET LOCAL lock_timeout = '3s'"))
            previous = db.scalar(select(Incident.status).where(Incident.fingerprint == fp))
            stmt = insert(Incident).values(
                id=uuid.uuid4(), fingerprint=fp, level=level, source=source, kind=kind[:40], code=code[:80],
                title=safe_title, detail=safe_detail, status="open",
                occurrence_count=1, first_seen_at=now, last_seen_at=now,
            )
            # Tekrar: sayaç artar, son görülme ve seviye (yükselirse) güncellenir; çözülmüşse yeniden açılır.
            stmt = stmt.on_conflict_do_update(
                index_elements=[Incident.fingerprint],
                set_={
                    "occurrence_count": Incident.occurrence_count + 1,
                    "last_seen_at": now,
                    "title": safe_title,
                    "detail": stmt.excluded.detail,
                    "level": text(
                        "CASE WHEN array_position(ARRAY['warning','error','critical'], excluded.level) > "
                        "array_position(ARRAY['warning','error','critical'], incidents.level) "
                        "THEN excluded.level ELSE incidents.level END"
                    ),
                    "status": text("CASE WHEN incidents.status = 'resolved' THEN 'open' ELSE incidents.status END"),
                },
            ).returning(Incident.id, Incident.occurrence_count, Incident.level, Incident.status)
            incident_id, count, final_level, _status = db.execute(stmt).one()
            db.add(IncidentOccurrence(
                incident_id=incident_id, occurred_at=now, request_id=payload.get("request_id"),
                booking_id=booking_uuid, context=json.dumps(payload, ensure_ascii=False, default=str),
            ))
            # Yeni ya da yeniden açılan olay her zaman, tekrar eden açık olay aralıkla bildirilir.
            should_notify = final_level in ("error", "critical") and _claim_notification(
                db, incident_id, now, force=previous in (None, "resolved"))
            db.commit()
        # Bilgi seviyesinde: kaynağı hatayı zaten kendi seviyesinde logladı; log alarm kuralları iki kez saymasın.
        log.info("olay [%s/%s] %s (tekrar %d, %s) id=%s", source, code, safe_title, count, final_level,
                 incident_id)
        if should_notify:
            _notify(incident_id, final_level, source, safe_title, count)
        return incident_id
    except Exception as exc:  # noqa: BLE001 - olay kaydı asıl hatayı gölgelememeli
        log.error("olay kaydedilemedi (%s): %s %s", type(exc).__name__, source, code)
        return None


def report_exception(exc: BaseException, *, source: str = "backend", kind: str = "exception",
                     level: str = "error", booking_id: Any = None, context: dict[str, Any] | None = None,
                     title: str | None = None, code: str | None = None) -> uuid.UUID | None:
    name = type(exc).__name__
    loc = _location(exc)
    return report(
        source=source, kind=kind, code=code or name, location=loc, level=level, booking_id=booking_id, context=context,
        title=title or f"{name} ({loc})", detail=frames(exc),
    )


def alarm(code: str, title: str, *, level: str = "error", kind: str = "security", booking_id: Any = None,
          context: dict[str, Any] | None = None) -> uuid.UUID | None:
    """Mevcut "GÜVENLİK ALARMI" log satırlarının olay karşılığı: hem loglanır hem olay olarak kaydedilir."""
    return report(source="backend", kind=kind, code=code, title=title, level=level, booking_id=booking_id,
                  context=context)


def _as_uuid(value: Any) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _claim_notification(db, incident_id: uuid.UUID, now: datetime, *, force: bool) -> bool:
    """Bildirim hakkını atomik alır: son bildirim aralıktan eskiyse (ya da hiç yoksa) zamanı yazar."""
    stmt = update(Incident).where(Incident.id == incident_id)
    if not force:
        interval = timedelta(minutes=get_settings().incident_alert_min_interval_minutes)
        stmt = stmt.where(Incident.last_notified_at.is_(None) | (Incident.last_notified_at <= now - interval))
    return db.execute(stmt.values(last_notified_at=now)).rowcount == 1


def _notify(incident_id: uuid.UUID, level: str, source: str, title: str, count: int) -> None:
    s = get_settings()
    if not s.incident_alert_emails:
        return
    subject = f"[Getaway {level.upper()}] {title}"[:200]
    body = (
        f"Yeni ya da tekrarlayan olay.\n\nSeviye: {level}\nKaynak: {source}\nTekrar: {count}\n\n"
        f"Ayrıntı ve senaryo: {s.public_admin_url.rstrip('/')}/incidents/{incident_id}\n\n"
        "Bu e-posta kişisel veri içermez; ayrıntı yalnızca admin panelinde, yetkili personele görünür."
    )
    sender = get_email_sender()

    def send() -> None:
        try:
            sender.send(s.incident_alert_emails, subject, body)
        except Exception as exc:  # noqa: BLE001
            log.error("olay bildirimi gönderilemedi (%s) id=%s", type(exc).__name__, incident_id)

    if isinstance(sender, ConsoleEmail):
        send()
    else:  # SMTP yanıtı geciktirmesin
        threading.Thread(target=send, name="incident-email", daemon=True).start()


def open_count(db) -> int:
    from sqlalchemy import func

    return db.scalar(select(func.count()).select_from(Incident).where(Incident.status != "resolved")) or 0
