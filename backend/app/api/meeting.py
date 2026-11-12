"""Buluşma deneyimi uçları (K-62).

Müşteri: yolcu durumu, buluşma rehberi, takip bağlantısı, sürücü fotoğrafı, puan ve bahşiş.
Girişsiz: takip bağlantısı sayfası, rehber fotoğrafları.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

import redis
from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from app.api.customer import _own_booking
from app.api.deps import ClientIp, CurrentCustomer, DbSession, Now
from app.api.schemas import DriverBrief, MoneyStr
from app.config import get_settings
from app.errors import NotFound, TooManyRequests
from app.models import MeetingGuide
from app.models.enums import LegStatus
from app.providers.payments import get_payment_provider
from app.providers.storage import get_storage
from app.services import eta, live_location, meeting, ratings
from app.services.places import _redis

customer_router = APIRouter(prefix="/me", tags=["customer"])
public_router = APIRouter(tags=["public"])

PHOTO_CACHE = {"Cache-Control": "private, max-age=300"}


# --- Yolcu durumu ----------------------------------------------------------------


class PassengerStatusIn(BaseModel):
    status: Literal["indi", "bagajda", "cikiyor"]


class PassengerStatusOut(BaseModel):
    leg_id: uuid.UUID
    passenger_status: str | None
    passenger_status_at: datetime | None


@customer_router.post("/bookings/{code}/passenger-status", response_model=PassengerStatusOut)
def passenger_status(code: str, body: PassengerStatusIn, customer: CurrentCustomer, db: DbSession, now: Now):
    leg = meeting.set_passenger_status(db, _own_booking(db, customer, code), body.status, now)
    db.commit()
    return PassengerStatusOut(leg_id=leg.id, passenger_status=leg.passenger_status,
                              passenger_status_at=leg.passenger_status_at)


# --- Buluşma rehberi -------------------------------------------------------------


class GuideStepOut(BaseModel):
    text: str
    photo_path: str | None


class GuideOut(BaseModel):
    id: int
    terminal: str
    steps: list[GuideStepOut]


class MeetingGuideOut(BaseModel):
    airport: str | None
    guides: list[GuideOut]


@customer_router.get("/bookings/{code}/meeting-guide", response_model=MeetingGuideOut)
def meeting_guide(code: str, customer: CurrentCustomer, db: DbSession, lang: str | None = None):
    booking = _own_booking(db, customer, code)
    leg = meeting.guide_leg(booking)
    if leg is None:
        return MeetingGuideOut(airport=None, guides=[])
    language = (lang or booking.locale).lower()[:2]
    return MeetingGuideOut(airport=leg.pickup_region.name,
                           guides=[meeting.localized(g, language) for g in meeting.guides_for(db, leg.pickup_region_id)])


@public_router.get("/meeting-guides/{guide_id}/photos/{index}")
def guide_photo(guide_id: int, index: int, db: DbSession):
    guide = db.get(MeetingGuide, guide_id)
    steps = guide.steps if guide is not None and guide.is_active else []
    if not 0 <= index < len(steps) or not steps[index].get("photo_key"):
        raise NotFound("fotoğraf yok")
    step = steps[index]
    return Response(get_storage().get(step["photo_key"]), media_type=step.get("photo_type") or "image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"})


# --- Sürücü fotoğrafı -------------------------------------------------------------


@customer_router.get("/bookings/{code}/driver-photo")
def driver_photo(code: str, customer: CurrentCustomer, db: DbSession, now: Now):
    leg = meeting.photo_leg(_own_booking(db, customer, code), now)
    key, content_type = meeting.driver_photo(leg.driver)
    return Response(get_storage().get(key), media_type=content_type, headers=PHOTO_CACHE)


# --- Girişsiz takip bağlantısı ----------------------------------------------------


class ShareOut(BaseModel):
    token: str
    url: str


@customer_router.post("/bookings/{code}/share", response_model=ShareOut)
def create_share(code: str, customer: CurrentCustomer, db: DbSession):
    token = meeting.share(_own_booking(db, customer, code))
    db.commit()
    return ShareOut(token=token, url=meeting.share_url(token))


@customer_router.delete("/bookings/{code}/share", status_code=204)
def revoke_share(code: str, customer: CurrentCustomer, db: DbSession):
    _own_booking(db, customer, code).share_token = None
    db.commit()


class TrackOut(BaseModel):
    """Takip sayfası: yalnızca karşılama için gereken bilgi. Telefon, adres, ad soyad ve ödeme yok."""

    status: LegStatus
    pickup_region: str
    dropoff_region: str
    pickup_at: datetime
    flight_no: str | None
    flight_status: str | None
    flight_estimated_at: datetime | None
    passenger_status: str | None
    driver: DriverBrief | None
    eta_minutes: int | None
    location: dict | None
    locale: str


def _track_rate_limit(token: str, ip: str, now: datetime) -> None:
    """Bağlantı + IP başına dakikalık sınır (ortak IP'deki farklı bağlantılar birbirini engellemez).
    Redis yanıt vermezse sınır atlanır; sayfa açık kalır."""
    key = f"track_rl:{token[:12]}:{ip}:{now:%Y%m%d%H%M}"
    try:
        count = _redis().incr(key)
        if count == 1:
            _redis().expire(key, 70)
    except redis.RedisError:
        return
    if count > get_settings().track_rate_limit_per_minute:
        raise TooManyRequests("çok fazla istek, lütfen biraz bekleyin")


@public_router.get("/track/{token}", response_model=TrackOut)
def track(token: str, db: DbSession, ip: ClientIp, now: Now):
    _track_rate_limit(token, ip, now)
    booking = meeting.tracked(db, token, now)
    leg = meeting.tracked_leg(booking)
    location = None
    if leg.status in live_location.TRACKABLE and (raw := live_location.for_leg(leg)):
        location = {"lat": raw["lat"], "lng": raw["lng"], "heading": raw.get("heading"), "at": raw.get("at")}
    fi = leg.flight
    return TrackOut(
        status=leg.status,
        pickup_region=leg.pickup_region.name,
        dropoff_region=leg.dropoff_region.name,
        pickup_at=leg.pickup_at,
        flight_no=fi.flight_no if fi else None,
        flight_status=fi.status if fi else None,
        flight_estimated_at=fi.estimated_at if fi else None,
        passenger_status=leg.passenger_status,
        driver=DriverBrief.of(leg),
        eta_minutes=eta.current(leg) if leg.status in live_location.TRACKABLE else None,
        location=location,
        locale=booking.locale,
    )


@public_router.get("/track/{token}/driver-photo")
def track_driver_photo(token: str, db: DbSession, ip: ClientIp, now: Now):
    _track_rate_limit(token, ip, now)
    leg = meeting.tracked_leg(meeting.tracked(db, token, now))
    key, content_type = meeting.driver_photo(leg.driver)
    return Response(get_storage().get(key), media_type=content_type, headers=PHOTO_CACHE)


# --- Puan ve bahşiş -----------------------------------------------------------------


class RatingIn(BaseModel):
    stars: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)
    tip_amount: Decimal | None = Field(default=None, gt=0, max_digits=8, decimal_places=2)


class TipIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=8, decimal_places=2)


class RatingOut(BaseModel):
    leg_id: uuid.UUID | None
    rated: bool
    stars: int | None = None
    tip_amount: MoneyStr | None = None
    tip_status: str | None = None
    currency: str
    tip_max: MoneyStr
    tip_suggestions: list[MoneyStr]
    # Bahşiş ödeme sayfası (yalnızca bahşiş başlatılınca).
    iframe_url: str | None = None


def _rating_out(booking, leg, rating, iframe_url: str | None = None) -> RatingOut:
    limit = ratings._tip_max(booking.currency)
    steps = (Decimal("50"), Decimal("100"), Decimal("200")) if booking.currency.value == "TRY" else (
        Decimal("5"), Decimal("10"), Decimal("20"))
    return RatingOut(
        leg_id=leg.id if leg else None,
        rated=rating is not None,
        stars=rating.stars if rating else None,
        tip_amount=rating.tip_amount if rating and rating.tip_status != ratings.TIP_OPEN else None,
        tip_status=rating.tip_status if rating else None,
        currency=booking.currency.value,
        tip_max=limit,
        tip_suggestions=[x for x in steps if x <= limit],
        iframe_url=iframe_url,
    )


@customer_router.get("/bookings/{code}/rating", response_model=RatingOut)
def get_rating(code: str, customer: CurrentCustomer, db: DbSession):
    booking = _own_booking(db, customer, code)
    leg = ratings.rateable_leg(booking)
    return _rating_out(booking, leg, ratings.rating_for(db, leg) if leg else None)


@customer_router.post("/bookings/{code}/rating", response_model=RatingOut, status_code=201)
def rate_trip(code: str, body: RatingIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp, now: Now):
    booking = _own_booking(db, customer, code)
    if body.tip_amount:
        ratings.check_tip(booking, body.tip_amount)  # geçersiz bahşiş puanı da geri aldırmasın
    rating = ratings.rate(db, booking, stars=body.stars, comment=body.comment, now=now)
    db.commit()
    iframe_url = None
    if body.tip_amount:
        # Ödeme sağlayıcısı yanıt vermezse puan kayıtlı kalır; bahşiş "Bahşiş öde" ile yeniden denenir.
        rating, checkout = ratings.start_tip(db, booking, customer, get_payment_provider(),
                                             amount=body.tip_amount, user_ip=ip, now=now)
        iframe_url = checkout.iframe_url
        db.commit()
    return _rating_out(booking, ratings.rateable_leg(booking), rating, iframe_url)


@customer_router.post("/bookings/{code}/tip", response_model=RatingOut)
def tip(code: str, body: TipIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp, now: Now):
    booking = _own_booking(db, customer, code)
    rating, checkout = ratings.start_tip(db, booking, customer, get_payment_provider(),
                                         amount=body.amount, user_ip=ip, now=now)
    db.commit()
    return _rating_out(booking, ratings.rateable_leg(booking), rating, checkout.iframe_url)

