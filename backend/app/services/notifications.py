"""Bildirim gönderimi. Şablonlar notification_templates tablosundadır (dil bazında).

Gönderim hatası işlemi bozmaz; bildirim 'basarisiz' olarak kaydedilir.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import DomainError
from app.models import Booking, Customer, Driver, Notification, NotificationTemplate
from app.models.enums import NotificationChannel, NotificationStatus
from app.providers.sms import get_sms_sender
from app.services import audit, push_outbox

log = logging.getLogger(__name__)
LOCAL_TZ = ZoneInfo("Europe/Istanbul")


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _template(
    db: Session, code: str, locale: str, channel: NotificationChannel
) -> NotificationTemplate | None:
    for loc in (locale, "en", "tr"):
        tpl = db.scalar(
            select(NotificationTemplate).where(
                NotificationTemplate.code == code,
                NotificationTemplate.locale == loc,
                NotificationTemplate.channel == channel,
            )
        )
        if tpl:
            return tpl
    return None


def render(db: Session, code: str, locale: str, channel: NotificationChannel, params: dict) -> tuple[str | None, str] | None:
    tpl = _template(db, code, locale, channel)
    if tpl is None:
        return None
    subject = tpl.subject.format_map(_SafeDict(params)) if tpl.subject else None
    return subject, tpl.body.format_map(_SafeDict(params))


def booking_params(booking: Booking) -> dict[str, str]:
    leg = booking.legs[0]
    return {
        "booking_code": booking.booking_code,
        "pickup_at": leg.pickup_at.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M"),
        "pickup": leg.pickup_region.name,
        "dropoff": leg.dropoff_region.name,
        "total": f"{booking.total_amount:.2f}",
        "currency": booking.currency.value,
        "booking_url": booking_url(booking),
        "pay_url": booking_url(booking) + "/pay",
    }


def booking_url(booking: Booking) -> str:
    """Müşteri web sitesinde rezervasyon detayı. Açınca telefonla SMS kodu girişi istenir (K-16)."""
    base = get_settings().public_web_url.rstrip("/")
    return f"{base}/{booking.locale}/bookings/{booking.booking_code}"


def _record(db: Session, recipient_type: str, recipient_id, channel, code, ok: bool, error: str | None):
    db.add(
        Notification(
            recipient_type=recipient_type,
            recipient_id=recipient_id,
            channel=channel,
            template_code=code,
            status=NotificationStatus.SENT if ok else NotificationStatus.FAILED,
            error=error,
            sent_at=datetime.now(timezone.utc) if ok else None,
        )
    )


def notify_customer(db: Session, booking: Booking, code: str) -> None:
    customer = booking.customer
    phone = customer.user.phone
    rendered = render(db, code, booking.locale, NotificationChannel.SMS, booking_params(booking))
    if rendered is None or not phone:
        _record(db, "customer", customer.id, NotificationChannel.SMS, code, False, "şablon yok")
        return
    try:
        get_sms_sender().send(phone, rendered[1])
        _record(db, "customer", customer.id, NotificationChannel.SMS, code, True, None)
    except Exception as exc:  # noqa: BLE001 - bildirim hatası işlemi bozmamalı
        log.exception("SMS bildirimi gönderilemedi")
        _record(db, "customer", customer.id, NotificationChannel.SMS, code, False, str(exc)[:255])


def notify_driver(db: Session, driver: Driver, code: str, params: dict, data: dict[str, str]) -> None:
    if not driver.push_token:
        _record(db, "driver", driver.id, NotificationChannel.PUSH, code, False, "push jetonu yok")
        return
    rendered = render(db, code, "tr", NotificationChannel.PUSH, params)
    subject, body = rendered if rendered else ("getawaytransfers", code)
    # Commit sonrası arka planda gönderilir; sonuç ayrı kayıtla yazılır (push_outbox).
    push_outbox.enqueue(db, driver, code, subject or "getawaytransfers", body, data)


# RT-08: FCM kayıt jetonu (Android, ~150+ karakter, [A-Za-z0-9_:-]) ve APNs cihaz jetonu (64 hex) bu kalıba uyar.
# Sütun 255 karakter; boşluk, HTML ve denetim karakterleri reddedilir.
PUSH_TOKEN_RE = re.compile(r"[A-Za-z0-9_:.\-]{32,255}")


def validate_push_token(token: str) -> None:
    if not PUSH_TOKEN_RE.fullmatch(token):
        raise DomainError("cihaz bildirim jetonu geçersiz", code="invalid_push_token")


def bind_push_token(db: Session, owner: Customer | Driver, token: str | None) -> None:
    """Cihaz jetonunu hesaba bağlar. Hesap başına tek cihaz jetonu tutulur (sütun tektir; yeni jeton eskisinin
    yerine geçer). Bir jeton tek hesaba aittir: aynı cihazda önceki hesap (müşteri veya sürücü) çıkış yapmadan
    başkası girdiyse jeton yeni hesaba devredilir, önceki hesabın bildirimleri bu cihaza gitmez (çift teslim
    olmaz). Devir denetim kaydına yazılır (RT-08; jetonun kendisi yazılmaz)."""
    if token:
        validate_push_token(token)
        moved: list[str] = []
        for model in (Customer, Driver):
            cond = [model.push_token == token]
            if model is type(owner):
                cond.append(model.id != owner.id)
            ids = list(db.scalars(
                update(model).where(*cond).values(push_token=None)
                .returning(model.id).execution_options(synchronize_session=False)
            ))
            moved += [f"{model.__tablename__}:{i}" for i in ids]
        if moved:
            audit.record(db, actor_id=owner.user_id, action="push_token.reassigned",
                         entity_type=type(owner).__tablename__, entity_id=owner.id,
                         changes={"previous_owners": moved})
    owner.push_token = token


def release_push_token(db: Session, user_id, token: str) -> None:
    """Çıkışta bu cihazın jetonu hesaptan silinir (başka cihazın jetonuna dokunulmaz)."""
    for model in (Customer, Driver):
        db.execute(
            update(model).where(model.user_id == user_id, model.push_token == token)
            .values(push_token=None).execution_options(synchronize_session=False)
        )
