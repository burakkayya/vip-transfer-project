"""Admin: uygulamayı kullanmayan müşteri için manuel kayıt ve rezervasyon (K-54).

Müşteri WhatsApp, telefon vb. kanaldan ulaşır; operasyon personeli müşteriyi ekler, fiyatı sistemle
hesaplar (gerekçeyle değiştirebilir), rezervasyonu açar. Ödeme iki yoldan biriyle alınır: müşteriye giden
ödeme bağlantısı (web, SMS koduyla giriş, kart) veya elle tahsilat kaydı (havale/EFT, nakit, POS).
"""

from __future__ import annotations

import dataclasses
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import select

from app.api.deps import ClientIp, DbSession, FinanceStaff, Now, OpsOrSupport, OpsStaff
from app.api.public import autocomplete as public_autocomplete
from app.api.public import place_details as public_place_details
from app.api.public import quote_out, to_quote_input
from app.api.schemas import (
    BookingCreateIn,
    BookingOut,
    PlaceIn,
    PlaceOut,
    PlaceSuggestionOut,
    QuoteIn,
    QuoteOut,
    RegionOut,
    VehicleTypeOut,
    _locale,
)
from app.errors import DomainError, NotFound
from app.localtime import LOCAL_TZ
from app.models import Booking, Customer, Refund, Region, User, VehicleType
from app.models.enums import BookingChannel, BookingStatus, ManualPaymentMethod
from app.providers.routing import get_routing
from app.security.crypto import blind_index, mask_email, mask_phone, normalize_email, normalize_phone
from app.services import audit, auth, bookings, notifications, payments, quotes

router = APIRouter(tags=["admin:manual-booking"])

# Ödeme bağlantısıyla açılan rezervasyonda varsayılan ve en uzun ödeme süresi.
DEFAULT_PAYMENT_HOURS = 24
MIN_PAYMENT_HOURS = 2
MAX_PAYMENT_HOURS = 72
# Ödeme, ilk alıştan en geç bu kadar önce alınmış olmalı; sonra rezervasyon kendiliğinden iptal olur.
PAYMENT_BEFORE_PICKUP = timedelta(hours=1)
SHARE_LOCALES = ("tr", "en", "de", "ru")


# --- Müşteri -----------------------------------------------------------------


