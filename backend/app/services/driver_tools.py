"""Sürücü araçları (K-63).

- Kanıtlı bekleme: "Vardım" konum ve zamanla kaydedilir; ücretsiz bekleme süresi dolunca ve sürücü alış
  noktasındayken "Yolcu gelmedi" denebilir. Yolculuk tamamlanmış sayılır, sürücü hakedişini alır, müşteriye
  bildirilir (iade yok, K-14). Kanıt (konum, zaman) yolculuk olaylarında saklanır, admin görür.
- Çıkış önerisi: alış saati ya da uçuşun tahmini inişi ile sürücünün konumundan tahmini sürüş süresi
  (ücretsiz kuş uçuşu tahmini) üzerinden "en geç şu saatte yola çıkın".
- Günlük plan: seçilen günün işleri, tahmini kazanç ve varış bölgesinden dönüş işi önerisi. Akşam
  ertesi günün özeti sürücüye bildirilir.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, NotFound
from app.localtime import LOCAL_TZ, local_date
from app.models import BookingLeg, Driver, TripEvent, TripUpdate
from app.models.enums import Currency, LegStatus, RegionType, TripEventType
from app.providers.routing import Point, haversine_km
from app.services import audit, dispatch, eta, trip_updates
from app.services.quotes import latest_exchange_rate

PLAN_STATUSES = (LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED, LegStatus.COMPLETED)
RETURN_GAP = timedelta(minutes=20)
RETURN_WINDOW = timedelta(hours=4)


def driver_amount(leg: BookingLeg) -> Decimal:
    b = leg.booking
    return leg.leg_price - (leg.leg_price * b.commission_rate).quantize(Decimal("0.01"))


# --- Kanıtlı bekleme ve "yolcu gelmedi" ----------------------------------------------


def is_airport_pickup(leg: BookingLeg) -> bool:
    return leg.pickup_region.type is RegionType.AIRPORT


def expected_at(leg: BookingLeg) -> datetime:
    """Yolcunun alış noktasında olması beklenen an: havalimanında uçuş inişi + çıkış süresi, yoksa alış saati."""
    s = get_settings()
    fi = leg.flight
    if is_airport_pickup(leg) and fi is not None and fi.estimated_at is not None:
        return max(leg.pickup_at, fi.estimated_at + timedelta(minutes=s.airport_exit_minutes))
    return leg.pickup_at


def no_show_after(leg: BookingLeg) -> datetime | None:
    """"Yolcu gelmedi" bu andan sonra denebilir (sürücü vardıktan ve ücretsiz bekleme bittikten sonra)."""
    if leg.arrived_at is None:
        return None
    s = get_settings()
    wait = s.no_show_wait_airport_minutes if is_airport_pickup(leg) else s.no_show_wait_minutes
    return max(leg.arrived_at, expected_at(leg)) + timedelta(minutes=wait)


def pickup_radius_m(leg: BookingLeg) -> int:
    s = get_settings()
    precise = leg.pickup_lat is not None and leg.pickup_lng is not None
    return s.no_show_radius_m if precise else s.trip_finish_region_radius_m


def mark_no_show(db: Session, driver: Driver, leg: BookingLeg, at: Point, now: datetime) -> None:
    if leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    if leg.status is not LegStatus.ARRIVED:
        raise Conflict("önce alış noktasına vardığınızı bildirin", code="invalid_transition")
    unlock = no_show_after(leg)
    if unlock is None or now < unlock:
        raise Conflict("ücretsiz bekleme süresi dolmadı", code="wait_not_over",
                       details={"no_show_after": unlock.isoformat() if unlock else None})
    distance = int(haversine_km(at, eta.pickup_point(leg)) * 1000)
    radius = pickup_radius_m(leg)
    if distance > radius:
        raise DomainError(f"alış noktasına {distance} m uzaktasınız; {radius} m içinde olmalısınız",
                          code="too_far_from_pickup")
    leg.status = LegStatus.COMPLETED
    leg.no_show_at = now
    db.add(TripEvent(booking_leg_id=leg.id, event_type=TripEventType.NO_SHOW, actor_id=driver.user_id,
                     latitude=at.lat, longitude=at.lng))
    dispatch._on_leg_finished(db, leg, now)
    trip_updates.to_customer(db, leg, "no_show")
    eta.clear(leg)
    dispatch._refresh_booking_status(leg.booking)
    audit.record(db, actor_id=driver.user_id, action="booking_leg.no_show", entity_type="booking_leg",
                 entity_id=leg.id, changes={"arrived_at": leg.arrived_at, "distance_m": distance,
                                            "waited_min": int((now - leg.arrived_at).total_seconds() // 60)})


# --- Çıkış önerisi ------------------------------------------------------------------


@dataclass(frozen=True)
class Departure:
    target_at: datetime
    drive_minutes: int
    leave_at: datetime
    based_on_flight: bool


def departure(leg: BookingLeg, at: Point) -> Departure:
    """Sürücünün konumundan alışa tahmini süre (ücretli rota çağrısı yok) ve en geç çıkış saati."""
    target = expected_at(leg)
    minutes = eta.estimate_minutes(at, eta.pickup_point(leg))
    buffer = timedelta(minutes=get_settings().departure_buffer_minutes)
    return Departure(target_at=target, drive_minutes=minutes, leave_at=target - timedelta(minutes=minutes) - buffer,
                     based_on_flight=target != leg.pickup_at)


# --- Günlük plan ---------------------------------------------------------------------


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    return start, start + timedelta(days=1)


def day_legs(db: Session, driver: Driver, day: date) -> list[BookingLeg]:
    start, end = day_bounds(day)
    return list(db.scalars(
        select(BookingLeg).where(BookingLeg.driver_id == driver.id, BookingLeg.status.in_(PLAN_STATUSES),
                                 BookingLeg.pickup_at >= start, BookingLeg.pickup_at < end)
        .order_by(BookingLeg.pickup_at)
    ))


def earnings(db: Session, legs: list[BookingLeg], now: datetime) -> tuple[dict[str, Decimal], Decimal | None]:
    """Para birimine göre tahmini kazanç ve TL karşılığı (kur yoksa None)."""
    by_currency: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for leg in legs:
        by_currency[leg.booking.currency.value] += driver_amount(leg)
    total_try = by_currency.get(Currency.TRY.value, Decimal("0"))
    eur = by_currency.get(Currency.EUR.value, Decimal("0"))
    if eur:
        rate = latest_exchange_rate(db, now)
        if rate is None:
            return dict(by_currency), None
        total_try += (eur * rate.rate).quantize(Decimal("0.01"))
    return dict(by_currency), total_try


def return_suggestions(db: Session, driver: Driver, legs: list[BookingLeg], now: datetime) -> list[BookingLeg]:
    """Havuzdaki açık işlerden, bir işinizin bittiği bölgeden kalkıp bitişten 20 dk - 4 saat sonra başlayanlar."""
    if not legs:
        return []
    windows = []
    for leg in legs:
        done = leg.pickup_at + timedelta(minutes=leg.duration_minutes or 60)
        windows.append((leg.dropoff_region_id, done + RETURN_GAP, done + RETURN_WINDOW))
    out = []
    for job, _ in dispatch.open_jobs(db, driver, now):
        if any(job.pickup_region_id == region and start <= job.pickup_at <= end for region, start, end in windows):
            out.append(job)
    return out[:5]


def send_daily_plans(db: Session, now: datetime) -> int:
    """Akşam: ertesi gün işi olan her sürücüye özet (iş sayısı, ilk alış). Aynı gün için bir kez."""
    tomorrow = local_date(now) + timedelta(days=1)
    start, end = day_bounds(tomorrow)
    legs = list(db.scalars(
        select(BookingLeg).where(BookingLeg.driver_id.is_not(None), BookingLeg.status == LegStatus.ASSIGNED,
                                 BookingLeg.pickup_at >= start, BookingLeg.pickup_at < end)
        .order_by(BookingLeg.pickup_at)
    ))
    by_driver: dict = defaultdict(list)
    for leg in legs:
        by_driver[leg.driver_id].append(leg)
    sent = 0
    for driver_legs in by_driver.values():
        first = driver_legs[0]
        already = db.scalar(select(TripUpdate.id).where(TripUpdate.booking_leg_id == first.id,
                                                        TripUpdate.code == "daily_plan").limit(1))
        if already:
            continue
        trip_updates.to_driver(db, first, "daily_plan", count=len(driver_legs),
                               first=first.pickup_at.astimezone(LOCAL_TZ).strftime("%H:%M"))
        sent += 1
    return sent
