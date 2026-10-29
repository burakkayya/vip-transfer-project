"""Ortak istek/yanıt modelleri. Tutarlar JSON'da metin olarak döner (kuruş kaybı olmasın)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator

from app.models import Booking, BookingLeg
from app.models.enums import (
    BookingStatus,
    BookingType,
    Currency,
    LegStatus,
    RegionType,
)
from app.security.crypto import normalize_phone

MoneyStr = Annotated[Decimal, PlainSerializer(lambda v: f"{v:.2f}", return_type=str)]
SUPPORTED_LOCALES = ("tr", "en", "de", "ru", "fr", "es", "it", "zh", "ja", "ar")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PhoneIn(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


def _locale(v: str) -> str:
    v = v.lower()[:2]
    return v if v in SUPPORTED_LOCALES else "en"


# --- Katalog -----------------------------------------------------------------


class RegionOut(ORM):
    id: int
    code: str
    province: str
    name: str
    type: RegionType
    iata_code: str | None
    latitude: Decimal
    longitude: Decimal


class VehicleTypeOut(ORM):
    id: int
    code: str
    name: str
    capacity: int
    luggage_capacity: int


# --- Fiyat teklifi -----------------------------------------------------------


class PlaceIn(BaseModel):
    """Nokta iki yoldan biriyle verilir:
    - `place_token`: adres aramasından gelen imzalı jeton (bölge ve koordinat backend'de çözülür),
    - `region_id`: doğrudan ilçe veya havalimanı seçimi (ilçe merkezi kullanılır).
    `address` her iki durumda sürücüye gösterilecek açıklamadır (otel adı, oda no vb.)."""

    region_id: int | None = None
    place_token: str | None = Field(default=None, max_length=2000)
    lat: Decimal | None = Field(default=None, ge=-90, le=90)
    lng: Decimal | None = Field(default=None, ge=-180, le=180)
    address: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _one_source(self) -> "PlaceIn":
        if self.region_id is None and not self.place_token:
            raise ValueError("region_id veya place_token gerekli")
        return self


class PlaceSuggestionOut(BaseModel):
    place_id: str
    title: str
    subtitle: str


class PlaceOut(BaseModel):
    place_token: str
    address: str
    lat: Decimal
    lng: Decimal
    region: "RegionOut"


class QuoteIn(BaseModel):
    pickup: PlaceIn
    dropoff: PlaceIn
    vehicle_type_code: str
    pickup_at: datetime
    return_pickup_at: datetime | None = None
    passenger_count: int = Field(ge=1, le=50)
    luggage_count: int = Field(default=0, ge=0, le=50)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    with_guarantee: bool = False

    @field_validator("pickup_at", "return_pickup_at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("saat dilimi belirtilmeli (ör. 2026-06-01T10:00:00+03:00)")
        return v


class QuoteLegOut(BaseModel):
    pickup_region_id: int
    dropoff_region_id: int
    pickup_at: datetime
    distance_km: Decimal
    duration_minutes: int
    price: MoneyStr


class QuoteOut(BaseModel):
    vehicle_type_code: str
    is_round_trip: bool
    legs: list[QuoteLegOut]
    price: MoneyStr
    guarantee_fee: MoneyStr
    total: MoneyStr
    currency: Currency
    guarantee_available: bool


# --- Rezervasyon -------------------------------------------------------------


class FlightIn(BaseModel):
    leg_order: int = Field(ge=1, le=2)
    flight_no: str = Field(pattern=r"^[A-Za-z0-9]{2,3}\s?\d{1,5}[A-Za-z]?$")
    scheduled_at: datetime | None = None


class BookingCreateIn(QuoteIn):
    booking_type: BookingType = BookingType.SCHEDULED
    expected_total: Decimal
    passenger_name: str = Field(min_length=2, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    flights: list[FlightIn] = Field(default_factory=list, max_length=2)
    locale: str = "tr"
    # Ekran 5: KVKK aydınlatma ve mesafeli satış ön bilgilendirmesi onayı zorunlu.
    accept_disclosure: bool
    accept_distance_sales: bool

    @field_validator("locale")
    @classmethod
    def _norm_locale(cls, v: str) -> str:
        return _locale(v)


class FlightOut(ORM):
    flight_no: str
    direction: str
    scheduled_at: datetime | None
    estimated_at: datetime | None


class DriverBrief(BaseModel):
    """Müşteriye gösterilen sürücü bilgisi: yalnızca ad ve araç."""

    first_name: str
    vehicle: str
    plate: str


class BookingLegOut(BaseModel):
    id: uuid.UUID
    leg_order: int
    status: LegStatus
    pickup_region: RegionOut
    dropoff_region: RegionOut
    pickup_address: str | None
    dropoff_address: str | None
    pickup_at: datetime
    distance_km: Decimal
    duration_minutes: int | None
    flight: FlightOut | None
    driver: DriverBrief | None

    @classmethod
    def build(cls, leg: BookingLeg) -> "BookingLegOut":
        driver = None
        if leg.driver is not None and leg.vehicle is not None:
            driver = DriverBrief(
                first_name=leg.driver.full_name.split()[0],
                vehicle=f"{leg.vehicle.brand} {leg.vehicle.model}",
                plate=leg.vehicle.plate,
            )
        return cls(
            id=leg.id,
            leg_order=leg.leg_order,
            status=leg.status,
            pickup_region=RegionOut.model_validate(leg.pickup_region),
            dropoff_region=RegionOut.model_validate(leg.dropoff_region),
            pickup_address=leg.pickup_address,
            dropoff_address=leg.dropoff_address,
            pickup_at=leg.pickup_at,
            distance_km=leg.distance_km,
            duration_minutes=leg.duration_minutes,
            flight=FlightOut.model_validate(leg.flight) if leg.flight else None,
            driver=driver,
        )


class BookingOut(BaseModel):
    id: uuid.UUID
    booking_code: str
    booking_type: BookingType
    status: BookingStatus
    vehicle_type: VehicleTypeOut
    passenger_name: str
    passenger_count: int
    luggage_count: int
    is_round_trip: bool
    note: str | None
    quoted_price: MoneyStr
    guarantee_fee: MoneyStr
    total_amount: MoneyStr
    currency: Currency
    created_at: datetime
    cancelled_at: datetime | None
    legs: list[BookingLegOut]

    @classmethod
    def build(cls, b: Booking) -> "BookingOut":
        return cls(
            id=b.id,
            booking_code=b.booking_code,
            booking_type=b.booking_type,
            status=b.status,
            vehicle_type=VehicleTypeOut.model_validate(b.vehicle_type),
            passenger_name=b.passenger_name,
            passenger_count=b.passenger_count,
            luggage_count=b.luggage_count,
            is_round_trip=b.is_round_trip,
            note=b.note,
            quoted_price=b.quoted_price,
            guarantee_fee=b.guarantee_fee,
            total_amount=b.total_amount,
            currency=b.currency,
            created_at=b.created_at,
            cancelled_at=b.cancelled_at,
            legs=[BookingLegOut.build(leg) for leg in b.legs],
        )


class RefundQuoteOut(BaseModel):
    hours_left: Decimal
    refund_percent: int
    refund_amount: MoneyStr
    guarantee_applied: bool
    currency: Currency


class CancelIn(BaseModel):
    reason: str = Field(default="müşteri iptali", max_length=500)


class CheckoutOut(BaseModel):
    payment_id: uuid.UUID
    iframe_url: str
    amount: MoneyStr
    currency: Currency


class DateRange(BaseModel):
    valid_from: datetime
    valid_to: datetime | None = None


class DocumentOut(ORM):
    id: uuid.UUID
    owner_type: str
    owner_id: uuid.UUID
    doc_type: str
    content_type: str
    valid_until: date | None
    status: str
    created_at: datetime
