from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Header
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import ClientIp, CurrentPrincipal, DbSession
from app.api.schemas import PhoneIn, _locale
from app.config import get_settings
from app.errors import Unauthorized
from app.models.enums import OtpPurpose, UserKind
from app.providers.sms import get_sms_sender
from app.services import auth, notifications, otp

router = APIRouter(prefix="/auth", tags=["auth"])

_PURPOSES = {"customer": OtpPurpose.CUSTOMER_LOGIN, "driver": OtpPurpose.DRIVER_LOGIN}


class OtpRequestIn(PhoneIn):
    purpose: Literal["customer", "driver"] = "customer"
    locale: str = "tr"


class OtpRequestOut(BaseModel):
    expires_in: int
    # Yalnızca geliştirme ortamında dolu (SMS konsola yazılırken kod ekranda gösterilir).
    dev_code: str | None = None


class OtpVerifyIn(PhoneIn):
    purpose: Literal["customer", "driver"] = "customer"
    code: str = Field(pattern=r"^\d{4,8}$")
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    locale: str = "tr"


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str


class StaffLoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class StaffLoginOut(BaseModel):
    mfa_token: str
    setup_required: bool
    provisioning_uri: str | None


class StaffMfaIn(BaseModel):
    mfa_token: str
    code: str = Field(pattern=r"^\d{6}$")


class MeOut(BaseModel):
    id: str
    kind: str
    roles: list[str]


def _tokens(pair: auth.TokenPair) -> TokenOut:
    return TokenOut(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=pair.expires_in,
    )


@router.post("/otp/request", response_model=OtpRequestOut)
def request_otp(body: OtpRequestIn, db: DbSession, ip: ClientIp):
    issued = otp.request_code(
        db,
        get_sms_sender(),
        phone=body.phone,
        purpose=_PURPOSES[body.purpose],
        locale=_locale(body.locale),
        ip=ip,
    )
    db.commit()
    return OtpRequestOut(expires_in=get_settings().otp_ttl_seconds, dev_code=issued.dev_code)


@router.post("/otp/verify", response_model=TokenOut)
def verify_otp(
    body: OtpVerifyIn,
    db: DbSession,
    ip: ClientIp,
    user_agent: Annotated[str | None, Header()] = None,
):
    try:
        otp.verify_code(db, phone=body.phone, purpose=_PURPOSES[body.purpose], code=body.code)
    except Unauthorized:
        db.commit()  # deneme sayısı kalıcı olsun
        raise
    if body.purpose == "customer":
        customer = auth.get_or_create_customer(
            db, body.phone, country_code=body.country_code, locale=_locale(body.locale)
        )
        user = customer.user
    else:
        user = auth.get_or_create_driver_user(db, body.phone)
    pair = auth.issue_session(db, user, device_info=user_agent, ip=ip)
    db.commit()
    return _tokens(pair)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: DbSession):
    pair = auth.refresh_session(db, body.refresh_token)
    db.commit()
    return _tokens(pair)


class LogoutIn(BaseModel):
    # Mobil: bu cihazın push jetonu; hesaptan silinir, çıkıştan sonra bildirim gelmez.
    push_token: str | None = Field(default=None, max_length=255)


@router.post("/logout", status_code=204)
def logout(principal: CurrentPrincipal, db: DbSession, body: LogoutIn | None = None):
    auth.revoke_session(db, principal.session_id)
    if body and body.push_token:
        notifications.release_push_token(db, principal.id, body.push_token)
    db.commit()


@router.get("/me", response_model=MeOut)
def me(principal: CurrentPrincipal):
    return MeOut(
        id=str(principal.id),
        kind=principal.user.kind.value,
        roles=sorted(principal.user.role_codes),
    )


@router.post("/staff/login", response_model=StaffLoginOut)
def staff_login(body: StaffLoginIn, db: DbSession, ip: ClientIp):
    try:
        step = auth.staff_login(db, body.email, body.password, ip)
    except Unauthorized:
        db.commit()  # başarısız giriş denetim kaydına yazılsın
        raise
    db.commit()
    return StaffLoginOut(
        mfa_token=step.mfa_token,
        setup_required=step.setup_required,
        provisioning_uri=step.provisioning_uri,
    )


@router.post("/staff/2fa", response_model=TokenOut)
def staff_2fa(
    body: StaffMfaIn,
    db: DbSession,
    ip: ClientIp,
    user_agent: Annotated[str | None, Header()] = None,
):
    try:
        pair = auth.staff_verify_2fa(db, body.mfa_token, body.code, device_info=user_agent, ip=ip)
    except Unauthorized:
        db.commit()
        raise
    db.commit()
    return _tokens(pair)


class StaffPasswordIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


@router.post("/staff/password", status_code=204)
def staff_change_password(body: StaffPasswordIn, principal: CurrentPrincipal, db: DbSession, ip: ClientIp):
    if principal.user.kind is not UserKind.STAFF:
        raise Unauthorized("yalnızca personel")
    auth.change_staff_password(db, principal.user, body.current_password, body.new_password, ip)
    # Parola değişince bu oturum dışındaki tüm oturumlar kapatılır.
    auth.revoke_other_sessions(db, principal.user.id, keep=principal.session_id)
    db.commit()
