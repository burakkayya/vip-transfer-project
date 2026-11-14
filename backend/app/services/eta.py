"""Sürücünün alış noktasına (yolculukta varışa) tahmini süresi ve müşteri bildirim eşikleri (K-51).

Yola çıkışta süre rota sağlayıcısından (Google Routes) bir kez alınır. Sonraki konum
güncellemelerinde maliyet olmasın diye kuş uçuşu × yol katsayısı / ortalama hız ile tahmin
edilir. Tahmin Redis'te konumla aynı ömürde tutulur; PostgreSQL'e yazılmaz.

Bildirim eşikleri (her biri yolculuk başına en çok bir kez):
- yola çıkış: "Sürücünüz yola çıktı, tahmini N dk"
- 10 dk: yalnızca ilk tahmin 12 dk'dan uzunsa "Sürücünüz 10 dk uzakta"
- yaklaşıyor: 3 dk altı veya 800 m içi "Sürücünüz yaklaşıyor"
- vardı: sürücü "Vardım" dediğinde (dispatch)
"""

from __future__ import annotations

import logging
import math
import uuid
from decimal import Decimal
from functools import lru_cache

import redis
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models import BookingLeg
from app.models.enums import LegStatus
from app.providers.routing import Point, get_live_routing, haversine_km
from app.services import trip_updates

log = logging.getLogger(__name__)

AVG_SPEED_KMH = 40
TTL_SECONDS = 180
MILESTONE_TTL_SECONDS = 86400
APPROACH_MINUTES = 3
APPROACH_KM = Decimal("0.8")
TEN_MINUTES = 10


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                                socket_connect_timeout=1, socket_timeout=1)


def _eta_key(leg_id: uuid.UUID) -> str:
    return f"leg_eta:{leg_id}"


def _ms_key(leg_id: uuid.UUID) -> str:
    return f"leg_eta_ms:{leg_id}"


def pickup_point(leg: BookingLeg) -> Point:
    if leg.pickup_lat is not None and leg.pickup_lng is not None:
        return Point(leg.pickup_lat, leg.pickup_lng)
    return Point(leg.pickup_region.latitude, leg.pickup_region.longitude)


def dropoff_point(leg: BookingLeg) -> Point:
    if leg.dropoff_lat is not None and leg.dropoff_lng is not None:
        return Point(leg.dropoff_lat, leg.dropoff_lng)
    return Point(leg.dropoff_region.latitude, leg.dropoff_region.longitude)


def target_point(leg: BookingLeg) -> Point:
    """Sürücünün şu an gitmesi gereken nokta: yolcu alınana kadar alış, sonra varış."""
    return dropoff_point(leg) if leg.status is LegStatus.STARTED else pickup_point(leg)


def estimate_minutes(origin: Point, destination: Point) -> int:
    km = haversine_km(origin, destination) * get_settings().haversine_road_factor
    return max(1, math.ceil(float(km) / AVG_SPEED_KMH * 60))


def routed_minutes(origin: Point, destination: Point) -> int:
    """Rota sağlayıcısıyla süre; hata olursa tahmine düşer (bildirim asla başarısız olmaz)."""
    try:
        return max(1, get_live_routing().route(origin, destination).duration_minutes)
    except ServiceUnavailable:
        log.warning("ETA rotası alınamadı", exc_info=True)
        return estimate_minutes(origin, destination)


def current(leg: BookingLeg) -> int | None:
    try:
        raw = _redis().get(_eta_key(leg.id))
    except redis.RedisError:
        return None
    return int(raw) if raw else None


def _store(leg: BookingLeg, minutes: int) -> None:
    try:
        _redis().set(_eta_key(leg.id), str(minutes), ex=TTL_SECONDS)
    except redis.RedisError:
        log.warning("ETA yazılamadı", exc_info=True)


def _first_time(leg: BookingLeg, milestone: str) -> bool:
    """Eşik bu yolculukta daha önce bildirilmediyse işaretler ve True döner."""
    try:
        r = _redis()
        added = r.sadd(_ms_key(leg.id), milestone)
        r.expire(_ms_key(leg.id), MILESTONE_TTL_SECONDS)
        return bool(added)
    except redis.RedisError:
        return False


def _milestones(leg: BookingLeg) -> set[str]:
    try:
        return set(_redis().smembers(_ms_key(leg.id)))
    except redis.RedisError:
        return set()


def on_departed(db: Session, leg: BookingLeg, at: Point | None) -> None:
    """Sürücü "Yola çıktım" dedi: ilk tahmin rota sağlayıcısından, müşteriye bildirim."""
    if at is None:
        trip_updates.to_customer(db, leg, "driver_en_route_noeta")
        return
    minutes = routed_minutes(at, pickup_point(leg))
    _store(leg, minutes)
    if minutes > 12:
        _first_time(leg, "long")
    trip_updates.to_customer(db, leg, "driver_en_route", eta=minutes)


def on_location(db: Session, leg: BookingLeg, at: Point) -> int | None:
    """Konum güncellemesi: tahmini güncelle, gerekiyorsa eşik bildirimi gönder."""
    if leg.status not in (LegStatus.EN_ROUTE, LegStatus.STARTED):
        return None
    target = target_point(leg)
    minutes = estimate_minutes(at, target)
    _store(leg, minutes)
    if leg.status is LegStatus.EN_ROUTE:
        near = haversine_km(at, target) <= APPROACH_KM
        if minutes <= APPROACH_MINUTES or near:
            if _first_time(leg, "approaching"):
                trip_updates.to_customer(db, leg, "driver_approaching", eta=max(1, minutes))
        elif minutes <= TEN_MINUTES and "long" in _milestones(leg) and _first_time(leg, "ten"):
            trip_updates.to_customer(db, leg, "driver_eta", eta=minutes)
    return minutes


def clear(leg: BookingLeg) -> None:
    try:
        _redis().delete(_eta_key(leg.id), _ms_key(leg.id))
    except redis.RedisError:
        pass
