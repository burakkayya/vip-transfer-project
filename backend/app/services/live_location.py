"""Canlı sürücü konumu. PostgreSQL'de tutulmaz, Redis'te kısa süreli saklanır (veritabani.md).

Konum yalnızca aktif yolculuk bacağı için kabul edilir ve yalnızca o bacağın
müşterisine gösterilir.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from functools import lru_cache

import redis

from app.config import get_settings
from app.models import Booking, BookingLeg
from app.models.enums import LegStatus

TTL_SECONDS = 120
TRACKABLE = (LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED)


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


def _key(leg_id: uuid.UUID) -> str:
    return f"leg_loc:{leg_id}"


def store(leg: BookingLeg, lat: float, lng: float, heading: float | None, at: datetime) -> None:
    payload = {"lat": lat, "lng": lng, "heading": heading, "at": at.isoformat()}
    _redis().set(_key(leg.id), json.dumps(payload), ex=TTL_SECONDS)


def clear(leg: BookingLeg) -> None:
    _redis().delete(_key(leg.id))


def for_booking(booking: Booking) -> dict | None:
    leg = next((leg for leg in booking.legs if leg.status in TRACKABLE), None)
    if leg is None:
        return None
    raw = _redis().get(_key(leg.id))
    if raw is None:
        return None
    return {"leg_id": str(leg.id), **json.loads(raw)}
