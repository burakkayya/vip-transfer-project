"""Uber tarzı yolculuk akışı uçları (K-47..K-51).

Sürücü: iş havuzu, iş ayrıntısı (kabul öncesi), kabul/red, alışa/varışa rota, sohbet, bildirim akışı.
Müşteri: yolculuğu bitirme, sohbet, bildirim akışı, push jetonu.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentCustomer, CurrentDriver, DbSession, Now
from app.api.driver import TripOut, _trip_out
from app.api.customer import _own_booking
from app.api.schemas import BookingOut, MoneyStr
from app.errors import NotFound, ServiceUnavailable
from app.models import BookingLeg, DispatchOffer, TripMessage, TripUpdate
from app.models.enums import BookingType, LegStatus, OfferStatus
from app.providers.routing import Point, get_live_routing, haversine_km
from app.services import dispatch, eta, live_location, messages, notifications, route_line

driver_router = APIRouter(prefix="/driver", tags=["driver"])
customer_router = APIRouter(prefix="/me", tags=["customer"])

UPDATES_LOOKBACK = timedelta(hours=6)


# --- Sürücü: iş havuzu --------------------------------------------------------


class JobOut(BaseModel):
    """Kabul öncesi iş: yolcu adı kısaltılmış, adres yok, harita uçları kırpılmış (K-47)."""

    leg_id: uuid.UUID
    booking_code: str
    booking_type: BookingType
    pickup_at: datetime
    pickup_region: str
    dropoff_region: str
    passenger_initial: str
    passenger_count: int
    luggage_count: int
    child_seat_count: int = 0
    market_stop: bool = False
    has_flight: bool
    vehicle_type: str
    distance_km: Decimal
    duration_minutes: int | None
    driver_amount: MoneyStr
    currency: str
    # Sürücünün konumu verildiyse alış bölgesine kuş uçuşu uzaklık (km, 0.1 hassasiyet).
    pickup_distance_km: Decimal | None = None
    # Anlık işte bu sürücüye gönderilmiş teklif varsa geçerlilik sonu (geri sayım).
    offer_expires_at: datetime | None = None
    # Yalnızca ayrıntıda: uçları kırpılmış rota.
    preview_polyline: str | None = None


def _job_out(db, leg: BookingLeg, driver, *, at: Point | None, detail: bool, now: datetime) -> JobOut:
    b = leg.booking
    offer = next(
        (o for o in db.scalars(
            select(DispatchOffer).where(
                DispatchOffer.booking_leg_id == leg.id,
                DispatchOffer.driver_id == driver.id,
                DispatchOffer.status == OfferStatus.SENT,
                DispatchOffer.expires_at > now,
            ))),
        None,
    )
    distance = None
    if at is not None:
        distance = haversine_km(at, eta.pickup_point(leg)).quantize(Decimal("0.1"))
    return JobOut(
        leg_id=leg.id,
        booking_code=b.booking_code,
        booking_type=b.booking_type,
        pickup_at=leg.pickup_at,
        pickup_region=leg.pickup_region.name,
        dropoff_region=leg.dropoff_region.name,
        passenger_initial=b.passenger_name.strip()[:1].upper() + ".",
        passenger_count=b.passenger_count,
        luggage_count=b.luggage_count,
        child_seat_count=b.child_seat_count,
        market_stop=b.market_stop,
        has_flight=leg.flight is not None,
        vehicle_type=b.vehicle_type.name,
        distance_km=leg.distance_km,
        duration_minutes=leg.duration_minutes,
        driver_amount=leg.leg_price - (leg.leg_price * b.commission_rate).quantize(Decimal("0.01")),
        currency=b.currency.value,
        pickup_distance_km=distance,
        offer_expires_at=offer.expires_at if offer else None,
        preview_polyline=route_line.preview_polyline(leg) if detail else None,
    )


def _point(lat: float | None, lng: float | None) -> Point | None:
    if lat is None or lng is None:
        return None
    return Point(Decimal(str(lat)), Decimal(str(lng)))


@driver_router.get("/jobs", response_model=list[JobOut])
def list_jobs(
    driver: CurrentDriver, db: DbSession, now: Now,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
):
    at = _point(lat, lng)
    return [_job_out(db, leg, driver, at=at, detail=False, now=now) for leg, _ in dispatch.open_jobs(db, driver, now)]


@driver_router.get("/jobs/{leg_id}", response_model=JobOut)
def get_job(
    leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
):
    leg = dispatch.job_for(db, driver, leg_id, now)
    return _job_out(db, leg, driver, at=_point(lat, lng), detail=True, now=now)


@driver_router.post("/jobs/{leg_id}/accept", response_model=TripOut)
def accept_job(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now):
    leg = dispatch.accept_job(db, driver, leg_id, now=now)
    db.commit()
    return _trip_out(leg, with_route=True)


@driver_router.post("/jobs/{leg_id}/decline", status_code=204)
def decline_job(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now):
    dispatch.decline_job(db, driver, leg_id, now=now)
    db.commit()


# --- Sürücü: navigasyon --------------------------------------------------------


class ApproachOut(BaseModel):
    target: str  # pickup | dropoff
    target_lat: float
    target_lng: float
    polyline: str | None
    distance_km: Decimal | None
    duration_minutes: int | None
    # Yolculuk bitirme kuralı (K-49): varışa uzaklık ve izin verilen yarıçap (yalnız "dropoff").
    finish_distance_m: int | None = None
    finish_radius_m: int | None = None


def _own_leg(db, driver, leg_id: uuid.UUID) -> BookingLeg:
    leg = db.get(BookingLeg, leg_id)
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    return leg


@driver_router.get("/trips/{leg_id}/approach", response_model=ApproachOut)
def approach(
    leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession,
    lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
):
    """Sürücünün konumundan şu anki hedefe (yolcu alınana kadar alış, sonra varış) rota."""
    leg = _own_leg(db, driver, leg_id)
    target = eta.target_point(leg)
    at = Point(Decimal(str(lat)), Decimal(str(lng)))
    try:
        route = get_live_routing().route(at, target)
        line, km, minutes = route.polyline, route.distance_km, route.duration_minutes
    except ServiceUnavailable:
        line, km, minutes = None, None, eta.estimate_minutes(at, target)
    to_dropoff = leg.status is LegStatus.STARTED
    return ApproachOut(
        target="dropoff" if to_dropoff else "pickup",
        target_lat=float(target.lat),
        target_lng=float(target.lng),
        polyline=line,
        distance_km=km,
        duration_minutes=minutes,
        finish_distance_m=dispatch.distance_to_dropoff_m(leg, at) if to_dropoff else None,
        finish_radius_m=dispatch.finish_radius_m(leg) if to_dropoff else None,
    )


# --- Sohbet --------------------------------------------------------------------


class MessageOut(BaseModel):
    id: uuid.UUID
    sender: str
    body: str
    created_at: datetime
    read_at: datetime | None
    # K-62: alıcının diline çeviri (yoksa None). İstemci karşı tarafın mesajında çeviriyi, altında aslını gösterir.
    translated_body: str | None = None
    translated_lang: str | None = None


class ChatOut(BaseModel):
    open: bool
    unread: int
    other_name: str
    messages: list[MessageOut]


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=messages.MAX_LENGTH)


class UnreadOut(BaseModel):
    unread: int


def _chat(db, leg: BookingLeg, viewer: str, other_name: str, now: datetime) -> ChatOut:
    rows, unread = messages.history(db, leg, viewer, now)
    db.commit()
    return ChatOut(
        open=messages.is_open(leg),
        unread=unread,
        other_name=other_name,
        messages=[_msg_out(m) for m in rows],
    )


def _msg_out(m: TripMessage) -> MessageOut:
    return MessageOut(id=m.id, sender=m.sender, body=m.body, created_at=m.created_at, read_at=m.read_at,
                      translated_body=m.translated_body, translated_lang=m.translated_lang)


@driver_router.get("/trips/{leg_id}/messages", response_model=ChatOut)
def driver_chat(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now):
    leg = _own_leg(db, driver, leg_id)
    return _chat(db, leg, "driver", leg.booking.passenger_name.split()[0], now)


@driver_router.get("/trips/{leg_id}/messages/unread", response_model=UnreadOut)
def driver_unread(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession):
    return UnreadOut(unread=messages.unread_count(db, _own_leg(db, driver, leg_id), "driver"))


@driver_router.post("/trips/{leg_id}/messages", response_model=MessageOut, status_code=201)
def driver_send(leg_id: uuid.UUID, body: MessageIn, driver: CurrentDriver, db: DbSession, now: Now):
    leg = _own_leg(db, driver, leg_id)
    msg = messages.send(db, leg, "driver", body.body, now)
    db.commit()
    return _msg_out(msg)


@customer_router.get("/bookings/{code}/messages", response_model=ChatOut)
def customer_chat(code: str, customer: CurrentCustomer, db: DbSession, now: Now):
    leg = messages.chat_leg(_own_booking(db, customer, code))
    return _chat(db, leg, "customer", leg.driver.full_name.split()[0], now)


@customer_router.get("/bookings/{code}/messages/unread", response_model=UnreadOut)
def customer_unread(code: str, customer: CurrentCustomer, db: DbSession):
    booking = _own_booking(db, customer, code)
    try:
        leg = messages.chat_leg(booking)
    except NotFound:
        return UnreadOut(unread=0)
    return UnreadOut(unread=messages.unread_count(db, leg, "customer"))


@customer_router.post("/bookings/{code}/messages", response_model=MessageOut, status_code=201)
def customer_send(code: str, body: MessageIn, customer: CurrentCustomer, db: DbSession, now: Now):
    leg = messages.chat_leg(_own_booking(db, customer, code))
    msg = messages.send(db, leg, "customer", body.body, now)
    db.commit()
    return _msg_out(msg)


# --- Müşteri: yolculuğu bitirme, canlı ETA --------------------------------------------


@customer_router.post("/bookings/{code}/finish", response_model=BookingOut)
def customer_finish(code: str, customer: CurrentCustomer, db: DbSession, now: Now):
    """K-48: yolcu araçtayken müşteri yolculuğu her an bitirebilir. Tamamlandı sayılır, iade yoktur."""
    booking = _own_booking(db, customer, code)
    leg = dispatch.finish_by_customer(db, booking, customer.user_id, now=now)
    db.commit()
    live_location.clear(leg)
    return BookingOut.build(booking, with_route=True)


class EtaOut(BaseModel):
    leg_id: uuid.UUID | None
    status: LegStatus | None
    # Yolcu alınana kadar alışa, yolculukta varışa tahmini dakika.
    eta_minutes: int | None
    location: dict | None


@customer_router.get("/bookings/{code}/eta", response_model=EtaOut)
def customer_eta(code: str, customer: CurrentCustomer, db: DbSession):
    booking = _own_booking(db, customer, code)
    leg = next((leg for leg in booking.legs if leg.status in dispatch.ACTIVE_LEG_STATUSES), None)
    if leg is None:
        return EtaOut(leg_id=None, status=None, eta_minutes=None, location=None)
    return EtaOut(leg_id=leg.id, status=leg.status, eta_minutes=eta.current(leg),
                  location=live_location.for_booking(booking))


# --- Bildirim akışı ve push jetonu -------------------------------------------------


class UpdateOut(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    body: str
    data: dict
    created_at: datetime


def _updates(db, recipient_type: str, recipient_id, after: datetime | None, now: datetime) -> list[UpdateOut]:
    since = max(after, now - UPDATES_LOOKBACK) if after else now - UPDATES_LOOKBACK
    rows = db.scalars(
        select(TripUpdate)
        .where(TripUpdate.recipient_type == recipient_type, TripUpdate.recipient_id == recipient_id,
               TripUpdate.created_at > since)
        .order_by(TripUpdate.created_at)
        .limit(100)
    )
    return [UpdateOut(id=u.id, code=u.code, title=u.title, body=u.body, data=u.data, created_at=u.created_at)
            for u in rows]


@driver_router.get("/updates", response_model=list[UpdateOut])
def driver_updates(driver: CurrentDriver, db: DbSession, now: Now, after: datetime | None = None):
    return _updates(db, "driver", driver.id, after, now)


@customer_router.get("/updates", response_model=list[UpdateOut])
def customer_updates(customer: CurrentCustomer, db: DbSession, now: Now, after: datetime | None = None):
    return _updates(db, "customer", customer.id, after, now)


class PushTokenIn(BaseModel):
    token: str | None = Field(default=None, max_length=255)


@customer_router.post("/push-token", status_code=204)
def customer_push_token(body: PushTokenIn, customer: CurrentCustomer, db: DbSession):
    notifications.bind_push_token(db, customer, body.token)
    db.commit()


@driver_router.post("/me/push-token", status_code=204)
def driver_push_token(body: PushTokenIn, driver: CurrentDriver, db: DbSession):
    notifications.bind_push_token(db, driver, body.token)
    db.commit()

