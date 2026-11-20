"""Ortak istek/yanıt modelleri. Tutarlar JSON'da metin olarak döner (kuruş kaybı olmasın)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator

from app.config import get_settings
from app.models import Booking, BookingLeg
from app.models.enums import (
    BookingStatus,
    DailyPackage,
    ServiceType,
    BookingType,
    Currency,
    LegStatus,
    RegionType,
)
from app.security.crypto import normalize_phone
from app.services import route_line

MoneyStr = Annotated[Decimal, PlainSerializer(lambda v: f"{v:.2f}", return_type=str)]
# K-77: on iki dil. Arapça sağdan sola yazılır; zh basitleştirilmiş Çincedir.
SUPPORTED_LOCALES = ("tr", "en", "de", "es", "ru", "fr", "ar", "zh", "ja", "it", "pt", "ko")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PhoneIn(BaseModel):
    # API-09: E.164 en çok 16 karakter; boşluk, tire ve parantezle yazılmış biçime pay bırakılır.
    phone: str = Field(max_length=40)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


def _locale(v: str) -> str:
    v = v.lower()[:2]
    return v if v in SUPPORTED_LOCALES else "en"


# API-09: alış zamanı makul aralıkta olmalı. Alt sınır anlık işin "şimdi" alışına pay bırakır (rezervasyon
# servisi anlık işte en çok 5 dk geçmişi, planlı işte en az scheduled_min_lead_hours ileriyi ayrıca denetler);
# üst sınır booking_max_advance_days. Uç değerler (9999 yılı) böylece hesaplamada OverflowError/500 üretmez.
PICKUP_PAST_TOLERANCE = timedelta(minutes=15)
DB_INT_MAX = 2_147_483_647  # PostgreSQL integer (bölge kimliği)


def validate_pickup_window(v: datetime | None) -> datetime | None:
    """Saat dilimli ve [şimdi - 15 dk, şimdi + booking_max_advance_days] aralığında olmalı. Başka giriş
    modelleri (ör. admin teklif formu) da aynı kuralı bu fonksiyonla uygulayabilir."""
    if v is None:
        return v
    if v.tzinfo is None:
        raise ValueError("saat dilimi belirtilmeli (ör. 2026-06-01T10:00:00+03:00)")
    now = datetime.now(timezone.utc)
    if v < now - PICKUP_PAST_TOLERANCE:
        raise ValueError("alış zamanı geçmişte olamaz")
    max_days = get_settings().booking_max_advance_days
    if v > now + timedelta(days=max_days):
        raise ValueError(f"alış zamanı en fazla {max_days} gün ileri olabilir")
    return v


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
    `address` her iki durumda sürücüye gösterilecek açıklamadır (otel adı, oda no vb.).
    `lat`/`lng` geriye uyumluluk için kabul edilir ama yok sayılır (K-58: fiyat gerçek noktadan
    hesaplandığından koordinat yalnızca imzalı adres jetonundan gelir)."""

    region_id: int | None = Field(default=None, ge=1, le=DB_INT_MAX)
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
    vehicle_type_code: str = Field(max_length=30)  # vehicle_types.code String(30)
    pickup_at: datetime
    return_pickup_at: datetime | None = None
    passenger_count: int = Field(ge=1, le=50)
    luggage_count: int = Field(default=0, ge=0, le=50)
    country_code: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    with_guarantee: bool = False

    @field_validator("pickup_at", "return_pickup_at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        return validate_pickup_window(v)


class DailyQuoteIn(BaseModel):
    """K-29 günlük kiralama teklifi: başlangıç noktası, ilk günün başlangıcı, gün sayısı, paket."""

    pickup: PlaceIn
    vehicle_type_code: str = Field(max_length=30)
    start_at: datetime
    days: int = Field(ge=1, le=14)
    package: DailyPackage = DailyPackage.FULL
    passenger_count: int = Field(ge=1, le=50)
    luggage_count: int = Field(default=0, ge=0, le=50)
    country_code: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")

    @field_validator("start_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        return validate_pickup_window(v)


class DailyDayOut(BaseModel):
    day: int
    start_at: datetime
    price: MoneyStr


class DailyQuoteOut(BaseModel):
    vehicle_type_code: str
    package: DailyPackage
    days: int
    hours_per_day: int
    km_per_day: int
    day_price: MoneyStr
    price: MoneyStr
    total: MoneyStr
    currency: Currency
    extra_hour_price: MoneyStr
    extra_km_price: MoneyStr
    schedule: list[DailyDayOut]


class DailyBookingCreateIn(DailyQuoteIn):
    expected_total: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    passenger_name: str = Field(min_length=2, max_length=120)
    # Gün planı (gidilecek yerler, ara duraklar): sürücü kabulden sonra görür.
    note: str | None = Field(default=None, max_length=500)
    locale: str = Field(default="tr", max_length=10)
    child_seat_count: int = Field(default=0, ge=0, le=4)
    accept_disclosure: bool
    accept_distance_sales: bool

    @field_validator("locale")
    @classmethod
    def _norm_locale(cls, v: str) -> str:
        return _locale(v)


class DailyInfoOut(BaseModel):
    """Rezervasyondaki günlük kiralama koşulları (dondurulan fiyat sürümünden, rezervasyon para biriminde)."""

    package: DailyPackage
    days: int
    hours_per_day: int
    km_per_day: int
    extra_hour_price: MoneyStr
    extra_km_price: MoneyStr

    @classmethod
    def of(cls, b: Booking) -> "DailyInfoOut | None":
        if b.service_type is not ServiceType.DAILY or b.daily_rate is None or b.daily_package is None:
            return None
        from app.services import daily_rental

        hours, km, _ = daily_rental.package_limits(b.daily_rate, b.daily_package)
        return cls(
            package=b.daily_package,
            days=len(b.legs),
            hours_per_day=hours,
            km_per_day=km,
            extra_hour_price=daily_rental.extra_price(b.daily_rate.extra_hour_price, b.currency, b.exchange_rate),
            extra_km_price=daily_rental.extra_price(b.daily_rate.extra_km_price, b.currency, b.exchange_rate),
        )


class RoutePreviewIn(BaseModel):
    pickup: PlaceIn
    dropoff: PlaceIn


class RoutePreviewOut(BaseModel):
    distance_km: Decimal
    duration_minutes: int
    route_polyline: str | None = None  # Google encoded polyline (hassasiyet 5)


class QuoteLegOut(BaseModel):
    pickup_region_id: int
    dropoff_region_id: int
    pickup_at: datetime
    distance_km: Decimal
    duration_minutes: int
    price: MoneyStr
    route_polyline: str | None = None  # Google encoded polyline (hassasiyet 5), harita önizlemesi


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
    # API-09: müşterinin onayladığı toplam; sonlu, negatif değil, en çok 10 tam + 2 ondalık basamak.
    expected_total: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    passenger_name: str = Field(min_length=2, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    flights: list[FlightIn] = Field(default_factory=list, max_length=2)
    locale: str = Field(default="tr", max_length=10)
    # K-62 ekstralar
    child_seat_count: int = Field(default=0, ge=0, le=4)
    market_stop: bool = False
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
    status: str | None = None  # K-60: planlandi, rotarli, havada, indi, iptal, yonlendirildi, bilinmiyor


class DriverBrief(BaseModel):
    """Müşteriye gösterilen sürücü bilgisi: ad, araç, renk, diller ve fotoğraf var mı (K-62 sürücü kartı)."""

    first_name: str
    vehicle: str
    plate: str
    color: str | None = None
    languages: list[str] = []
    has_photo: bool = False

    @classmethod
    def of(cls, leg: BookingLeg) -> "DriverBrief | None":
        if leg.driver is None or leg.vehicle is None:
            return None
        return cls(
            first_name=leg.driver.full_name.split()[0],
            vehicle=f"{leg.vehicle.brand} {leg.vehicle.model}",
            plate=leg.vehicle.plate,
            color=leg.vehicle.color,
            languages=leg.driver.language_list,
            has_photo=bool(leg.driver.photo_key),
        )


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
    route_polyline: str | None = None
    passenger_status: str | None = None

    @classmethod
    def build(cls, leg: BookingLeg, with_route: bool = False) -> "BookingLegOut":
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
            driver=DriverBrief.of(leg),
            route_polyline=route_line.route_polyline(leg) if with_route else None,
            passenger_status=leg.passenger_status,
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
    child_seat_count: int = 0
    market_stop: bool = False
    is_round_trip: bool
    note: str | None
    quoted_price: MoneyStr
    guarantee_fee: MoneyStr
    total_amount: MoneyStr
    currency: Currency
    created_at: datetime
    cancelled_at: datetime | None
    legs: list[BookingLegOut]
    share_active: bool = False
    # Ödeme bekleyen rezervasyonun otomatik iptal anı (admin girişinde rezervasyona yazılı süre, diğerlerinde
    # `pending_payment_minutes` ayarı). Diğer durumlarda boş. İstemci "… saatine kadar ödeyin" gösterir.
    payment_due_at: datetime | None = None
    # K-29: hizmet türü ve günlük kiralama koşulları (transferde None).
    service_type: ServiceType = ServiceType.TRANSFER
    daily: DailyInfoOut | None = None

    @classmethod
    def build(cls, b: Booking, with_route: bool = False, pending_minutes: int | None = None) -> "BookingOut":
        due = None
        if b.status is BookingStatus.PENDING_PAYMENT:
            if b.payment_due_at is not None:
                due = b.payment_due_at
            elif pending_minutes is not None and b.created_at is not None:
                due = b.created_at + timedelta(minutes=pending_minutes)
        return cls(
            payment_due_at=due,
            service_type=b.service_type,
            daily=DailyInfoOut.of(b),
            id=b.id,
            booking_code=b.booking_code,
            booking_type=b.booking_type,
            status=b.status,
            vehicle_type=VehicleTypeOut.model_validate(b.vehicle_type),
            passenger_name=b.passenger_name,
            passenger_count=b.passenger_count,
            luggage_count=b.luggage_count,
            child_seat_count=b.child_seat_count,
            market_stop=b.market_stop,
            is_round_trip=b.is_round_trip,
            note=b.note,
            quoted_price=b.quoted_price,
            guarantee_fee=b.guarantee_fee,
            total_amount=b.total_amount,
            currency=b.currency,
            created_at=b.created_at,
            cancelled_at=b.cancelled_at,
            legs=[BookingLegOut.build(leg, with_route) for leg in b.legs],
            share_active=b.share_token is not None,
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
