"""ARQ worker: `arq app.worker.WorkerSettings`"""

from __future__ import annotations

import json
import logging
import os
import traceback
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import redis
from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.db import SessionLocal
from app.services import jobs

log = logging.getLogger(__name__)


# MON-14: her işin son başarılı çalışma zamanı (ISO, UTC). İzleme bu anahtarın yaşına göre alarm kurar
# (ör. saatlik iş için 2 saatten eski). Anahtar süresizdir; iş hiç başarmazsa eski değer kalır.
LAST_SUCCESS_KEY = "worker:last_success:{name}"


def _mark_success(name: str, at: datetime) -> None:
    from app.services import quotes  # Redis bağlantısı zaman aşımlı ve paylaşımlı (REV-B-2)

    try:
        quotes._redis().set(LAST_SUCCESS_KEY.format(name=name), at.isoformat())
    except redis.RedisError as exc:
        log.warning("son başarılı çalışma yazılamadı (%s): %s", name, type(exc).__name__)


def _frames(exc: BaseException, limit: int = 8) -> str:
    """REV-C-8: hatanın kod konumu (dosya:satır işlev), en içteki `limit` çerçeve. İleti ve yerel değişkenler
    yazılmaz (kişisel veri taşıyabilir); yalnızca kaynak konumu teşhis için yeterlidir."""
    frames = traceback.extract_tb(exc.__traceback__)[-limit:]
    return " <- ".join(f"{os.path.basename(f.filename)}:{f.lineno} {f.name}" for f in reversed(frames)) or "?"


def _run(job) -> bool:
    """MON-14: iş kendi işleminde ve kendi try/except'inde çalışır; hatası aynı gruptaki sonraki işleri
    atlatmaz. Hata iletisi kişisel veri (SQL parametresi, ad, telefon) taşıyabileceği için yalnızca iş adı ve
    istisna tipi loglanır. Başarılı çalışmada son başarı zamanı Redis'e yazılır."""
    name = job.__name__
    try:
        with SessionLocal() as db:  # hata durumunda oturum kapanırken işlem geri alınır
            count = job(db, datetime.now(timezone.utc))
            db.commit()
    except Exception as exc:  # noqa: BLE001 - bir işin hatası diğerlerini durdurmamalı
        log.error("GÜVENLİK ALARMI zamanlanmış iş başarısız: %s (%s) konum: %s", name, type(exc).__name__,
                  _frames(exc))
        return False
    if count:
        log.info("%s: %s kayıt", name, count)
    _mark_success(name, datetime.now(timezone.utc))
    return True


async def every_minute(ctx) -> None:
    _run(jobs.expire_dispatch_offers)
    _run(jobs.cancel_unpaid_bookings)
    _run(jobs.refresh_flights)
    _run(jobs.mark_stuck_refunds_unknown)  # REV-A-7


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
        cron(evening, hour=17, minute=0, second=0),  # UTC 17:00 = TR 20:00
    ]
