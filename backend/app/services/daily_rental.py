"""K-29 şoförlü günlük kiralama: fiyat teklifi.

Müşteri başlangıç noktasını (otel), ilk günün başlangıç saatini, gün sayısını, paketi (tam gün / yarım gün) ve
araç tipini seçer. Her gün bir bacaktır: alış ve bırakış başlangıç noktasıdır, süre paket saatidir, mesafe paketin
km sınırıdır. Gün fiyatı geçerli `DailyRate` sürümünden gelir (EUR), müşteri para birimine çevrilir ve 5'in katına
yuvarlanır; toplam gün fiyatı x gün sayısıdır (her bacak aynı tutar). Saat ve km aşımı bilgi amaçlıdır, otomatik
tahsil edilmez.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.currency import currency_for_country
from app.errors import DomainError, NotFound, ServiceUnavailable
from app.models import DailyRate, ExchangeRate, VehicleType
from app.models.enums import Currency, DailyPackage, ServiceType
from app.pricing import round_up_to_step
from app.services import system_settings
from app.services.quotes import (
    LegPlan,
    Place,
    Quote,
    _active_at,
    _convert,
    _point,
    _region,
    active_pricing_rule,
    latest_exchange_rate,
)

MAX_DAYS = 14


@dataclass(frozen=True)
class DailyQuoteInput:
    pickup: Place
    vehicle_type_code: str
    start_at: datetime
    days: int
    package: DailyPackage
    passenger_count: int
    luggage_count: int
    country_code: str | None


@dataclass(frozen=True)
class PackageTerms:
    """Bir paketin günlük sınırları ve fiyatları (müşteri para biriminde)."""

    hours: int
    km: int
    day_price: Decimal
    extra_hour_price: Decimal
    extra_km_price: Decimal


def active_daily_rate(db: Session, vehicle_type_id: int, at: datetime) -> DailyRate:
    rate = db.scalar(
        select(DailyRate)
        .where(DailyRate.vehicle_type_id == vehicle_type_id, *_active_at(DailyRate, at))
        .order_by(DailyRate.valid_from.desc(), DailyRate.id.desc())
        .limit(1)
    )
    if rate is None:
        raise ServiceUnavailable("bu araç tipi için günlük kiralama fiyatı tanımlı değil",
                                 code="daily_rate_unavailable")
    return rate


def package_limits(rate: DailyRate, package: DailyPackage) -> tuple[int, int, Decimal]:
    """(saat, km, gün fiyatı EUR)."""
    if package is DailyPackage.FULL:
        return rate.full_day_hours, rate.full_day_km, rate.full_day_price
    return rate.half_day_hours, rate.half_day_km, rate.half_day_price


def extra_price(amount_eur: Decimal, currency: Currency, fx: ExchangeRate | None) -> Decimal:
    """Aşım ücretleri küçük tutarlardır; 5'in katına yuvarlanmaz, kuruşa yuvarlanır (bilgi amaçlı)."""
    if currency is Currency.EUR:
        return amount_eur
    if fx is None:
        raise ServiceUnavailable("TRY kuru tanımlı değil")
    return (amount_eur * fx.rate).quantize(Decimal("0.01"))


def terms(db: Session, rate: DailyRate, package: DailyPackage, currency: Currency,
          fx: ExchangeRate | None) -> PackageTerms:
    hours, km, price_eur = package_limits(rate, package)
    if currency is Currency.EUR:
        day_price = round_up_to_step(price_eur, Decimal("5"))
    else:
        try_step = Decimal(str(system_settings.get(db, "try_rounding_step")))
        day_price = _convert(price_eur, currency, fx, try_step)
    return PackageTerms(hours=hours, km=km, day_price=day_price,
                        extra_hour_price=extra_price(rate.extra_hour_price, currency, fx),
                        extra_km_price=extra_price(rate.extra_km_price, currency, fx))


def customer_currency(db: Session, country_code: str | None, now: datetime) -> tuple[Currency, ExchangeRate | None]:
    currency = currency_for_country(country_code)
    fx = latest_exchange_rate(db, now) if currency is Currency.TRY else None
    if currency is Currency.TRY and fx is None:
        raise ServiceUnavailable("TRY kuru tanımlı değil")
    return currency, fx


def build_daily_quote(db: Session, req: DailyQuoteInput, *, now: datetime) -> Quote:
    if not 1 <= req.days <= MAX_DAYS:
        raise DomainError(f"gün sayısı 1 ile {MAX_DAYS} arasında olmalı", code="invalid_days")
    vt = db.scalar(select(VehicleType).where(VehicleType.code == req.vehicle_type_code))
    if vt is None or not vt.is_active:
        raise NotFound("araç tipi bulunamadı", code="vehicle_type_not_found")
    if req.passenger_count > vt.capacity:
        raise DomainError("yolcu sayısı araç kapasitesini aşıyor", code="capacity_exceeded")
    if req.luggage_count > vt.luggage_capacity:
        raise DomainError("bagaj sayısı araç kapasitesini aşıyor", code="luggage_exceeded")
    region = _region(db, req.pickup.region_id)
    _point(req.pickup, region)  # adres bölgenin içinde mi (yoksa address_outside_region)

    rate = active_daily_rate(db, vt.id, now)
    currency, fx = customer_currency(db, req.country_code, now)
    t = terms(db, rate, req.package, currency, fx)
    _, _, day_eur = package_limits(rate, req.package)
    # EUR karşılığı, müşteriye uygulanan yuvarlanmış gün fiyatıyla tutarlı olsun (EUR'da tahsil edilen tutar).
    day_eur = round_up_to_step(day_eur, Decimal("5"))

    legs = tuple(
        LegPlan(
            pickup_region=region,
            dropoff_region=region,
            pickup=req.pickup,
            dropoff=req.pickup,
            pickup_at=req.start_at + timedelta(days=i),
            distance_km=Decimal(t.km),
            duration_minutes=t.hours * 60,
            price=t.day_price,
            route_polyline=None,
        )
        for i in range(req.days)
    )
    price = t.day_price * req.days
    return Quote(
        vehicle_type=vt,
        legs=legs,
        price_eur=day_eur * req.days,
        price=price,
        guarantee_fee=Decimal("0"),
        total=price,
        currency=currency,
        # Rezervasyon şemasında transfer fiyat kuralı zorunlu alandır; günlük kiralamada hesaba girmez, yalnızca
        # o anki sürüm kayıt için tutulur. Dondurulan asıl fiyat `daily_rate`.
        pricing_rule=active_pricing_rule(db, vt.id, now),
        discount=None,
        exchange_rate=fx,
        service_type=ServiceType.DAILY,
        daily_rate=rate,
        daily_package=req.package,
    )


def check_lead_time(db: Session, start_at: datetime, now: datetime) -> None:
    hours = int(system_settings.get(db, "daily_min_lead_hours"))
    if start_at < now + timedelta(hours=hours):
        raise DomainError(f"günlük kiralama en az {hours} saat önceden yapılmalı",
                          code="daily_lead_time_too_short", details={"hours": hours})