class CustomerCreateIn(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    locale: str = "tr"

    @field_validator("locale")
    @classmethod
    def _norm_locale(cls, v: str) -> str:
        return _locale(v)


def _customer_out(c: Customer, *, just_created: bool = False) -> dict:
    """Ekran 14 kuralı: ad, telefon ve e-posta maskeli döner. Yalnızca personelin az önce yazdığı kayıtta
    (oluşturma yanıtı) ad tam döner; telefonla aramada maskelidir."""
    name = c.full_name if just_created else ((c.full_name[:1] + "***") if c.full_name else None)
    return {
        "id": str(c.id),
        "full_name": name,
        "phone": mask_phone(c.user.phone or ""),
        "email": mask_email(c.email) if c.email else None,
        "country_code": c.country_code,
        "locale": c.locale,
        "currency": c.currency.value,
        "verified": c.verified_at is not None,
        "created_at": c.created_at,
    }


@router.post("/customers", status_code=201)
def create_customer(body: CustomerCreateIn, staff: OpsOrSupport, db: DbSession, ip: ClientIp):
    try:
        phone = normalize_phone(body.phone)
    except ValueError as exc:
        raise DomainError(str(exc), code="invalid_phone") from exc
    customer = auth.create_customer_by_staff(
        db, phone, full_name=body.full_name.strip(),
        email=normalize_email(body.email) if body.email else None,
        country_code=body.country_code, locale=body.locale,
    )
    audit.record(db, actor_id=staff.id, action="customer.admin_create", entity_type="customer",
                 entity_id=customer.id, changes={"country_code": customer.country_code, "locale": customer.locale},
                 ip=ip)
    db.commit()
    return _customer_out(customer, just_created=True)


@router.get("/customers/lookup")
def lookup_customer(staff: OpsOrSupport, db: DbSession, phone: Annotated[str, Query(min_length=6, max_length=20)]):
    """Telefonla tam eşleşme (kör indeks). Rezervasyon formu müşteriyi bununla bulur; yoksa 404."""
    try:
        normalized = normalize_phone(phone)
    except ValueError as exc:
        raise DomainError(str(exc), code="invalid_phone") from exc
    c = db.scalar(select(Customer).join(User, User.id == Customer.user_id)
                  .where(User.phone_hash == blind_index(normalized)))
    if c is None or c.deleted_at is not None:
        raise NotFound("bu telefonla müşteri yok")
    return _customer_out(c)


# --- Katalog, adres ve fiyat (BFF yalnızca /admin/* iletir) -------------------


@router.get("/booking-catalog")
def booking_catalog(staff: OpsOrSupport, db: DbSession):
    regions = db.scalars(select(Region).where(Region.is_active.is_(True))
                         .order_by(Region.province, Region.type, Region.name)).all()
    types = db.scalars(select(VehicleType).where(VehicleType.is_active.is_(True))
                       .order_by(VehicleType.capacity)).all()
    return {
        "regions": [RegionOut.model_validate(r) for r in regions],
        "vehicle_types": [VehicleTypeOut.model_validate(v) for v in types],
        "channels": [c.value for c in BookingChannel],
        "payment_methods": [m.value for m in ManualPaymentMethod],
        "default_payment_hours": DEFAULT_PAYMENT_HOURS,
        "max_payment_hours": MAX_PAYMENT_HOURS,
    }


@router.get("/places/autocomplete", response_model=list[PlaceSuggestionOut])
def places_autocomplete(staff: OpsOrSupport, ip: ClientIp,
                        q: Annotated[str, Query(min_length=2, max_length=120)],
                        session: str | None = None, lang: str = "tr"):
    return public_autocomplete(ip=ip, q=q, session=session, lang=lang)


@router.get("/places/{place_id}", response_model=PlaceOut)
def places_details(place_id: str, staff: OpsOrSupport, db: DbSession, ip: ClientIp,
                   session: str | None = None, lang: str = "tr"):
    return public_place_details(place_id=place_id, db=db, ip=ip, session=session, lang=lang)


class AdminQuoteIn(BaseModel):
    """Tüm aktif araç tipleri için fiyat. `vehicle_type_code` verilmez; kapasiteye uymayan tip hata notuyla döner."""

    pickup: PlaceIn
    dropoff: PlaceIn
    pickup_at: datetime
    return_pickup_at: datetime | None = None
    passenger_count: int = Field(ge=1, le=50)
    luggage_count: int = Field(default=0, ge=0, le=50)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)

    @field_validator("pickup_at", "return_pickup_at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("saat dilimi belirtilmeli (ör. 2026-06-01T10:00:00+03:00)")
        return v


@router.post("/quotes")
def admin_quotes(body: AdminQuoteIn, staff: OpsOrSupport, db: DbSession, now: Now):
    types = db.scalars(select(VehicleType).where(VehicleType.is_active.is_(True))
                       .order_by(VehicleType.capacity)).all()
    out: list[dict] = []
    for vt in types:
        req = QuoteIn(**body.model_dump(), vehicle_type_code=vt.code)
        try:
            q = quotes.build_quote(db, to_quote_input(db, req), router=get_routing(), now=now)
        except DomainError as exc:
            if exc.code in ("capacity_exceeded", "luggage_exceeded"):
                out.append({"vehicle_type_code": vt.code, "error": exc.code, "message": str(exc)})
                continue
            raise
        out.append({"vehicle_type_code": vt.code, "quote": QuoteOut.model_validate(quote_out(q))})
    return out


# --- Rezervasyon ---------------------------------------------------------------


class ManualPaymentIn(BaseModel):
    method: ManualPaymentMethod
    amount: Decimal = Field(gt=0, decimal_places=2)
    reference: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=500)


