"""Fiyat teklifi: veritabanındaki geçerli kuralları yükler, mesafeyi hesaplar,
saf `app.pricing` fonksiyonlarıyla fiyatı üretir."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import pricing
from app.config import get_settings
from app.currency import convert_eur_price, currency_for_country
from app.errors import DomainError, NotFound, ServiceUnavailable
from app.models import (
    ExchangeRate,
    PricingRule,
    Region,
    RoundTripDiscount,
    VehicleType,
)
from app.models.enums import Currency
from app.pricing import round_up_to_step
from app.providers.routing import Point, Route, RoutingProvider, haversine_km
from app.services import system_settings


@dataclass(frozen=True)
class Place:
    region_id: int
    lat: Decimal | None = None
    lng: Decimal | None = None
    address: str | None = None


@dataclass(frozen=True)
class QuoteInput:
    pickup: Place
    dropoff: Place
    vehicle_type_code: str
    pickup_at: datetime
    return_pickup_at: datetime | None
    passenger_count: int
    luggage_count: int
    country_code: str | None
    with_guarantee: bool = False


@dataclass(frozen=True)
class LegPlan:
    pickup_region: Region
    dropoff_region: Region
    pickup: Place
    dropoff: Place
    pickup_at: datetime
    distance_km: Decimal
    duration_minutes: int
    price: Decimal  # müşteri para biriminde


@dataclass(frozen=True)
class Quote:
    vehicle_type: VehicleType
    legs: tuple[LegPlan, ...]
    price_eur: Decimal
    price: Decimal  # yolculuk ücreti, müşteri para biriminde
    guarantee_fee: Decimal
    total: Decimal
    currency: Currency
    pricing_rule: PricingRule
    discount: RoundTripDiscount | None
    exchange_rate: ExchangeRate | None

    @property
    def is_round_trip(self) -> bool:
        return len(self.legs) == 2


def _active_at(model, at: datetime):
    return (
        model.is_active.is_(True),
        model.valid_from <= at,
        or_(model.valid_to.is_(None), model.valid_to > at),
    )


def active_pricing_rule(db: Session, vehicle_type_id: int, at: datetime) -> PricingRule:
    rule = db.scalar(
        select(PricingRule)
        .where(PricingRule.vehicle_type_id == vehicle_type_id, *_active_at(PricingRule, at))
        .order_by(PricingRule.valid_from.desc(), PricingRule.id.desc())
        .limit(1)
    )
    if rule is None:
        raise ServiceUnavailable("bu araç tipi için fiyat kuralı tanımlı değil")
    return rule


def active_round_trip_discount(db: Session, at: datetime) -> RoundTripDiscount | None:
    return db.scalar(
        select(RoundTripDiscount)
        .where(*_active_at(RoundTripDiscount, at))
        .order_by(RoundTripDiscount.valid_from.desc(), RoundTripDiscount.id.desc())
        .limit(1)
    )


def latest_exchange_rate(db: Session, at: datetime) -> ExchangeRate | None:
    return db.scalar(
        select(ExchangeRate)
        .where(ExchangeRate.quote == "TRY", ExchangeRate.valid_from <= at)
        .order_by(ExchangeRate.valid_from.desc())
        .limit(1)
    )


def _region(db: Session, region_id: int) -> Region:
    region = db.get(Region, region_id)
    if region is None or not region.is_active:
        raise NotFound("bölge hizmet alanında değil", code="region_not_served")
    return region


def _point(place: Place, region: Region) -> Point:
    if place.lat is None or place.lng is None:
        return Point(region.latitude, region.longitude)
    point = Point(place.lat, place.lng)
    max_km = get_settings().region_max_radius_km
    if haversine_km(point, Point(region.latitude, region.longitude)) > max_km:
        raise DomainError("adres seçilen bölgenin dışında", code="address_outside_region")
    return point


# Aynı ilçe içinde alış ve bırakış bundan yakınsa aynı nokta sayılır.
SAME_PLACE_KM = Decimal("0.3")
_CENTROID_ROUTES: dict[tuple, Route] = {}


def _centroid(region: Region) -> Point:
    return Point(region.latitude, region.longitude)


def _price_route(router: RoutingProvider, a: Region, b: Region, origin: Point, destination: Point) -> Route:
    """Fiyat mesafesi ilçe bazlıdır (fiyatlandirma.md):
    farklı bölgeler arasında bölge merkezleri, aynı bölge içinde gerçek noktalar kullanılır.
    Merkezler arası rota sabit olduğu için önbelleğe alınır (aynı ilçe çifti aynı fiyatı alır)."""
    if a.id == b.id:
        return router.route(origin, destination)
    key = (type(router).__name__, a.id, a.latitude, a.longitude, b.id, b.latitude, b.longitude)
    if key not in _CENTROID_ROUTES:
        if len(_CENTROID_ROUTES) > 5000:
            _CENTROID_ROUTES.clear()
        _CENTROID_ROUTES[key] = router.route(_centroid(a), _centroid(b))
    return _CENTROID_ROUTES[key]


def _convert(amount_eur: Decimal, currency: Currency, rate: ExchangeRate | None, step: Decimal) -> Decimal:
    return convert_eur_price(amount_eur, currency, rate.rate if rate else None, step)


def build_quote(
    db: Session, req: QuoteInput, *, router: RoutingProvider, now: datetime
) -> Quote:
    vt = db.scalar(select(VehicleType).where(VehicleType.code == req.vehicle_type_code))
    if vt is None or not vt.is_active:
        raise NotFound("araç tipi bulunamadı", code="vehicle_type_not_found")
    if req.passenger_count > vt.capacity:
        raise DomainError("yolcu sayısı araç kapasitesini aşıyor", code="capacity_exceeded")
    if req.luggage_count > vt.luggage_capacity:
        raise DomainError("bagaj sayısı araç kapasitesini aşıyor", code="luggage_exceeded")
    pickup_region = _region(db, req.pickup.region_id)
    dropoff_region = _region(db, req.dropoff.region_id)
    origin = _point(req.pickup, pickup_region)
    destination = _point(req.dropoff, dropoff_region)
    if pickup_region.id == dropoff_region.id and haversine_km(origin, destination) < SAME_PLACE_KM:
        raise DomainError("alış ve bırakış noktası aynı olamaz", code="same_place")

    outbound = _price_route(router, pickup_region, dropoff_region, origin, destination)
    routes = [outbound]
    if req.return_pickup_at is not None:
        earliest_return = req.pickup_at + timedelta(minutes=outbound.duration_minutes)
        if req.return_pickup_at < earliest_return:
            raise DomainError("dönüş saati gidiş varışından önce olamaz", code="invalid_return_time")
        routes.append(_price_route(router, dropoff_region, pickup_region, destination, origin))

    rule = active_pricing_rule(db, vt.id, now)
    discount = active_round_trip_discount(db, now) if len(routes) == 2 else None
    domain_rule = pricing.PricingRule(
        base_price_per_km=rule.base_price_per_km,
        minimum_price=rule.minimum_price,
        rounding_step=rule.rounding_step,
        vehicle_multiplier=vt.price_multiplier,
    )
    domain_discount = (
        pricing.RoundTripDiscount(pricing.DiscountType(discount.type.value), discount.value)
        if discount
        else None
    )
    legs_eur = pricing.quote_legs([r.distance_km for r in routes], domain_rule, domain_discount)

    currency = currency_for_country(req.country_code)
    rate = latest_exchange_rate(db, now) if currency is Currency.TRY else None
    if currency is Currency.TRY and rate is None:
        raise ServiceUnavailable("TRY kuru tanımlı değil")
    try_step = Decimal(str(system_settings.get(db, "try_rounding_step")))
    price = _convert(legs_eur.total, currency, rate, try_step)
    # Bacak payları müşteri para biriminde aynı oranla dağıtılır; kuruş farkı son bacakta.
    leg_prices = [
        (price * p / legs_eur.total).quantize(Decimal("0.01")) for p in legs_eur.leg_prices[:-1]
    ]
    leg_prices.append(price - sum(leg_prices, Decimal("0")))

    s = get_settings()
    guarantee_fee = Decimal("0")
    if req.with_guarantee:
        if not s.guarantee_enabled:
            raise DomainError("tam iade garantisi şu an satışta değil", code="guarantee_unavailable")
        guarantee_fee = _convert(s.guarantee_fee_eur, currency, rate, try_step)
        if currency is Currency.EUR:
            guarantee_fee = round_up_to_step(guarantee_fee, Decimal("5"))

    places = [(req.pickup, req.dropoff, pickup_region, dropoff_region, req.pickup_at)]
    if req.return_pickup_at is not None:
        places.append((req.dropoff, req.pickup, dropoff_region, pickup_region, req.return_pickup_at))
    legs = tuple(
        LegPlan(
            pickup_region=pr,
            dropoff_region=dr,
            pickup=pp,
            dropoff=dp,
            pickup_at=at,
            distance_km=route.distance_km,
            duration_minutes=route.duration_minutes,
            price=leg_price,
        )
        for (pp, dp, pr, dr, at), route, leg_price in zip(places, routes, leg_prices)
    )
    return Quote(
        vehicle_type=vt,
        legs=legs,
        price_eur=legs_eur.total,
        price=price,
        guarantee_fee=guarantee_fee,
        total=price + guarantee_fee,
        currency=currency,
        pricing_rule=rule,
        discount=discount,
        exchange_rate=rate,
    )
