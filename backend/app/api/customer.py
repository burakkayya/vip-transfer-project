"""Müşteri uçları: rezervasyon, iptal, ödeme, profil, KVKK talepleri."""

from __future__ import annotations

import asyncio
import dataclasses
import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import (
    ClientIp,
    CurrentCustomer,
    DbSession,
    Now,
    current_customer,
    current_principal,
)
from app.api.public import to_quote_input
from app.api.schemas import (
    BookingCreateIn,
    BookingOut,
    CancelIn,
    CheckoutOut,
    RefundQuoteOut,
    _locale,
)
from app.currency import currency_for_country
from app.db import SessionLocal
from app.errors import DomainError, NotFound
from app.models import Booking, Consent, DataRequest
from app.models.enums import ConsentType, DataRequestStatus, DataRequestType
from app.providers.payments import get_payment_provider
from app.providers.routing import get_routing
from app.services import audit, bookings, live_location, payments, quotes

router = APIRouter(prefix="/me", tags=["customer"])

# KVKK m.13: başvurular en geç 30 gün içinde sonuçlandırılır.
DATA_REQUEST_DAYS = 30


def _own_booking(db: DbSession, customer, code: str) -> Booking:
    booking = db.scalar(
        select(Booking).where(Booking.booking_code == code.upper(), Booking.customer_id == customer.id)
    )
    if booking is None:
        raise NotFound("rezervasyon bulunamadı")
    return booking


@router.post("/bookings", response_model=BookingOut, status_code=201)
def create_booking(body: BookingCreateIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp, now: Now):
    if not (body.accept_disclosure and body.accept_distance_sales):
        raise DomainError(
            "aydınlatma metni ve mesafeli satış ön bilgilendirmesi onaylanmalı", code="consent_required"
        )
    req = to_quote_input(db, body)
    if req.country_code is None:
        # Para birimi müşteri profilindeki ülkeye göre belirlenir.
        req = dataclasses.replace(req, country_code=customer.country_code)
    q = quotes.build_quote(db, req, router=get_routing(), now=now)
    booking = bookings.create_booking(
        db,
        customer=customer,
        quote=q,
        expected_total=body.expected_total,
        booking_type=body.booking_type,
        passenger_name=body.passenger_name,
        passenger_count=body.passenger_count,
        luggage_count=body.luggage_count,
        note=body.note,
        flights=[bookings.FlightInput(f.leg_order, f.flight_no, f.scheduled_at) for f in body.flights],
        locale=body.locale,
        ip=ip,
        now=now,
    )
    db.commit()
    return BookingOut.build(booking)


@router.get("/bookings", response_model=list[BookingOut])
def list_bookings(customer: CurrentCustomer, db: DbSession):
    rows = db.scalars(
        select(Booking).where(Booking.customer_id == customer.id).order_by(Booking.created_at.desc()).limit(100)
    )
    return [BookingOut.build(b) for b in rows]


@router.get("/bookings/{code}", response_model=BookingOut)
def get_booking(code: str, customer: CurrentCustomer, db: DbSession):
    return BookingOut.build(_own_booking(db, customer, code), with_route=True)


@router.get("/bookings/{code}/cancellation", response_model=RefundQuoteOut)
def cancellation_preview(code: str, customer: CurrentCustomer, db: DbSession, now: Now):
    booking = _own_booking(db, customer, code)
    q = bookings.refund_quote(db, booking, now)
    return RefundQuoteOut(**q.__dict__, currency=booking.currency)


@router.post("/bookings/{code}/cancel", response_model=BookingOut)
def cancel(code: str, body: CancelIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp, now: Now):
    booking = _own_booking(db, customer, code)
    bookings.cancel_booking(
        db,
        booking,
        provider=get_payment_provider(),
        actor_id=customer.user_id,
        reason=body.reason,
        now=now,
        ip=ip,
    )
    db.commit()
    return BookingOut.build(booking)


@router.post("/bookings/{code}/payments", response_model=CheckoutOut)
def start_payment(code: str, customer: CurrentCustomer, db: DbSession, ip: ClientIp):
    booking = _own_booking(db, customer, code)
    payment, checkout = payments.start_payment(db, booking, customer, get_payment_provider(), user_ip=ip)
    db.commit()
    return CheckoutOut(
        payment_id=payment.id, iframe_url=checkout.iframe_url, amount=payment.amount, currency=payment.currency
    )


@router.get("/bookings/{code}/driver-location")
def driver_location(code: str, customer: CurrentCustomer, db: DbSession):
    """Aktif yolculukta sürücü konumu (ekran: canlı takip). Yoksa null."""
    booking = _own_booking(db, customer, code)
    return live_location.for_booking(booking)