class AdminBookingIn(BookingCreateIn):
    customer_id: uuid.UUID
    channel: BookingChannel
    # Müşteriye aydınlatma metni ve mesafeli satış ön bilgilendirmesi kanal üzerinden iletildi ve onay alındı.
    consent_confirmed: bool
    # Boşsa sistem fiyatı. Doluysa gerekçe zorunlu.
    override_total: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    override_reason: str | None = Field(default=None, max_length=500)
    # Ödeme bağlantısının geçerli kalacağı saat. `payment` doluysa kullanılmaz.
    payment_hours: int = Field(default=DEFAULT_PAYMENT_HOURS, ge=MIN_PAYMENT_HOURS, le=MAX_PAYMENT_HOURS)
    # Ödeme alındıysa (havale, nakit, POS) rezervasyon hemen onaylanır.
    payment: ManualPaymentIn | None = None
    send_sms: bool = True
    # Müşteri formundaki onay alanları admin girişinde `consent_confirmed` ile karşılanır.
    accept_disclosure: bool = True
    accept_distance_sales: bool = True

    @model_validator(mode="after")
    def _reason(self) -> "AdminBookingIn":
        if self.override_total is not None and not (self.override_reason and self.override_reason.strip()):
            raise ValueError("fiyat değiştirildiyse gerekçe yazılmalı")
        return self


def payment_due(first_pickup: datetime, now: datetime, hours: int) -> datetime:
    due = min(now + timedelta(hours=hours), first_pickup - PAYMENT_BEFORE_PICKUP)
    # Yakın saatli işte (ör. 1 saat içinde) bağlantı en az 15 dk açık kalır; süre dolarsa iptal olur.
    return max(due, now + timedelta(minutes=15))


_SHARE = {
    "tr": ("Merhaba {name}, Getaway Transfers rezervasyonunuz oluşturuldu.\nKod: {code}\n"
           "{legs}\nAraç: {vehicle}, {pax} yolcu, {lug} bagaj\nTutar: {total} {currency}\n{pay}"),
    "en": ("Hello {name}, your Getaway Transfers booking has been created.\nCode: {code}\n"
           "{legs}\nVehicle: {vehicle}, {pax} passengers, {lug} bags\nTotal: {total} {currency}\n{pay}"),
    "de": ("Hallo {name}, Ihre Getaway Transfers Buchung wurde erstellt.\nCode: {code}\n"
           "{legs}\nFahrzeug: {vehicle}, {pax} Personen, {lug} Gepäck\nBetrag: {total} {currency}\n{pay}"),
    "ru": ("Здравствуйте, {name}! Ваше бронирование Getaway Transfers создано.\nКод: {code}\n"
           "{legs}\nАвтомобиль: {vehicle}, пассажиров: {pax}, багаж: {lug}\nСумма: {total} {currency}\n{pay}"),
}
_PAY = {
    "tr": ("Ödeme için (telefonunuza gelen SMS koduyla giriş yapın): {url}\nSon ödeme: {due}",
           "Ödemeniz alındı, rezervasyonunuz onaylandı. Detay: {url}"),
    "en": ("To pay (sign in with the SMS code sent to your phone): {url}\nPay by: {due}",
           "Payment received, your booking is confirmed. Details: {url}"),
    "de": ("Zur Zahlung (Anmeldung mit SMS-Code an Ihr Telefon): {url}\nZahlbar bis: {due}",
           "Zahlung erhalten, Ihre Buchung ist bestätigt. Details: {url}"),
    "ru": ("Для оплаты (войдите по SMS-коду на ваш телефон): {url}\nОплатить до: {due}",
           "Оплата получена, бронирование подтверждено. Подробности: {url}"),
}


def share_text(b: Booking) -> str:
    """WhatsApp vb. kanala yapıştırılacak özet (rezervasyon dilinde; desteklenmeyen dilde İngilizce)."""
    loc = b.locale if b.locale in SHARE_LOCALES else "en"
    fmt = "%d.%m.%Y %H:%M"
    legs = "\n".join(
        f"{leg.pickup_at.astimezone(LOCAL_TZ).strftime(fmt)} "
        f"{leg.pickup_address or leg.pickup_region.name} → {leg.dropoff_address or leg.dropoff_region.name}"
        for leg in b.legs
    )
    url = notifications.booking_url(b)
    if b.status is BookingStatus.PENDING_PAYMENT:
        due = b.payment_due_at.astimezone(LOCAL_TZ).strftime(fmt) if b.payment_due_at else "-"
        pay = _PAY[loc][0].format(url=url + "/pay", due=due)
    else:
        pay = _PAY[loc][1].format(url=url)
    return _SHARE[loc].format(
        name=b.passenger_name, code=b.booking_code, legs=legs, vehicle=b.vehicle_type.name,
        pax=b.passenger_count, lug=b.luggage_count, total=f"{b.total_amount:.2f}", currency=b.currency.value,
        pay=pay,
    )


