"""K-83: istemci hata raporu (web, admin, mobil müşteri, mobil sürücü).

Kimliksizdir (hata giriş ekranında da olabilir); IP başına ve küresel 10 dakikalık sınırla korunur. Gövde sınırlı
ve maskelenir: ileti ve yığın izinden e-posta, telefon, IBAN desenleri temizlenir, ayrıntı şifreli saklanır.
Parmak izi yalnızca istemcinin verdiği koddan ve ekran adından üretilir: rastgele metin göndererek sınırsız
yeni olay açılamaz (ileti parmak izine girmez).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, StringConstraints

from app.api.deps import ClientIp
from app.config import get_settings
from app.errors import TooManyRequests
from app.services import incidents, quotes

router = APIRouter(tags=["client-errors"])

_CODE_RE = r"^[A-Za-z0-9_.:-]{1,80}$"
_SCREEN_RE = re.compile(r"^[A-Za-z0-9_/\[\]().-]{1,120}$")
_DIGITS = re.compile(r"\d{3,}")
_LONG_DIGITS = re.compile(r"\d{7,}")


class ClientErrorIn(BaseModel):
    source: Literal["web", "admin", "mobile_customer", "mobile_driver"]
    code: Annotated[str, StringConstraints(pattern=_CODE_RE)] = "client_error"
    message: Annotated[str, StringConstraints(max_length=500)]
    stack: Annotated[str | None, StringConstraints(max_length=4000)] = None
    # Ekran/yol şablonu (ör. /[locale]/bookings/[code]); gerçek yol değil.
    screen: Annotated[str | None, StringConstraints(max_length=120)] = None
    request_id: Annotated[str | None, StringConstraints(pattern=r"^[A-Za-z0-9-]{8,64}$")] = None
    app_version: Annotated[str | None, StringConstraints(pattern=r"^[0-9A-Za-z.+-]{1,30}$")] = None
    level: Literal["warning", "error"] = "error"


def _screen(value: str | None) -> str:
    if not value or not _SCREEN_RE.match(value):
        return "?"
    return _DIGITS.sub("#", value)  # yanlışlıkla gerçek yol gelirse içindeki numaralar parmak izini bölmesin


def _check_rate(ip: str) -> None:
    s = get_settings()
    window = f"{datetime.now(timezone.utc):%Y%m%d%H}{datetime.now(timezone.utc).minute // 10}"
    if quotes._bump(f"client_err:ip:{ip}:{window}") > s.client_error_rate_limit_per_10min:
        raise TooManyRequests("çok fazla hata raporu")
    if quotes._bump(f"client_err:all:{window}") > s.client_error_global_rate_limit_per_10min:
        raise TooManyRequests("çok fazla hata raporu")


@router.post("/client-errors", status_code=202)
async def client_error(body: ClientErrorIn, ip: ClientIp):
    await run_in_threadpool(_check_rate, ip)
    screen = _screen(body.screen)
    code = _LONG_DIGITS.sub("#", body.code)  # kodda telefon benzeri uzun rakam dizisi saklanmaz
    detail = body.message + (f"\n\n{body.stack}" if body.stack else "")
    await run_in_threadpool(
        incidents.report,
        source=body.source, kind="client_error", code=code, location=screen, level=body.level,
        title=f"{body.source}: {body.message[:120]}", detail=detail,
        context={"screen": screen, "client_request_id": body.request_id, "client_app_version": body.app_version},
    )
    return {"ok": True}
