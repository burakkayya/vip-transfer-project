"""Yolculuk sohbeti (K-50): müşteri ile atanmış sürücü arasında, telefon numarası paylaşmadan.

- Yazışma sürücü atandıktan yolculuk bitene kadar açıktır; sonra yalnızca okunur.
- Metin şifreli saklanır, yolculuktan 30 gün sonra silinir (jobs.purge_trip_messages).
- Her mesaj karşı tarafa uygulama içi bildirim (ve varsa push) üretir.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, NotFound, ServiceUnavailable, TooManyRequests
from app.models import Booking, BookingLeg, TripMessage
from app.models.enums import LegStatus
from app.providers.translation import get_translator
from app.services import api_cache, trip_updates

log = logging.getLogger(__name__)

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
    # K-62: alıcının diline çeviri (sürücü tr, müşteri rezervasyon dili). Sürücü müşterinin dilini
    # konuşuyorsa ya da rezervasyon Türkçeyse çağrı yapılmaz.
    target = "tr" if sender == "customer" else leg.booking.locale
    driver_langs = leg.driver.language_list if leg.driver is not None else ["tr"]
    if leg.booking.locale != "tr" and leg.booking.locale not in driver_langs:
        translated = translate(body, target)
        if translated:
            msg.translated_body, msg.translated_lang = translated, target
    db.add(msg)
    shown = msg.translated_body or body
    preview = shown if len(shown) <= 120 else shown[:117] + "…"
    if sender == "customer":
        trip_updates.to_driver(db, leg, "new_message", sender=leg.booking.passenger_name.split()[0], text=preview)
    else:
        trip_updates.to_customer(db, leg, "new_message", sender=leg.driver.full_name.split()[0], text=preview)
    db.flush()
    return msg


def translate(text: str, target: str) -> str | None:
    """Çeviri; kapalıysa, metin zaten hedef dildeyse ya da servis yanıt vermezse None (mesaj yine gider)."""
    try:
        translator = get_translator()
    except RuntimeError as exc:  # anahtar tanımsız: mesaj çevrilmeden gider
        log.error("çeviri yapılandırması hatalı: %s", exc)
        return None
    if translator is None:
        return None
    if not api_cache.take_budget("translate_chars", len(text), get_settings().translation_daily_char_limit):
        log.warning("günlük çeviri sınırı doldu")
        return None
    try:
        # Telefon ve e-posta dışarı gönderilmez (KVKK); çeviride aynen yerine konur.
        masked, secrets_ = mask_contacts(text)
        result = translator.translate(masked, target)
    except ServiceUnavailable as exc:
        log.warning("mesaj çevrilemedi: %s", exc)
        return None
    api_cache.count("translate_call")
    result = type(result)(text=unmask(result.text, secrets_), source_lang=result.source_lang)
    if (result.source_lang or "").split("-")[0].lower() == target or result.text.strip() == text.strip():
        return None
    return result.text[:MAX_LENGTH * 2]


_CONTACT = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{6,}\d")


def mask_contacts(text: str) -> tuple[str, list[str]]:
    found: list[str] = []

    def keep(m: re.Match) -> str:
        found.append(m.group(0))
        return f"[{len(found)}]"

    return _CONTACT.sub(keep, text), found


def unmask(text: str, found: list[str]) -> str:
    for i, value in enumerate(found, start=1):
        text = text.replace(f"[{i}]", value)
    return text


def _other(viewer: str) -> str:
    if viewer not in SENDERS:
        raise ValueError(viewer)
    return "driver" if viewer == "customer" else "customer"
