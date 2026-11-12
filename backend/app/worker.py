"""ARQ worker: `arq app.worker.WorkerSettings`"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.db import SessionLocal
from app.services import jobs

log = logging.getLogger(__name__)


def _run(job) -> int:
    with SessionLocal() as db:
        count = job(db, datetime.now(timezone.utc))
        db.commit()
    if count:
        log.info("%s: %s kayıt", job.__name__, count)
    return count


async def every_minute(ctx) -> None:
    _run(jobs.expire_dispatch_offers)
    _run(jobs.cancel_unpaid_bookings)
    _run(jobs.refresh_flights)


async def every_hour(ctx) -> None:
    _run(jobs.purge_flight_data)
    _run(jobs.purge_otp_challenges)
    _run(jobs.purge_trip_messages)
    _run(jobs.refresh_exchange_rate)


async def daily(ctx) -> None:
    _run(jobs.expire_documents)


def _json_default(value: Any) -> Any:
    """İş argümanlarında JSON'a doğrudan girmeyen güvenli tipler metne çevrilir."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, BaseException):  # başarısız işin sonucu (arq iş sonucunu da serialize eder)
        return f"{type(value).__name__}: {value}"
    raise TypeError(f"JSON'a çevrilemeyen iş verisi: {type(value).__name__}")


def job_serializer(data: dict[str, Any]) -> bytes:
    return json.dumps(data, default=_json_default, separators=(",", ":")).encode("utf-8")


def job_deserializer(raw: bytes) -> dict[str, Any]:
    """RT-01: pickle yerine JSON. Redis'e yazılan zararlı pickle yükü çalıştırılmaz, hata olarak reddedilir."""
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("geçersiz iş verisi")
    return data


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    # arq varsayılanı pickle'dır (arq/jobs.py). İleride create_pool çağrısı eklenirse aynı ikili verilmeli.
    job_serializer = job_serializer
    job_deserializer = job_deserializer
    functions: list = []
    cron_jobs = [
        cron(every_minute, second=0),
        cron(every_hour, minute=5, second=0),
        cron(daily, hour=0, minute=10, second=0),  # UTC 00:10 = TR 03:10
    ]
