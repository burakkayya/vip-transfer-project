"""Yolculuk sohbeti (K-50): müşteri ile atanmış sürücü arasında, telefon numarası paylaşmadan.

- Yazışma sürücü atandıktan yolculuk bitene kadar açıktır; sonra yalnızca okunur.
- Metin şifreli saklanır, yolculuktan 30 gün sonra silinir (jobs.purge_trip_messages).
- Her mesaj karşı tarafa uygulama içi bildirim (ve varsa push) üretir.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.errors import Conflict, DomainError, NotFound, TooManyRequests
from app.models import Booking, BookingLeg, TripMessage
from app.models.enums import LegStatus
from app.services import trip_updates

OPEN_STATUSES = (LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED)
MAX_LENGTH = 1000
RATE_WINDOW = timedelta(minutes=10)
RATE_LIMIT = 40
RETENTION = timedelta(days=30)
SENDERS = ("customer", "driver")


def chat_leg(booking: Booking) -> BookingLeg:
    """Müşterinin sohbet ettiği bacak: aktif olan; yoksa sürücüsü olan son bacak."""
    active = next((leg for leg in booking.legs if leg.status in OPEN_STATUSES), None)
    if active is not None:
        return active
    with_driver = [leg for leg in booking.legs if leg.driver_id is not None]
    if not with_driver:
        raise NotFound("sürücü atanınca mesajlaşabilirsiniz", code="chat_unavailable")
    return with_driver[-1]


def is_open(leg: BookingLeg) -> bool:
    return leg.driver_id is not None and leg.status in OPEN_STATUSES


def history(db: Session, leg: BookingLeg, viewer: str, now: datetime) -> tuple[list[TripMessage], int]:
    """Mesajlar (eskiden yeniye) ve bu çağrıdan önce okunmamış olan sayısı. Karşı tarafın mesajları okundu sayılır."""
    other = _other(viewer)
    unread = unread_count(db, leg, viewer)
    if unread:
        db.execute(
            update(TripMessage)
            .where(TripMessage.booking_leg_id == leg.id, TripMessage.sender == other, TripMessage.read_at.is_(None))
            .values(read_at=now)
        )
    rows = list(
        db.scalars(
            select(TripMessage).where(TripMessage.booking_leg_id == leg.id).order_by(TripMessage.created_at).limit(500)
        )
    )
    return rows, unread


def unread_count(db: Session, leg: BookingLeg, viewer: str) -> int:
    return db.scalar(
        select(func.count()).select_from(TripMessage).where(
            TripMessage.booking_leg_id == leg.id,
            TripMessage.sender == _other(viewer),
            TripMessage.read_at.is_(None),
        )
    ) or 0


def send(db: Session, leg: BookingLeg, sender: str, text: str, now: datetime) -> TripMessage:
    body = " ".join(text.split()) if "\n" not in text else text.strip()
    if not body:
        raise DomainError("mesaj boş olamaz", code="message_empty")
    if len(body) > MAX_LENGTH:
        raise DomainError("mesaj çok uzun", code="message_too_long")
    if not is_open(leg):
        raise Conflict("bu yolculuk için mesajlaşma kapandı", code="chat_closed")
    recent = db.scalar(
        select(func.count()).select_from(TripMessage).where(
            TripMessage.booking_leg_id == leg.id,
            TripMessage.sender == sender,
            TripMessage.created_at > now - RATE_WINDOW,
        )
    ) or 0
    if recent >= RATE_LIMIT:
        raise TooManyRequests("çok fazla mesaj gönderildi, biraz bekleyin")
    # Gönderen sürücü mesajla saklanır: iş başka sürücüye devredilse de şikâyet incelemesinde doğru kişi görünür.
    msg = TripMessage(booking_leg_id=leg.id, sender=sender, body=body, created_at=now,
                      driver_id=leg.driver_id if sender == "driver" else None)
    db.add(msg)
    preview = body if len(body) <= 120 else body[:117] + "…"
    if sender == "customer":
        trip_updates.to_driver(db, leg, "new_message", sender=leg.booking.passenger_name.split()[0], text=preview)
    else:
        trip_updates.to_customer(db, leg, "new_message", sender=leg.driver.full_name.split()[0], text=preview)
    db.flush()
    return msg


def _other(viewer: str) -> str:
    if viewer not in SENDERS:
        raise ValueError(viewer)
    return "driver" if viewer == "customer" else "customer"
