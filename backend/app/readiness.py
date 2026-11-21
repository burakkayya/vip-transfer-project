"""MON-15 (K-81): hazır olma denetimi. `/health` yalnızca sürecin ayakta olduğunu söyler; `/ready` veritabanı ve
Redis'e gerçekten ulaşılabildiğini denetler (yük dengeleyici ve dağıtım betikleri için).

Yalnızca iç ağdan erişilir: bağlantının doğrudan karşı ucu loopback ya da özel ağ adresi olmalı ve istek bir
vekilden geçmemiş olmalı (`X-Forwarded-For` / `Forwarded` başlığı yok). Dışarıdan gelen istek 404 alır; ters vekil
`/ready` yolunu ayrıca dışarı açmamalıdır. Yanıtta hata ayrıntısı yoktur, yalnızca denetim adı ve sonucu."""

from __future__ import annotations

import ipaddress
import logging

import redis
from fastapi import Request
from sqlalchemy import text

from app.config import get_settings

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 2


def is_internal_request(request: Request) -> bool:
    if request.headers.get("x-forwarded-for") or request.headers.get("forwarded"):
        return False
    host = request.client.host if request.client else None
    try:
        addr = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    mapped = getattr(addr, "ipv4_mapped", None)  # ::ffff:8.8.8.8 eski Python'da "özel" sayılıyordu
    if mapped is not None:
        addr = mapped
    return addr.is_loopback or addr.is_private


def _check_database() -> bool:
    from app.db import engine

    try:
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL statement_timeout = 2000"))
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 - hazır değil; ayrıntı yalnızca loga
        log.warning("hazır olma denetimi: veritabanına ulaşılamadı", exc_info=True)
        return False


def _check_redis() -> bool:
    try:
        client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=TIMEOUT_SECONDS,
                                      socket_connect_timeout=TIMEOUT_SECONDS)
        try:
            return bool(client.ping())
        finally:
            client.close()
    except Exception:  # noqa: BLE001
        log.warning("hazır olma denetimi: Redis'e ulaşılamadı", exc_info=True)
        return False


def check() -> dict[str, bool]:
    return {"database": _check_database(), "redis": _check_redis()}
