"""Canlı sürücü konumu. PostgreSQL'de tutulmaz, Redis'te kısa süreli saklanır (veritabani.md).

Konum yalnızca aktif yolculuk bacağı için kabul edilir ve yalnızca o bacağın
müşterisine gösterilir.

RT-04: Redis istemcisinde bağlantı ve okuma zaman aşımı vardır. Okumada Redis hatası "konum yok" (None)
sayılır ve loglanır; yazmada 503 döner (istek 500 ile düşmez, olay döngüsü süresiz beklemez).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from functools import lru_cache

import redis

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models import Booking, BookingLeg
from app.models.enums import LegStatus

log = logging.getLogger(__name__)

TTL_SECONDS = 120
TRACKABLE = (LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED)


@lru_cache
def _redis() -> redis.Redis:
    s = get_settings()
    return redis.Redis.from_url(
        s.redis_url,
        decode_responses=True,
        socket_connect_timeout=s.redis_socket_timeout_seconds,
        socket_timeout=s.redis_socket_timeout_seconds,
    )


def _key(leg_id: uuid.UUID) -> str:
    return f"leg_loc:{leg_id}"


def store(leg: BookingLeg, lat: float, lng: float, heading: float | None, at: datetime) -> None:
    payload = {"lat": lat, "lng": lng, "heading": heading, "at": at.isoformat()}
    try:
        _redis().set(_key(leg.id), json.dumps(payload), ex=TTL_SECONDS)
    except redis.RedisError as exc:
        log.warning("canlı konum yazılamadı (leg=%s): %s", leg.id, type(exc).__name__)
        raise ServiceUnavailable("konum şu an kaydedilemiyor, lütfen tekrar deneyin") from exc


def clear(leg: BookingLeg) -> None:
    try:
        _redis().delete(_key(leg.id))
    except redis.RedisError as exc:
        # Anahtar TTL ile zaten düşer.
        log.warning("canlı konum silinemedi (leg=%s): %s", leg.id, type(exc).__name__)


def _read(leg_id: uuid.UUID) -> dict | None:
    try:
        raw = _redis().get(_key(leg_id))
    except redis.RedisError as exc:
        log.warning("canlı konum okunamadı (leg=%s): %s", leg_id, type(exc).__name__)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def trackable_leg(booking: Booking) -> BookingLeg | None:
    return next((leg for leg in booking.legs if leg.status in TRACKABLE), None)


def for_booking(booking: Booking) -> dict | None:
    leg = trackable_leg(booking)
    if leg is None:
        return None
    data = _read(leg.id)
    return {"leg_id": str(leg.id), **data} if data else None


def for_leg_id(leg_id: uuid.UUID) -> dict | None:
    """Müşteri canlı takibi (WebSocket): bacak kimliği önceden bilinir, yalnızca Redis okunur (REV-B-4).
    Biçim `for_booking` ile aynıdır."""
    data = _read(leg_id)
    return {"leg_id": str(leg_id), **data} if data else None


def for_leg(leg: BookingLeg) -> dict | None:
    """Bacağın son paylaşılan konumu (sürücü tarafı: bitirme kuralı için)."""
    return _read(leg.id)
