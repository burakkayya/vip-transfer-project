"""Uçuş takibi (K-60): havalimanından alışlarda gelen uçuşun tahmini iniş saati.

Zamanlanmış görev her dakika çalışır ama ücretli API'yi yalnızca vadesi gelen uçuş için çağırır.
"Beklenen an" alış saati ile tahmini inişin geç olanıdır (büyük rötarda takip kesilmesin):
beklenen ana `flight_track_hours_before` saat kala başlar, normalde `flight_poll_minutes`, 1 saatten az
kalınca `flight_poll_near_minutes` aralıkla sorgular; beklenen andan 3 saat sonrasına kadar sürer.
Uçuş indi, iptal edildi, yönlendirildi veya art arda `flight_max_misses` kez bulunamadıysa durur;
uçuş başına en fazla `flight_max_checks` sorgu yapılır. Günlük sorgu sayısı Redis sayacıyla
`flight_daily_call_limit` ile sınırlıdır (Redis yoksa sorgu yapılmaz).

Her uçuş ayrı işlemde (commit) yazılır: bir uçuştaki beklenmeyen hata ötekileri ve harcanan sorgunun
kaydını (checked_at) geri almaz.

Sürücüye bildirim: tahmini iniş `flight_notify_shift_minutes` kadar kayınca, uçuş inince, iptal veya
yönlendirmede. Alış saati otomatik değişmez; sürücü ve operasyon tahmini inişi görür.
Log'a uçuş numarası yazılmaz (K-31: uçuş verisi yolculuk bitince silinir), bacak kimliği yazılır.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import redis
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.localtime import LOCAL_TZ, local_date
from app.models import Booking, BookingLeg, FlightInfo
from app.models.enums import BookingStatus, FlightDirection, LegStatus
from app.providers import flights as fl
from app.services import trip_updates

log = logging.getLogger(__name__)

_ACTIVE_LEG = (LegStatus.PENDING, LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED)
_ACTIVE_BOOKING = (BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS)
# Alış saatinden bu kadar uzak planlanmış sefer aynı uçuş sayılmaz (ör. ertesi günün aynı numaralı seferi).
_MAX_SCHEDULE_GAP = timedelta(hours=12)
# Alış bu saatten önceyse (gece yarısından sonra) iniş önceki gün olabilir: ilk sorguda iki gün denenir.
_EARLY_PICKUP_HOUR = 3
_AFTER_EXPECTED = timedelta(hours=3)


def _hhmm(at: datetime | None) -> str:
    return at.astimezone(LOCAL_TZ).strftime("%H:%M") if at else "?"


def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, socket_timeout=2)


def _take_call_budget(now: datetime) -> bool:
    s = get_settings()
    key = f"flight_calls:{local_date(now).isoformat()}"
    try:
        r = _redis()
        used = r.incr(key)
        if used == 1:
            r.expire(key, 2 * 24 * 3600)
        if used == s.flight_daily_call_limit + 1:
            log.error("uçuş takibi: günlük %s sorgu sınırı doldu, bugün takip durdu", s.flight_daily_call_limit)
    except redis.RedisError:
        log.warning("uçuş sorgu sayacı okunamadı; sorgu yapılmadı")
        return False
    return used <= s.flight_daily_call_limit


def _expected(fi: FlightInfo, leg: BookingLeg) -> datetime:
    return max(leg.pickup_at, fi.estimated_at) if fi.estimated_at else leg.pickup_at


def _due(fi: FlightInfo, leg: BookingLeg, now: datetime) -> bool:
    s = get_settings()
    if fi.status in fl.FINAL_STATUSES or fi.check_count >= s.flight_max_checks:
        return False
    expected = _expected(fi, leg)
    if not (expected - timedelta(hours=s.flight_track_hours_before) <= now <= expected + _AFTER_EXPECTED):
        return False
    if fi.checked_at is None:
        return True
    near = expected - now <= timedelta(hours=1)
    minutes = s.flight_poll_near_minutes if near else s.flight_poll_minutes
    return now - fi.checked_at >= timedelta(minutes=minutes)


def _days(fi: FlightInfo, leg: BookingLeg) -> list[date]:
    """Sorgulanacak yerel iniş tarihleri. Sağlayıcıdan planlanan iniş alındıysa onun tarihi."""
    if fi.provider_scheduled_at is not None:
        return [local_date(fi.provider_scheduled_at)]
    pickup_local = leg.pickup_at.astimezone(LOCAL_TZ)
    days = [pickup_local.date()]
    if pickup_local.hour < _EARLY_PICKUP_HOUR:
        days.insert(0, pickup_local.date() - timedelta(days=1))
    return days


def _closest(candidates: list[fl.FlightStatus], pickup_at: datetime) -> fl.FlightStatus | None:
    timed = [c for c in candidates if c.scheduled_at is not None
             and abs(c.scheduled_at - pickup_at) <= _MAX_SCHEDULE_GAP]
    return min(timed, key=lambda c: abs(c.scheduled_at - pickup_at)) if timed else None


def _notify(db: Session, leg: BookingLeg, fi: FlightInfo, previous: str | None) -> None:
    params = {"flight": fi.flight_no, "time": _hhmm(fi.estimated_at), "scheduled": _hhmm(fi.provider_scheduled_at)}
    final_codes = {fl.LANDED: "flight_landed", fl.CANCELLED: "flight_cancelled", fl.DIVERTED: "flight_diverted"}
    if fi.status in final_codes:
        if fi.status != previous:
            trip_updates.to_driver(db, leg, final_codes[fi.status], **params)
        return
    reference = fi.notified_at or fi.provider_scheduled_at
    if fi.estimated_at is None or reference is None:
        return
    shift = abs((fi.estimated_at - reference).total_seconds()) / 60
    if shift >= get_settings().flight_notify_shift_minutes:
        # Sürücü henüz atanmadıysa bildirim gitmez; atanınca ilk sorguda gider.
        if trip_updates.to_driver(db, leg, "flight_delayed", **params) is not None:
            fi.notified_at = fi.estimated_at


def _check(db: Session, fi: FlightInfo, leg: BookingLeg, provider: fl.FlightProvider) -> bool:
    candidates: list[fl.FlightStatus] = []
    for day in _days(fi, leg):
        candidates += provider.arrivals(fi.flight_no, day, leg.pickup_region.iata_code)
    result = _closest(candidates, leg.pickup_at)
    if result is None:
        fi.miss_count += 1
        if fi.miss_count >= get_settings().flight_max_misses:
            fi.status = fl.NOT_FOUND
        return False
    fi.miss_count = 0
    previous = fi.status
    fi.status = result.status
    fi.provider_scheduled_at = result.scheduled_at
    fi.estimated_at = result.estimated_at
    _notify(db, leg, fi, previous)
    return True


def refresh_flights(db: Session, now: datetime, provider: fl.FlightProvider | None = None) -> int:
    provider = provider or fl.get_flights()
    if provider is None:
        return 0
    s = get_settings()
    window_start = now - _AFTER_EXPECTED
    rows = db.execute(
        select(FlightInfo.id, BookingLeg.id)
        .join(BookingLeg, FlightInfo.booking_leg_id == BookingLeg.id)
        .join(Booking, BookingLeg.booking_id == Booking.id)
        .where(
            FlightInfo.direction == FlightDirection.ARRIVAL,
            BookingLeg.status.in_(_ACTIVE_LEG),
            Booking.status.in_(_ACTIVE_BOOKING),
            BookingLeg.pickup_at <= now + timedelta(hours=s.flight_track_hours_before),
            or_(BookingLeg.pickup_at >= window_start, FlightInfo.estimated_at >= window_start),
        )
        .order_by(BookingLeg.pickup_at)
    ).all()
    updated = 0
    for fi_id, leg_id in rows:
        fi, leg = db.get(FlightInfo, fi_id), db.get(BookingLeg, leg_id)
        if fi is None or leg is None or not _due(fi, leg, now):
            continue
        if not _take_call_budget(now):
            break
        fi.checked_at = now
        fi.check_count += 1
        try:
            if _check(db, fi, leg, provider):
                updated += 1
            db.commit()
        except ServiceUnavailable as exc:
            log.warning("uçuş sorgulanamadı (bacak %s): %s", leg_id, exc)
            db.commit()  # harcanan sorgu (checked_at) kalır
        except Exception:
            log.exception("uçuş takibinde beklenmeyen hata (bacak %s)", leg_id)
            db.rollback()
            fi, leg = db.get(FlightInfo, fi_id), db.get(BookingLeg, leg_id)
            if fi is not None:
                fi.checked_at = now
                fi.check_count += 1
                db.commit()
    return updated
