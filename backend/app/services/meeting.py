"""Buluşma deneyimi (K-62).

- Buluşma rehberi: havalimanı (ve terminal) başına fotoğraflı adımlar, müşterinin dilinde. Uçuş inince
  (K-60), yolcu "İndim" deyince ya da sürücü "Vardım" deyince müşteriye bir kez bildirilir.
- Yolcu durumu: "İndim / Bagajdayım / Çıkıyorum" tek dokunuşla sürücüye gider.
- Sürücü kartı: fotoğraf, diller, araç, renk ve plaka alıştan bir gün önce müşteriye bildirilir.
- Girişsiz takip bağlantısı: müşteri paylaşır, karşılayan yakını uygulamasız izler. Bağlantı yalnızca
  durum, sürücünün adı, araç ve konumu gösterir; telefon, adres ve ödeme bilgisi göstermez.
"""

from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta

from PIL import Image, ImageOps, UnidentifiedImageError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, NotFound
from app.models import Booking, BookingLeg, Driver, MeetingGuide
from app.models.enums import BookingStatus, LegStatus, RegionType
from app.services import trip_updates

# Yolcu durumu ve sürücüye giden bildirim kodu.
PASSENGER_STATUSES = {"indi": "passenger_landed", "bagajda": "passenger_baggage", "cikiyor": "passenger_exiting"}
# Yolcu durumu alıştan en çok bu kadar önce bildirilebilir (önceki günün işine yanlışlıkla gitmesin).
STATUS_EARLIEST = timedelta(hours=12)
PRE_PICKUP = (LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED)
PHOTO_TYPES = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
PHOTO_CONTENT_TYPE = "image/jpeg"  # yeniden kodlanmış hali
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_GUIDE_STEPS = 8


# --- Rehber ----------------------------------------------------------------------


def guides_for(db: Session, region_id: int) -> list[MeetingGuide]:
    return list(db.scalars(
        select(MeetingGuide)
        .where(MeetingGuide.region_id == region_id, MeetingGuide.is_active.is_(True))
        .order_by(MeetingGuide.terminal)
    ))


def _text(texts: dict, lang: str) -> str:
    return texts.get(lang) or texts.get("en") or texts.get("tr") or next(iter(texts.values()), "")


def localized(guide: MeetingGuide, lang: str) -> dict:
    return {
        "id": guide.id,
        "terminal": guide.terminal,
        "steps": [
            {"text": _text(step.get("texts") or {}, lang),
             "photo_path": f"/api/v1/meeting-guides/{guide.id}/photos/{i}" if step.get("photo_key") else None}
            for i, step in enumerate(guide.steps or [])
        ],
    }


def guide_leg(booking: Booking) -> BookingLeg | None:
    """Rehberin gösterildiği bacak: havalimanından alışı olan, henüz yolcu alınmamış ilk bacak; yoksa ilk
    havalimanı alışı."""
    airport = [leg for leg in booking.legs if leg.pickup_region.type is RegionType.AIRPORT]
    return next((leg for leg in airport if leg.status in (LegStatus.PENDING, *PRE_PICKUP)), None) or (
        airport[0] if airport else None)


def maybe_send_guide(db: Session, leg: BookingLeg, now: datetime) -> bool:
    """Havalimanı alışında rehber varsa müşteriye bir kez bildirir."""
    if leg.meeting_guide_sent_at is not None or leg.pickup_region.type is not RegionType.AIRPORT:
        return False
    if leg.status not in (LegStatus.PENDING, *PRE_PICKUP) or not guides_for(db, leg.pickup_region_id):
        return False
    trip_updates.to_customer(db, leg, "meeting_guide")
    leg.meeting_guide_sent_at = now
    return True


# --- Yolcu durumu ----------------------------------------------------------------


def set_passenger_status(db: Session, booking: Booking, status: str, now: datetime) -> BookingLeg:
    if status not in PASSENGER_STATUSES:
        raise DomainError("geçersiz durum", code="invalid_passenger_status")
    leg = next((leg for leg in booking.legs if leg.status in PRE_PICKUP), None)
    if leg is None:
        raise Conflict("sürücü atanınca durumunuzu bildirebilirsiniz", code="no_pickup_pending")
    if now < leg.pickup_at - STATUS_EARLIEST:
        raise Conflict("durum alış gününde bildirilebilir", code="too_early")
    order = list(PASSENGER_STATUSES)
    if leg.passenger_status is not None and order.index(status) <= order.index(leg.passenger_status):
        return leg  # durum yalnızca ileri gider; aynı ya da geri dokunuş bildirim üretmez
    leg.passenger_status = status
    leg.passenger_status_at = now
    trip_updates.to_driver(db, leg, PASSENGER_STATUSES[status], passenger=booking.passenger_name.split()[0])
    if status == "indi":
        maybe_send_guide(db, leg, now)
    return leg


# --- Sürücü kartı ----------------------------------------------------------------


def card_params(leg: BookingLeg) -> dict[str, str]:
    driver, vehicle = leg.driver, leg.vehicle
    return {
        "color": f"{vehicle.color} " if vehicle is not None and vehicle.color else "",
        "languages": ", ".join(x.upper() for x in driver.language_list) if driver is not None else "",
    }


