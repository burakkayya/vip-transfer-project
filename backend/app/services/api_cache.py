"""Ücretli dış servis yanıtları için ortak Redis önbelleği ve günlük kullanım sayaçları (K-61).

Önbellek süreçler arasında paylaşılır (API ve ARQ işçisi aynı yanıtı kullanır) ve yeniden başlatmada
kaybolmaz. Redis yoksa önbellek sessizce devre dışı kalır: çağrı sağlayıcıya gider, akış bozulmaz.
Sayaçlar yalnızca gözlem içindir (`api_stats:{tarih}`): kaç çağrı sağlayıcıya gitti, kaçı önbellekten döndü.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from functools import lru_cache
from typing import Any

import redis

from app.config import get_settings
from app.localtime import local_date

log = logging.getLogger(__name__)

STATS_TTL_SECONDS = 40 * 24 * 3600


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                                socket_timeout=1, socket_connect_timeout=1)


def get(key: str) -> Any | None:
    try:
        raw = _redis().get(key)
    except redis.RedisError:
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def put(key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    try:
        _redis().set(key, json.dumps(value), ex=ttl_seconds)
    except (redis.RedisError, TypeError, ValueError):
        log.warning("önbelleğe yazılamadı: %s", key.split(":", 1)[0])


def count(name: str, at: datetime | None = None) -> None:
    """Günlük sayaç: `name` örn. "routes_call", "routes_hit"."""
    key = f"api_stats:{local_date(at or datetime.now().astimezone()).isoformat()}"
    try:
        r = _redis()
        if r.hincrby(key, name, 1) == 1:
            r.expire(key, STATS_TTL_SECONDS)
    except redis.RedisError:
        pass


def stats(day: str) -> dict[str, int]:
    try:
        return {k: int(v) for k, v in _redis().hgetall(f"api_stats:{day}").items()}
    except (redis.RedisError, ValueError):
        return {}


def bump_pick(place_id: str, label: str) -> None:
    """Müşterinin seçtiği Google yerinin sayacı: sık seçilenler admin panelinde aday olarak görünür."""
    try:
        r = _redis()
        r.zincrby("place_picks", 1, place_id)
        r.set(f"place_pick_label:{place_id}", label[:200], ex=30 * 24 * 3600)
    except redis.RedisError:
        pass


def top_picks(limit: int = 30) -> list[tuple[str, int, str]]:
    try:
        r = _redis()
        rows = r.zrevrange("place_picks", 0, limit - 1, withscores=True)
        return [(pid, int(score), r.get(f"place_pick_label:{pid}") or "") for pid, score in rows]
    except redis.RedisError:
        return []


def drop_pick(place_id: str) -> None:
    try:
        _redis().zrem("place_picks", place_id)
    except redis.RedisError:
        pass