# --- Profil ------------------------------------------------------------------


class ProfileOut(BaseModel):
    full_name: str | None
    email: str | None
    phone: str | None
    country_code: str | None
    locale: str
    currency: str


class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    locale: str | None = None


def _profile(customer) -> ProfileOut:
    return ProfileOut(
        full_name=customer.full_name,
        email=customer.email,
        phone=customer.user.phone,
        country_code=customer.country_code,
        locale=customer.locale,
        currency=customer.currency.value,
    )


@router.get("/profile", response_model=ProfileOut)
def get_profile(customer: CurrentCustomer):
    return _profile(customer)


@router.patch("/profile", response_model=ProfileOut)
def update_profile(body: ProfileIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp):
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data:
        customer.full_name = data["full_name"]
    if "email" in data:
        customer.email = data["email"].lower() if data["email"] else None
    if "country_code" in data and data["country_code"]:
        customer.country_code = data["country_code"].upper()
        customer.currency = currency_for_country(customer.country_code)
    if data.get("locale"):
        customer.locale = _locale(data["locale"])
    audit.record(db, actor_id=customer.user_id, action="customer.update_profile",
                 entity_type="customer", entity_id=customer.id, changes={"fields": sorted(data)}, ip=ip)
    db.commit()
    return _profile(customer)


# --- KVKK / GDPR -------------------------------------------------------------


class ConsentIn(BaseModel):
    consent_type: Literal["pazarlama"]
    accepted: bool
    version: str = Field(max_length=20)


@router.post("/consents", status_code=201)
def give_consent(body: ConsentIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp):
    """Pazarlama onayı ayrı alınır ve geri çekilebilir (yasal_ve_guvenlik.md)."""
    db.add(Consent(customer_id=customer.id, consent_type=ConsentType(body.consent_type),
                   version=body.version, accepted=body.accepted, ip=ip))
    db.commit()
    return {"ok": True}


@router.get("/consents")
def list_consents(customer: CurrentCustomer, db: DbSession):
    rows = db.scalars(select(Consent).where(Consent.customer_id == customer.id).order_by(Consent.accepted_at.desc()))
    return [
        {"consent_type": c.consent_type.value, "version": c.version, "accepted": c.accepted,
         "accepted_at": c.accepted_at}
        for c in rows
    ]


class DataRequestIn(BaseModel):
    request_type: DataRequestType
    note: str | None = Field(default=None, max_length=1000)


class DataRequestOut(BaseModel):
    id: str
    request_type: str
    status: str
    due_at: str
    completed_at: str | None


@router.post("/data-requests", response_model=DataRequestOut, status_code=201)
def create_data_request(body: DataRequestIn, customer: CurrentCustomer, db: DbSession, ip: ClientIp, now: Now):
    req = DataRequest(customer_id=customer.id, request_type=body.request_type, note=body.note,
                      due_at=now + timedelta(days=DATA_REQUEST_DAYS))
    db.add(req)
    db.flush()
    audit.record(db, actor_id=customer.user_id, action="data_request.create", entity_type="data_request",
                 entity_id=req.id, changes={"request_type": body.request_type}, ip=ip)
    db.commit()
    return _dr_out(req)


@router.get("/data-requests", response_model=list[DataRequestOut])
def list_data_requests(customer: CurrentCustomer, db: DbSession):
    rows = db.scalars(select(DataRequest).where(DataRequest.customer_id == customer.id))
    return [_dr_out(r) for r in rows]


def _dr_out(r: DataRequest) -> DataRequestOut:
    return DataRequestOut(
        id=str(r.id),
        request_type=r.request_type.value,
        status=(r.status or DataRequestStatus.OPEN).value,
        due_at=r.due_at.isoformat(),
        completed_at=r.completed_at.isoformat() if r.completed_at else None,
    )


# --- Canlı takip (WebSocket) -------------------------------------------------

ws_router = APIRouter(tags=["customer"])


@ws_router.websocket("/ws/bookings/{code}/location")
async def ws_location(websocket: WebSocket, code: str):
    """Jeton ilk mesajda gönderilir: {"token": "<access_token>"} (URL'de jeton taşınmaz)."""
    await websocket.accept()
    try:
        first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10))
        with SessionLocal() as db:
            principal = current_principal(db, HTTPAuthorizationCredentials(scheme="Bearer", credentials=first["token"]))
            customer = current_customer(db, principal)
            booking = _own_booking(db, customer, code)
            booking_id = booking.id
        while True:
            with SessionLocal() as db:
                booking = db.get(Booking, booking_id)
                await websocket.send_json({"location": live_location.for_booking(booking)})
            await asyncio.sleep(3)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        return
    except Exception:  # noqa: BLE001
        await websocket.close(code=4401)
