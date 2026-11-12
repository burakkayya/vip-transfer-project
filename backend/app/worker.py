"""ARQ worker: `arq app.worker.WorkerSettings`"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

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
    _run(jobs.send_driver_cards)


async def evening(ctx) -> None:
    _run(jobs.send_daily_plans)


async def daily(ctx) -> None:
    _run(jobs.expire_documents)


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions: list = []
    cron_jobs = [
        cron(every_minute, second=0),
        cron(every_hour, minute=5, second=0),
        cron(daily, hour=0, minute=10, second=0),  # UTC 00:10 = TR 03:10
        cron(evening, hour=17, minute=0, second=0),  # UTC 17:00 = TR 20:00
    ]