def manual_info(b: Booking) -> dict:
    """Rezervasyon detayında admin girişi bilgisi ve paylaşım metni."""
    return {
        "source": b.source.value,
        "channel": b.channel.value if b.channel else None,
        "created_by_id": str(b.created_by_id) if b.created_by_id else None,
        "payment_due_at": b.payment_due_at,
        "system_total_amount": f"{b.system_total_amount:.2f}" if b.system_total_amount is not None else None,
        "price_override_reason": b.price_override_reason,
        "booking_url": notifications.booking_url(b),
        "pay_url": notifications.booking_url(b) + "/pay",
        "share_text": share_text(b),
    }


@router.post("/bookings", status_code=201)
def create_manual_booking(body: AdminBookingIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    if not body.consent_confirmed:
        raise DomainError(
            "müşteriye aydınlatma metni ve mesafeli satış bilgilendirmesi iletilip onayı alınmalı",
            code="consent_required",
        )
    customer = db.get(Customer, body.customer_id)
    if customer is None or customer.deleted_at is not None:
        raise NotFound("müşteri bulunamadı")
    req = to_quote_input(db, body)
    if req.country_code is None:
        req = dataclasses.replace(req, country_code=customer.country_code)
    q = quotes.build_quote(db, req, router=get_routing(), now=now)
    entry = bookings.AdminEntry(
        staff_id=staff.id,
        channel=body.channel,
        payment_due_at=payment_due(q.legs[0].pickup_at, now, body.payment_hours),
        override_total=body.override_total,
        override_reason=body.override_reason,
    )
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
        admin=entry,
    )
    if body.payment is not None:
        # Onay SMS'i (booking_confirmed) ödeme kaydında gider; ayrıca bağlantı SMS'i gönderilmez.
        payments.record_manual_payment(
            db, booking, staff_id=staff.id, method=body.payment.method, amount=body.payment.amount,
            reference=body.payment.reference, note=body.payment.note, now=now, ip=ip,
        )
    elif body.send_sms:
        notifications.notify_customer(db, booking, "booking_created_admin")
    db.commit()
    return {"booking": BookingOut.build(booking), "manual": manual_info(booking)}


@router.post("/bookings/{booking_id}/manual-payment")
def manual_payment(booking_id: uuid.UUID, body: ManualPaymentIn, staff: OpsStaff, db: DbSession,
                   ip: ClientIp, now: Now):
    b = db.get(Booking, booking_id)
    if b is None:
        raise NotFound("rezervasyon bulunamadı")
    p = payments.record_manual_payment(
        db, b, staff_id=staff.id, method=body.method, amount=body.amount,
        reference=body.reference, note=body.note, now=now, ip=ip,
    )
    db.commit()
    return {"payment_id": str(p.id), "booking": BookingOut.build(b)}


@router.post("/bookings/{booking_id}/resend-sms", status_code=204)
def resend_sms(booking_id: uuid.UUID, staff: OpsStaff, db: DbSession, ip: ClientIp):
    b = db.get(Booking, booking_id)
    if b is None:
        raise NotFound("rezervasyon bulunamadı")
    if b.status is not BookingStatus.PENDING_PAYMENT:
        raise DomainError("ödeme bekleyen rezervasyon değil", code="payment_not_expected")
    notifications.notify_customer(db, b, "booking_created_admin")
    audit.record(db, actor_id=staff.id, action="booking.resend_payment_sms", entity_type="booking",
                 entity_id=b.id, ip=ip)
    db.commit()


class ManualRefundIn(BaseModel):
    reference: str = Field(min_length=2, max_length=100)


@router.post("/refunds/{refund_id}/complete-manual")
def complete_manual_refund(refund_id: uuid.UUID, body: ManualRefundIn, staff: FinanceStaff, db: DbSession,
                           ip: ClientIp):
    """Elle tahsilatın iadesi (havale/nakit) muhasebe tarafından yapıldıktan sonra kapatılır."""
    refund = db.get(Refund, refund_id, with_for_update=True)
    if refund is None:
        raise NotFound("iade bulunamadı")
    bookings.complete_manual_refund(db, refund, reference=body.reference)
    audit.record(db, actor_id=staff.id, action="refund.manual_complete", entity_type="refund",
                 entity_id=refund.id, changes={"reference": body.reference}, ip=ip)
    db.commit()
    return {"status": refund.status.value}

