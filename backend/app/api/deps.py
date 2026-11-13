from __future__ import annotations

import ipaddress
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import Forbidden, Unauthorized
from app.models import BookingLeg, Customer, Driver, User
from app.models.enums import DriverStatus, LegStatus, RoleCode, UserKind
from app.security import tokens
from app.services.auth import get_active_session

DbSession = Annotated[Session, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@lru_cache(maxsize=8)
def _networks(cidrs: tuple[str, ...]) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(ipaddress.ip_network(c, strict=False) for c in cidrs)


def _parse_ip(value: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if not value or len(value) > 64:
        return None
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def _is_trusted(addr: ipaddress.IPv4Address | ipaddress.IPv6Address | None, nets) -> bool:
    return addr is not None and any(addr.version == n.version and addr in n for n in nets)


def client_ip(request: Request) -> str:
    """AUTH-05: istemci IP'si. Başlıklar yalnızca soket adresi güvenilir proxy listesindeyse
    (GETAWAY_TRUSTED_PROXIES) okunur; değer ipaddress ile doğrulanır, geçersizse soket IP'sine düşülür.
    Öncelik: cf-connecting-ip, sonra x-forwarded-for'da sağdan ilk güvenilmeyen adres."""
    peer_raw = request.client.host if request.client else "0.0.0.0"
    peer = _parse_ip(peer_raw)
    nets = _networks(tuple(get_settings().trusted_proxies))
    if not nets or not _is_trusted(peer, nets):
        return str(peer) if peer else peer_raw
    cf = _parse_ip(request.headers.get("cf-connecting-ip"))
    if cf is not None:
        return str(cf)
    xff = request.headers.get("x-forwarded-for")
    if xff and len(xff) <= 1024:
        for hop in reversed([h.strip() for h in xff.split(",")]):
            addr = _parse_ip(hop)
            if addr is None:
                break  # bozuk zincir: güvenilir proxy'nin eklediği kısım bitti, uydurma değere geçilmez
            if not _is_trusted(addr, nets):
                return str(addr)
    return str(peer)


ClientIp = Annotated[str, Depends(client_ip)]
Now = Annotated[datetime, Depends(utcnow)]


@dataclass
class Principal:
    user: User
    session_id: uuid.UUID

    @property
    def id(self) -> uuid.UUID:
        return self.user.id


def current_principal(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if creds is None:
        raise Unauthorized("giriş gerekli")
    try:
        payload = tokens.decode_token(creds.credentials, "access")
    except tokens.TokenError as exc:
        raise Unauthorized(str(exc)) from exc
    session = get_active_session(db, uuid.UUID(payload["sid"]))
    if str(session.user_id) != payload["sub"]:
        raise Unauthorized("oturum geçersiz")
    return Principal(user=session.user, session_id=session.id)


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def current_customer(db: DbSession, principal: CurrentPrincipal) -> Customer:
    if principal.user.kind is not UserKind.CUSTOMER:
        raise Forbidden("müşteri hesabı gerekli")
    customer = db.scalar(select(Customer).where(Customer.user_id == principal.id))
    if customer is None or customer.deleted_at is not None:
        raise Forbidden("müşteri hesabı bulunamadı")
    return customer


CurrentCustomer = Annotated[Customer, Depends(current_customer)]


def current_driver_user(principal: CurrentPrincipal) -> User:
    if principal.user.kind is not UserKind.DRIVER:
        raise Forbidden("sürücü hesabı gerekli")
    return principal.user


_BLOCKED_DRIVER_STATUSES = frozenset({DriverStatus.SUSPENDED, DriverStatus.PASSIVE})
# AUTH-06: askıdaki/pasif sürücü yalnızca kendi profilini ve belgelerini görebilir (mobil ana ekran durum
# kartı ve belge yenileme). İş, yolculuk, konum, sohbet, teklif ve diğer uçlar 403 driver_suspended döner.
# Not: driver.py bu ayrımı ileride ayrı bir bağımlılıkla yapınca bu liste kaldırılabilir (F1-3).
_SUSPENDED_ALLOWED_ROUTES = frozenset({
    ("GET", "/api/v1/driver/me"),
    ("GET", "/api/v1/driver/documents"),
    ("POST", "/api/v1/driver/documents"),
    ("GET", "/api/v1/driver/document-alerts"),
    ("GET", "/api/v1/driver/vehicles"),
})


# REV-A-5: yolcu araçtayken yolculuk yarıda bırakılmaz. Askıdaki/pasif sürücü yalnızca kendisine atanmış ve
# STARTED durumundaki bacağın olay ucunu kullanabilir. STARTED'dan tek geçerli adım "bitti" olduğundan
# (dispatch.TRANSITIONS) başka adım durum makinesince reddedilir; yeni iş, konum, sohbet kapalı kalır.
_TRIP_EVENT_PATH = re.compile(r"^/api/v1/driver/trips/([0-9a-fA-F-]{36})/events$")


def _own_started_trip_event(request: Request, db: Session, driver: Driver) -> bool:
    if request.method != "POST":
        return False
    match = _TRIP_EVENT_PATH.match(request.url.path)
    if match is None:
        return False
    try:
        leg_id = uuid.UUID(match.group(1))
    except ValueError:
        return False
    status = db.scalar(select(BookingLeg.status).where(BookingLeg.id == leg_id, BookingLeg.driver_id == driver.id))
    return status is LegStatus.STARTED


def current_driver(
    request: Request, db: DbSession, user: Annotated[User, Depends(current_driver_user)]
) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise Forbidden("sürücü kaydı tamamlanmamış", code="driver_profile_missing")
    if driver.status in _BLOCKED_DRIVER_STATUSES:
        # İzinli uçların hepsi parametresiz sabit yollar; tam yol eşleşmesi yeterli.
        if (request.method, request.url.path) not in _SUSPENDED_ALLOWED_ROUTES and not _own_started_trip_event(
            request, db, driver
        ):
            raise Forbidden("sürücü hesabı askıda veya pasif", code="driver_suspended")
    return driver


CurrentDriver = Annotated[Driver, Depends(current_driver)]


def require_staff(*allowed: RoleCode) -> Callable[[Principal], Principal]:
    """Personel ve belirtilen rollerden biri. admin rolü her zaman geçer (K-21)."""

    allowed_codes = {r.value for r in allowed} | {RoleCode.ADMIN.value}

    def dependency(principal: CurrentPrincipal) -> Principal:
        if principal.user.kind is not UserKind.STAFF:
            raise Forbidden("personel hesabı gerekli")
        if not principal.user.role_codes & allowed_codes:
            raise Forbidden("bu işlem için yetkiniz yok")
        return principal

    return dependency


AnyStaff = Annotated[
    Principal,
    Depends(require_staff(RoleCode.OPERATIONS, RoleCode.ACCOUNTING, RoleCode.SUPPORT)),
]
OpsStaff = Annotated[Principal, Depends(require_staff(RoleCode.OPERATIONS))]
OpsOrSupport = Annotated[Principal, Depends(require_staff(RoleCode.OPERATIONS, RoleCode.SUPPORT))]
FinanceStaff = Annotated[Principal, Depends(require_staff(RoleCode.ACCOUNTING))]
OpsOrFinance = Annotated[Principal, Depends(require_staff(RoleCode.OPERATIONS, RoleCode.ACCOUNTING))]
AdminOnly = Annotated[Principal, Depends(require_staff())]
