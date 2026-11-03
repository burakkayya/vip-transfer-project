"""Ayak rota çizgisi (encoded polyline). PostgreSQL'e yazılmaz, Redis'te 24 saat önbelleklenir.

Koordinat yoksa bölge merkezleri kullanılır. Sağlayıcı hatasında None döner;
harita çizgisi yardımcı bilgidir ve isteği asla başarısız kılmaz.
"""

from __future__ import annotations

import logging
import uuid
from functools import lru_cache

import redis

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models import BookingLeg
from app.providers.routing import Point, get_routing

log = logging.getLogger(__name__)

TTL_SECONDS = 86400
FAILURE_TTL_SECONDS = 60
FAILURE_SENTINEL = "-"
REDIS_TIMEOUT_SECONDS = 1


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(
        get_settings().redis_url,
        decode_responses=True,
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
    )


def _key(leg_id: uuid.UUID) -> str:
    return f"route_line:{leg_id}"


def _points(leg: BookingLeg) -> tuple[Point, Point]:
    pickup = (
        Point(leg.pickup_lat, leg.pickup_lng)
        if leg.pickup_lat is not None and leg.pickup_lng is not None
        else Point(leg.pickup_region.latitude, leg.pickup_region.longitude)
    )
    dropoff = (
        Point(leg.dropoff_lat, leg.dropoff_lng)
        if leg.dropoff_lat is not None and leg.dropoff_lng is not None
        else Point(leg.dropoff_region.latitude, leg.dropoff_region.longitude)
    )
    return pickup, dropoff


def _store(leg: BookingLeg, value: str, ttl: int) -> None:
    try:
        _redis().set(_key(leg.id), value, ex=ttl)
    except redis.RedisError:
        log.warning("rota çizgisi önbelleğe yazılamadı", exc_info=True)


def route_polyline(leg: BookingLeg) -> str | None:
    """Önbellek: başarı 24 saat; sağlayıcı hatası veya boş sonuç 60 sn "olumsuz" kayıt (yavaş sağlayıcıyı yormaz)."""
    try:
        cached = _redis().get(_key(leg.id))
    except redis.RedisError:
        log.warning("rota çizgisi önbelleği okunamadı", exc_info=True)
        cached = None
    if cached == FAILURE_SENTINEL:
        return None
    if cached:
        return cached
    origin, destination = _points(leg)
    try:
        line = get_routing().route(origin, destination).polyline
    except ServiceUnavailable:
        log.warning("rota çizgisi alınamadı (leg=%s)", leg.id, exc_info=True)
        line = None
    if line:
        _store(leg, line, TTL_SECONDS)
        return line
    _store(leg, FAILURE_SENTINEL, FAILURE_TTL_SECONDS)
    return None
