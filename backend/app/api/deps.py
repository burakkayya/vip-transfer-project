from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import Forbidden, Unauthorized
from app.models import Customer, Driver, User
from app.models.enums import RoleCode, UserKind
from app.security import tokens
from app.services.auth import get_active_session

DbSession = Annotated[Session, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def client_ip(request: Request) -> str:
    # Cloudflare arkasında gerçek istemci IP'si bu başlıkta gelir.
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "0.0.0.0")


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


def current_driver(db: DbSession, user: Annotated[User, Depends(current_driver_user)]) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise Forbidden("sürücü kaydı tamamlanmamış", code="driver_profile_missing")
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
AdminOnly = Annotated[Principal, Depends(require_staff())]
