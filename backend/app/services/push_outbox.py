"""Push gönderim kuyruğu (K-56).

Push, veritabanı işlemi içinde **gönderilmez**: `enqueue` gönderimi oturuma not eder, işlem commit edilince
arka plan iş parçacığında FCM'e gider; işlem geri alınırsa hiç gitmez. Böylece
- satır kilitleri (ödeme dönüşü, teklif kabulü) FCM'in yanıt süresi boyunca açık kalmaz,
- veritabanında olmayan bir olayın bildirimi gitmez.

Gönderim sonucu (`notifications` kaydı) ve geçersiz jetonun silinmesi ayrı bir oturumda yazılır.
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import event, update
from sqlalchemy.orm import Session

from app.models import Customer, Driver, Notification
from app.models.enums import NotificationChannel, NotificationStatus
from app.providers.push import PushTokenInvalid, get_push_sender

log = logging.getLogger(__name__)

_KEY = "pending_push"
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")
_futures: set[Future] = set()


@dataclass(frozen=True)
class PushJob:
    recipient_type: str  # customer | driver
    recipient_id: uuid.UUID
    token: str
    code: str
    title: str
    body: str
    data: dict[str, str]


def enqueue(db: Session, owner: Customer | Driver, code: str, title: str, body: str, data: dict[str, str]) -> None:
    """Sahibin jetonu varsa gönderimi commit sonrasına not eder. Jeton yoksa hiçbir şey yapmaz."""
    if not owner.push_token:
        return
    kind = "driver" if isinstance(owner, Driver) else "customer"
    db.info.setdefault(_KEY, []).append(
        PushJob(kind, owner.id, owner.push_token, code, title, body, {k: str(v) for k, v in data.items()})
    )


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    jobs: list[PushJob] = session.info.pop(_KEY, [])
    for job in jobs:
        fut = _executor.submit(_deliver, job)
        _futures.add(fut)
        fut.add_done_callback(_futures.discard)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(_KEY, None)


def drain(timeout: float = 10) -> None:
    """Bekleyen gönderimlerin bitmesini bekler (testler ve kapanış için)."""
    wait(list(_futures), timeout=timeout)


def _deliver(job: PushJob) -> None:
    from app.db import SessionLocal  # döngüsel içe aktarmayı önler

    ok, error, invalid = True, None, False
    try:
        get_push_sender().send(job.token, job.title, job.body, job.data)
    except PushTokenInvalid as exc:
        ok, error, invalid = False, str(exc)[:255], True
    except Exception as exc:  # noqa: BLE001 - bildirim hatası hiçbir işlemi bozmamalı
        log.exception("push bildirimi gönderilemedi")
        ok, error = False, str(exc)[:255]
    try:
        with SessionLocal() as db:
            db.add(Notification(
                recipient_type=job.recipient_type, recipient_id=job.recipient_id, channel=NotificationChannel.PUSH,
                template_code=job.code, status=NotificationStatus.SENT if ok else NotificationStatus.FAILED,
                error=error, sent_at=datetime.now(timezone.utc) if ok else None,
            ))
            if invalid:
                model = Driver if job.recipient_type == "driver" else Customer
                # Yalnız hâlâ aynı jeton kayıtlıysa silinir (bu arada yenisi kaydedildiyse dokunulmaz).
                db.execute(update(model).where(model.id == job.recipient_id, model.push_token == job.token)
                           .values(push_token=None))
            db.commit()
    except Exception:  # noqa: BLE001
        log.exception("push sonucu kaydedilemedi")
