"""K-83: istemci hata raporu (web, admin, mobil müşteri, mobil sürücü).

Kimliksizdir (hata giriş ekranında da olabilir); bu yüzden kötüye kullanıma karşı dar tutulur:
- `code` yalnızca istemcilerin ürettiği biçimdedir (`uncaught_TypeError`, `unhandled_rejection`, `fatal_Error`).
- Seviye her zaman uyarıdır: istemci raporu tek tek e-posta göndermez; ekip Olaylar ekranında görür.
- Ekran adı backend'de şablona indirgenir: büyük harf, rakam ya da uzun parça (rezervasyon kodu, takip jetonu) `[x]`.
- Başlık sabittir (kaynak, kod, ekran); istemcinin iletisi yalnızca maskelenmiş ve şifreli ayrıntıya yazılır.
- IP öneki (IPv6 /64) başına ve küresel 10 dakikalık sınır; saatte en fazla `NEW_FINGERPRINTS_PER_HOUR` yeni olay,
  fazlası tek bir taşma olayında toplanır (tablo ve ekran şişirilemez).
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Annotated, Literal

import redis
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, StringConstraints

from app.api.deps import ClientIp
from app.config import get_settings
from app.errors import TooManyRequests
from app.services import incidents, quotes
from app.services.auth import ip_bucket

log = logging.getLogger(__name__)
router = APIRouter(tags=["client-errors"])

_CODE_RE = r"^(uncaught|unhandled|fatal)(_[A-Za-z]{1,40})?$"
_SEGMENT_RE = re.compile(r"^[a-z][a-z-]{0,19}$")
WINDOW_SECONDS = 600
NEW_FINGERPRINTS_PER_HOUR = 50


class ClientErrorIn(BaseModel):
    source: Literal["web", "admin", "mobile_customer", "mobile_driver"]
    code: Annotated[str, StringConstraints(pattern=_CODE_RE)] = "uncaught"
    message: Annotated[str, StringConstraints(max_length=500)]
    stack: Annotated[str | None, StringConstraints(max_length=4000)] = None
    screen: Annotated[str | None, StringConstraints(max_length=120)] = None
    request_id: Annotated[str | None, StringConstraints(pattern=r"^[A-Za-z0-9-]{8,64}$")] = None
    app_version: Annotated[str | None, StringConstraints(pattern=r"^[0-9A-Za-z.+-]{1,30}$")] = None


def screen_template(value: str | None) -> str:
    """Yalnızca küçük harfli kısa parçalar (ör. `tr`, `bookings`, `track`) kalır; geri kalan her parça `[x]`."""
    if not value:
        return "/"
    parts = [p for p in value.split("?")[0].split("/") if p][:8]
    return "/" + "/".join(p if _SEGMENT_RE.match(p) else "[x]" for p in parts)


def _bump(key: str) -> int:
    try:
        pipe = quotes._redis().pipeline()
        pipe.incr(key)
        pipe.expire(key, WINDOW_SECONDS + 60, nx=True)  # ömür pencere boyunca; her istekte uzamaz
        return int(pipe.execute()[0])
    except redis.RedisError as exc:
        log.warning("istemci hata raporu sayacına ulaşılamadı: %s", type(exc).__name__)
        return 0


def _check_rate(ip: str, now: datetime) -> None:
    s = get_settings()
    window = int(now.timestamp()) // WINDOW_SECONDS
    if _bump(f"client_err:ip:{ip_bucket(ip)}:{window}") > s.client_error_rate_limit_per_10min:
        raise TooManyRequests("çok fazla hata raporu")
    if _bump(f"client_err:all:{window}") > s.client_error_global_rate_limit_per_10min:
        raise TooManyRequests("çok fazla hata raporu")


def _within_new_budget(source: str, code: str, screen: str, now: datetime) -> bool:
    """Bu saatte görülen farklı (kaynak, kod, ekran) sayısı sınırı aşmadıysa True. Redis yoksa izin verir."""
    member = hashlib.sha256(f"{source}|{code}|{screen}".encode()).hexdigest()[:16]
    key = f"client_err:fp:{now:%Y%m%d%H}"
    try:
        pipe = quotes._redis().pipeline()
        pipe.sadd(key, member)
        pipe.scard(key)
        pipe.expire(key, 3700)
        added, size, _ = pipe.execute()
    except redis.RedisError:
        return True
    return not (added and size > NEW_FINGERPRINTS_PER_HOUR)


@router.post("/client-errors", status_code=202)
async def client_error(body: ClientErrorIn, ip: ClientIp):
    now = datetime.now(timezone.utc)
    await run_in_threadpool(_check_rate, ip, now)
    screen = screen_template(body.screen)
    code, location = body.code, screen
    if not await run_in_threadpool(_within_new_budget, body.source, code, screen, now):
        code, location = "client_error_overflow", ""
    detail = body.message + (f"\n\n{body.stack}" if body.stack else "")
    await run_in_threadpool(
        incidents.report,
        source=body.source, kind="client_error", code=code, location=location, level="warning",
        title=f"{body.source}: {code} ({screen})", detail=detail,
        context={"screen": screen, "client_request_id": body.request_id, "client_app_version": body.app_version},
    )
    return {"ok": True}