def send_driver_cards(db: Session, now: datetime) -> int:
    """Alışına `driver_card_hours_before` saatten az kalan, sürücüsü belli işlerde kartı bir kez gönderir."""
    horizon = now + timedelta(hours=get_settings().driver_card_hours_before)
    legs = list(db.scalars(
        select(BookingLeg).where(
            BookingLeg.status == LegStatus.ASSIGNED,
            BookingLeg.driver_id.is_not(None),
            BookingLeg.driver_card_sent_at.is_(None),
            BookingLeg.pickup_at > now,
            BookingLeg.pickup_at <= horizon,
        ).with_for_update(of=BookingLeg, skip_locked=True)
    ))
    for leg in legs:
        trip_updates.to_customer(db, leg, "driver_card", **card_params(leg))
        leg.driver_card_sent_at = now
    return len(legs)


def on_assigned(leg: BookingLeg, now: datetime) -> None:
    """Atama bildirimi kartın yerine geçer (alış yakınsa); uzaksa kart bir gün önce gider."""
    near = leg.pickup_at <= now + timedelta(hours=get_settings().driver_card_hours_before)
    leg.driver_card_sent_at = now if near else None


MAX_PHOTO_SIDE = 1200
Image.MAX_IMAGE_PIXELS = 40_000_000  # çözülme bombasına karşı


def clean_photo(content_type: str, data: bytes) -> bytes:
    """Fotoğrafı doğrular ve meta verisiz (EXIF: konum, cihaz, tarih) JPEG olarak yeniden kodlar.
    Sürücü fotoğrafı takip bağlantısıyla üçüncü kişilere de gösterildiği için ham dosya saklanmaz."""
    magic = PHOTO_TYPES.get(content_type)
    if magic is None:
        raise DomainError("yalnızca JPEG veya PNG yüklenebilir", code="invalid_file_type")
    if len(data) > MAX_PHOTO_BYTES:
        raise DomainError("fotoğraf en fazla 5 MB olabilir", code="file_too_large")
    if not data.startswith(magic):
        raise DomainError("dosya içeriği türüyle uyuşmuyor", code="invalid_file_type")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise DomainError("fotoğraf okunamadı", code="invalid_file_type") from exc
    return out.getvalue()


def card_leg(booking: Booking) -> BookingLeg:
    """Müşterinin gördüğü sürücü: aktif bacağın; yoksa sürücüsü olan son bacağın."""
    active = next((leg for leg in booking.legs if leg.driver_id is not None
                   and leg.status in (*PRE_PICKUP, LegStatus.STARTED)), None)
    if active is not None:
        return active
    with_driver = [leg for leg in booking.legs if leg.driver_id is not None]
    if not with_driver:
        raise NotFound("sürücü henüz atanmadı", code="driver_not_assigned")
    return with_driver[-1]


PHOTO_AFTER_TRIP = timedelta(days=1)


def photo_leg(booking: Booking, now: datetime) -> BookingLeg:
    """Sürücü fotoğrafı yalnızca yolculuk süresince ve bittikten 1 gün sonrasına kadar gösterilir."""
    leg = card_leg(booking)
    if leg.status is LegStatus.CANCELLED or now > leg.pickup_at + timedelta(minutes=leg.duration_minutes or 0) + PHOTO_AFTER_TRIP:
        raise NotFound("fotoğraf yok", code="photo_missing")
    return leg


def driver_photo(driver: Driver | None) -> tuple[str, str]:
    if driver is None or not driver.photo_key:
        raise NotFound("fotoğraf yok", code="photo_missing")
    return driver.photo_key, driver.photo_content_type or "image/jpeg"


# --- Girişsiz takip bağlantısı -------------------------------------------------------


def share(booking: Booking) -> str:
    if booking.status in (BookingStatus.CANCELLED, BookingStatus.PENDING_PAYMENT):
        raise Conflict("bu rezervasyon paylaşılamaz", code="share_unavailable")
    if not booking.share_token:
        booking.share_token = secrets.token_urlsafe(18)
    return booking.share_token


def share_url(token: str) -> str:
    return f"{get_settings().public_web_url.rstrip('/')}/track/{token}"


def tracked(db: Session, token: str, now: datetime) -> Booking:
    booking = db.scalar(select(Booking).where(Booking.share_token == token)) if 16 <= len(token) <= 64 else None
    if booking is None or booking.status in (BookingStatus.CANCELLED, BookingStatus.PENDING_PAYMENT):
        raise NotFound("bağlantı geçersiz", code="track_not_found")
    last = max(leg.pickup_at + timedelta(minutes=leg.duration_minutes or 0) for leg in booking.legs)
    if now > last + timedelta(hours=get_settings().share_link_hours_after):
        raise NotFound("bağlantının süresi doldu", code="track_expired")
    return booking


def tracked_leg(booking: Booking) -> BookingLeg:
    """Takip edilen bacak: aktif olan; yoksa sıradaki; yoksa son bacak."""
    order = (LegStatus.STARTED, LegStatus.ARRIVED, LegStatus.EN_ROUTE, LegStatus.ASSIGNED, LegStatus.PENDING)
    for status in order:
        leg = next((leg for leg in booking.legs if leg.status is status), None)
        if leg is not None:
            return leg
    return booking.legs[-1]
