"""Müşteri uçları: rezervasyon, iptal, ödeme, profil, KVKK talepleri."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import time
import uuid
import weakref
from datetime import timedelta
from typing import Literal

import anyio
import anyio.to_thread
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import (
    ClientIp,
    CurrentCustomer,
    client_ip,
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
from app.config import get_settings
from app.currency import currency_for_country
from app.db import SessionLocal
from app.errors import DomainError, NotFound
from app.models import Booking, Consent, DataRequest
from app.models.enums import ConsentType, DataRequestStatus, DataRequestType, LegStatus
from app.providers.payments import get_payment_provider
from app.providers.routing import get_routing
from app.security import tokens
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
    quotes.check_user_rate_limit(customer.user_id)  # F1-5: teklif yeniden hesaplanır (ücretli Routes API)
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
        child_seat_count=body.child_seat_count,
        market_stop=body.market_stop,
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


# Kapanış kodları: 4401 kimlik/oturum geçersiz, 4408 ilk mesaj süresinde gelmedi, 4429 bağlantı sınırı,
# 1009 ilk mesaj çok büyük, 1000 takip bitti (tüm bacaklar bitti/iptal) veya bağlantı ömrü doldu, 1011 sunucu hatası.
WS_UNAUTHORIZED = 4401
WS_AUTH_TIMEOUT = 4408
WS_LIMIT = 4429
WS_TOO_BIG = 1009
TERMINAL_LEGS = (LegStatus.COMPLETED, LegStatus.CANCELLED)

log = logging.getLogger(__name__)


class _WsCloseError(Exception):
    def __init__(self, code: int):
        self.code = code


@dataclasses.dataclass(frozen=True)
class _WsAuth:
    booking_id: uuid.UUID
    session_id: uuid.UUID
    exp: float
    # REV-B-4: izlenebilir bacak ve takip durumu kimlik doğrulamasıyla aynı DB oturumunda okunur; arada
    # yalnızca Redis'teki konum okunur. Bacak durumu değişiklikleri en geç `ws_revalidate_seconds` içinde görülür.
    leg_id: uuid.UUID | None = None
    finished: bool = False


class _WsSlots:
    """RT-05 / REV-B-3: süreç içi eşzamanlı bağlantı sayaçları. Kimliği doğrulanmamış bağlantılar ayrı küçük
    havuzdadır (toplam ve IP başına); `total`, oturum ve rezervasyon sayaçları yalnızca kimliği doğrulanmış
    bağlantıları sayar. Böylece kimliksiz saldırgan, müşterilerin canlı takibini 4429 ile kapatamaz.
    Yalnızca olay döngüsünde kullanılır; çok süreçli dağıtımda sınırlar süreç başınadır."""

    def __init__(self) -> None:
        self.total = 0
        self.pending = 0
        self.pending_per_ip: dict[str, int] = {}
        self.per_session: dict[uuid.UUID, int] = {}
        self.per_booking: dict[uuid.UUID, int] = {}

    def acquire_pending(self, ip: str) -> bool:
        s = get_settings()
        if self.pending >= s.ws_max_pending or self.pending_per_ip.get(ip, 0) >= s.ws_max_pending_per_ip:
            return False
        self.pending += 1
        self.pending_per_ip[ip] = self.pending_per_ip.get(ip, 0) + 1
        return True

    def release_pending(self, ip: str) -> None:
        self.pending -= 1
        _decrement(self.pending_per_ip, ip)

    def acquire(self, auth: _WsAuth) -> bool:
        s = get_settings()
        if (self.total >= s.ws_max_total
                or self.per_session.get(auth.session_id, 0) >= s.ws_max_per_session
                or self.per_booking.get(auth.booking_id, 0) >= s.ws_max_per_booking):
            return False
        self.total += 1
        self.per_session[auth.session_id] = self.per_session.get(auth.session_id, 0) + 1
        self.per_booking[auth.booking_id] = self.per_booking.get(auth.booking_id, 0) + 1
        return True

    def release(self, auth: _WsAuth) -> None:
        self.total -= 1
        _decrement(self.per_session, auth.session_id)
        _decrement(self.per_booking, auth.booking_id)


def _decrement(counts: dict, key) -> None:
    left = counts.get(key, 0) - 1
    if left > 0:
        counts[key] = left
    else:
        counts.pop(key, None)


_ws_slots = _WsSlots()

# REV-B-4: WebSocket'in thread işleri (kimlik, yeniden doğrulama, Redis okuması) HTTP uçlarıyla ortak varsayılan
# anyio havuzunu (40) ve dolayısıyla DB havuzunu tüketmesin diye ayrı sınırlayıcı. Sınırlayıcı olay döngüsüne
# bağlıdır; döngü başına bir tane tutulur (üretimde tek döngü vardır).
_ws_limiters: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter] = (
    weakref.WeakKeyDictionary()
)


def _ws_limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    limiter = _ws_limiters.get(loop)
    if limiter is None:
        limiter = _ws_limiters[loop] = anyio.CapacityLimiter(get_settings().ws_thread_limit)
    return limiter


async def _ws_run(func, *args):
    return await anyio.to_thread.run_sync(func, *args, limiter=_ws_limiter())


def _ws_authenticate(token: str, code: str) -> _WsAuth:
    """Jeton (imza, tür, `exp`), oturum (iptal, süre, hesap durumu), müşteri ve rezervasyon sahipliği; aynı
    oturumda izlenebilir bacak ve takip durumu. Bağlantı başında ve döngüde periyodik olarak çağrılır (RT-03).
    Senkron; thread'de çalıştırılır. Bağlantı başına DB'ye giden tek yer burasıdır (REV-B-4)."""
    try:
        exp = float(tokens.decode_token(token, "access")["exp"])
    except (tokens.TokenError, KeyError, TypeError, ValueError) as exc:
        raise _WsCloseError(WS_UNAUTHORIZED) from exc
    with SessionLocal() as db:
        try:
            principal = current_principal(db, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))
            customer = current_customer(db, principal)
            booking = _own_booking(db, customer, code)
        except DomainError as exc:
            raise _WsCloseError(WS_UNAUTHORIZED) from exc
        legs = list(booking.legs)
        finished = not legs or all(leg.status in TERMINAL_LEGS for leg in legs)
        leg = live_location.trackable_leg(booking)
        return _WsAuth(booking_id=booking.id, session_id=principal.session_id, exp=exp,
                       leg_id=leg.id if leg is not None else None, finished=finished)


async def _ws_first_token(websocket: WebSocket) -> str:
    s = get_settings()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=s.ws_auth_timeout_seconds)
    except asyncio.TimeoutError as exc:
        raise _WsCloseError(WS_AUTH_TIMEOUT) from exc
    # Not: çerçeve, uvicorn `ws_max_size` sınırına kadar belleğe alınmış olur; asıl sınır sunucu ayarındadır.
    if len(raw.encode()) > s.ws_first_message_max_bytes:
        raise _WsCloseError(WS_TOO_BIG)
    try:
        token = json.loads(raw)["token"]
    except (ValueError, KeyError, TypeError) as exc:
        raise _WsCloseError(WS_UNAUTHORIZED) from exc
    if not isinstance(token, str) or not token:
        raise _WsCloseError(WS_UNAUTHORIZED)
    return token


async def _ws_stream(websocket: WebSocket, token: str, code: str, auth: _WsAuth) -> None:
    s = get_settings()
    loop = asyncio.get_running_loop()
    opened = loop.time()
    checked = opened
    state = auth
    while True:
        if time.time() >= auth.exp:
            raise _WsCloseError(WS_UNAUTHORIZED)
        now = loop.time()
        if now - opened >= s.ws_max_lifetime_seconds:
            raise _WsCloseError(1000)
        if now - checked >= s.ws_revalidate_seconds:
            state = await _ws_run(_ws_authenticate, token, code)
            if state.booking_id != auth.booking_id:
                raise _WsCloseError(WS_UNAUTHORIZED)
            checked = now
        if state.finished:
            raise _WsCloseError(1000)
        # Konum yalnızca Redis'ten okunur (REV-B-4); DB'ye yalnızca yeniden doğrulamada gidilir.
        location = await _ws_run(live_location.for_leg_id, state.leg_id) if state.leg_id else None
        await websocket.send_json({"location": location})
        await asyncio.sleep(s.ws_poll_seconds)


@ws_router.websocket("/ws/bookings/{code}/location")
async def ws_location(websocket: WebSocket, code: str):
    """Jeton ilk mesajda gönderilir: {"token": "<access_token>"} (URL'de jeton taşınmaz).

    RT-03: oturum ve jeton süresi bağlantı boyunca yeniden doğrulanır; geçersizse 4401 ile kapanır. Tüm bacaklar
    bitince veya mutlak ömür dolunca 1000 ile kapanır. RT-04: DB ve Redis çağrıları thread'de çalışır.
    RT-05: kimlik öncesi kısa süre, ilk mesaj boyut sınırı, oturum/rezervasyon/toplam bağlantı sınırı.
    REV-B-3: kimlik öncesi bağlantılar ayrı havuzda (toplam ve IP başına); havuz doluysa el sıkışmada 4429.
    Toplam sınır yalnızca kimliği doğrulanmış bağlantılara uygulanır (doluysa kimlikten sonra 4429).
    """
    ip = client_ip(websocket)  # type: ignore[arg-type]  # WebSocket de `client` ve `headers` taşır
    if not _ws_slots.acquire_pending(ip):
        await websocket.close(code=WS_LIMIT)
        return
    pending = True
    auth: _WsAuth | None = None
    try:
        await websocket.accept()
        token = await _ws_first_token(websocket)
        candidate = await _ws_run(_ws_authenticate, token, code)
        _ws_slots.release_pending(ip)
        pending = False
        if not _ws_slots.acquire(candidate):
            raise _WsCloseError(WS_LIMIT)
        auth = candidate
        await _ws_stream(websocket, token, code, auth)
    except WebSocketDisconnect:
        return
    except _WsCloseError as exc:
        await _ws_close(websocket, exc.code)
    except Exception:  # noqa: BLE001
        log.exception("canlı takip WebSocket'i beklenmedik hatayla kapandı (rezervasyon=%s)", code[:12])
        await _ws_close(websocket, 1011)
    finally:
        if pending:
            _ws_slots.release_pending(ip)
        if auth is not None:
            _ws_slots.release(auth)


async def _ws_close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except (RuntimeError, WebSocketDisconnect):
        pass  # istemci zaten kapatmış
