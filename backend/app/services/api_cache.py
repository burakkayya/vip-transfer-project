"""Ücretli dış servis yanıtları için ortak Redis önbelleği ve günlük kullanım sayaçları (K-61).

Önbellek süreçler arasında paylaşılır (API ve ARQ işçisi aynı yanıtı kullanır) ve yeniden başlatmada
kaybolmaz. Redis yoksa önbellek sessizce devre dışı kalır: çağrı sağlayıcıya gider, akış bozulmaz.
Sayaçlar yalnızca gözlem içindir (`api_stats:{tarih}`): kaç çağrı sağlayıcıya gitti, kaçı önbellekten döndü.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime
from functools import lru_cache
from typing import Any

import redis

from app.config import get_settings
from app.localtime import local_date

log = logging.getLogger(__name__)

STATS_TTL_SECONDS = 40 * 24 * 3600
# Redis yanıt vermediyse bu kadar süre denenmez: her istekte zaman aşımı beklenmez.
DOWN_SECONDS = 30
PICKS_KEY = "place_picks"
PICKS_MAX = 500
PICKS_TTL_SECONDS = 90 * 24 * 3600
PICK_LABEL_TTL_SECONDS = 30 * 24 * 3600
PICK_SEEN_TTL_SECONDS = 24 * 3600

_down_until = 0.0


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                                socket_timeout=1, socket_connect_timeout=1)


class _Down(redis.RedisError):
    pass


def _client() -> redis.Redis:
    if time.monotonic() < _down_until:
        raise _Down
    return _redis()


def _failed(exc: Exception) -> None:
    global _down_until
    if not isinstance(exc, _Down):
        _down_until = time.monotonic() + DOWN_SECONDS
        log.warning("önbellek Redis'ine ulaşılamadı; %s sn önbelleksiz devam", DOWN_SECONDS)


def reset() -> None:
    """Testler: devre kesiciyi sıfırlar."""
    global _down_until
    _down_until = 0.0


def get(key: str) -> Any | None:
    try:
        raw = _client().get(key)
    except redis.RedisError as exc:
        _failed(exc)
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
        _client().set(key, json.dumps(value), ex=ttl_seconds)
    except redis.RedisError as exc:
        _failed(exc)
    except (TypeError, ValueError):
        log.warning("önbelleğe yazılamadı: %s", key.split(":", 1)[0])


def count(name: str, at: datetime | None = None) -> None:
    """Günlük sayaç: `name` örn. "routes_call", "routes_hit"."""
    key = f"api_stats:{local_date(at or datetime.now().astimezone()).isoformat()}"
    try:
        r = _client()
        if r.hincrby(key, name, 1) == 1:
            r.expire(key, STATS_TTL_SECONDS)
    except redis.RedisError as exc:
        _failed(exc)


def stats(day: str) -> dict[str, int]:
    try:
        return {k: int(v) for k, v in _client().hgetall(f"api_stats:{day}").items()}
    except (redis.RedisError, ValueError):
        return {}


def bump_pick(place_id: str, label: str, ip: str) -> None:
    """Müşterinin seçtiği yerin sayacı: sık seçilenler admin panelinde aday olarak görünür.

    Aynı IP aynı yeri günde bir kez sayar (liste tek kişiyle şişirilemez; IP özetlenerek tutulur).
    Küme en çok `PICKS_MAX` yer tutar ve seçim gelmezse 90 günde silinir."""
    try:
        r = _client()
        seen = hashlib.sha256(f"{place_id}|{ip}".encode()).hexdigest()[:24]
        if not r.set(f"place_pick_seen:{seen}", 1, nx=True, ex=PICK_SEEN_TTL_SECONDS):
            return
        pipe = r.pipeline()
        pipe.zincrby(PICKS_KEY, 1, place_id)
        pipe.zremrangebyrank(PICKS_KEY, 0, -(PICKS_MAX + 1))
        pipe.expire(PICKS_KEY, PICKS_TTL_SECONDS)
        pipe.set(f"place_pick_label:{place_id}", label[:200], ex=PICK_LABEL_TTL_SECONDS)
        pipe.execute()
    except redis.RedisError as exc:
        _failed(exc)


def top_picks(limit: int = 30, min_picks: int = 1) -> list[tuple[str, int, str]]:
    """En çok seçilenler. Etiketi süresi dolmuş (30 gündür seçilmemiş) yer aday sayılmaz ve kümeden düşer."""
    try:
        r = _client()
        rows = r.zrevrangebyscore(PICKS_KEY, "+inf", min_picks, start=0, num=limit, withscores=True)
        out = []
        for pid, score in rows:
            label = r.get(f"place_pick_label:{pid}")
            if label is None:
                r.zrem(PICKS_KEY, pid)
                continue
            out.append((pid, int(score), label))
        return out
    except redis.RedisError as exc:
        _failed(exc)
        return []


def drop_pick(place_id: str) -> None:
    try:
        r = _client()
        r.zrem(PICKS_KEY, place_id)
        r.delete(f"place_pick_label:{place_id}")
    except redis.RedisError as exc:
        _failed(exc)
