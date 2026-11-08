"""Oturum yönetimi ve personel girişi (K-21, K-22)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pyotp
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, Forbidden, Unauthorized
from app.models import AuthSession, Customer, Driver, Role, User
from app.models.enums import RoleCode, UserKind, UserStatus
from app.security import tokens
from app.security.crypto import blind_index, normalize_email
from app.security.passwords import hash_password, verify_password
from app.services import audit
from app.currency import currency_for_country

TOTP_ISSUER = "getawaytransfers.com"


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_session(
    db: Session, user: User, *, device_info: str | None, ip: str | None
) -> TokenPair:
    s = get_settings()
    refresh = tokens.new_refresh_token()
    session = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        refresh_token_hash=tokens.hash_refresh_token(refresh),
        device_info=(device_info or "")[:255] or None,
        ip=ip,
        expires_at=_now() + timedelta(days=s.jwt_refresh_days),
    )
    db.add(session)
    user.last_login_at = _now()
    return TokenPair(
        access_token=tokens.create_access_token(user.id, session.id, user.kind.value),
        refresh_token=refresh,
        expires_in=s.jwt_access_minutes * 60,
    )


def refresh_session(db: Session, refresh_token: str) -> TokenPair:
    session = db.scalar(
        select(AuthSession)
        .where(AuthSession.refresh_token_hash == tokens.hash_refresh_token(refresh_token))
        .with_for_update(of=AuthSession)
    )
    if session is None or session.revoked_at or session.expires_at <= _now():
        raise Unauthorized("oturum geçersiz")
    if session.user.status is not UserStatus.ACTIVE:
        raise Unauthorized("hesap pasif")
    new_refresh = tokens.new_refresh_token()
    session.refresh_token_hash = tokens.hash_refresh_token(new_refresh)
    s = get_settings()
    return TokenPair(
        access_token=tokens.create_access_token(session.user_id, session.id, session.user.kind.value),
        refresh_token=new_refresh,
        expires_in=s.jwt_access_minutes * 60,
    )


def revoke_session(db: Session, session_id: uuid.UUID) -> None:
    session = db.get(AuthSession, session_id)
    if session and not session.revoked_at:
        session.revoked_at = _now()


def revoke_other_sessions(db: Session, user_id: uuid.UUID, *, keep: uuid.UUID) -> None:
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None),
                                                  AuthSession.id != keep)):
        s.revoked_at = _now()


def get_active_session(db: Session, session_id: uuid.UUID) -> AuthSession:
    session = db.get(AuthSession, session_id)
    if session is None or session.revoked_at or session.expires_at <= _now():
        raise Unauthorized("oturum geçersiz")
    if session.user.status is not UserStatus.ACTIVE:
        raise Unauthorized("hesap pasif")
    return session


# --- Müşteri ve sürücü (OTP) -------------------------------------------------


def get_or_create_customer(
    db: Session, phone: str, *, country_code: str | None, locale: str
) -> Customer:
    user = db.scalar(
        select(User).where(User.kind == UserKind.CUSTOMER, User.phone_hash == blind_index(phone))
    )
    if user is None:
        user = User(kind=UserKind.CUSTOMER, phone=phone, phone_hash=blind_index(phone))
        db.add(user)
        db.flush()
    customer = db.scalar(select(Customer).where(Customer.user_id == user.id))
    if customer is None:
        country = country_code.upper() if country_code else None
        customer = Customer(
            user_id=user.id,
            country_code=country,
            locale=locale,
            currency=currency_for_country(country),
            verified_at=_now(),
        )
        db.add(customer)
        db.flush()
    if customer.deleted_at is not None:
        raise Forbidden("hesap silinmiş")
    if customer.verified_at is None:
        # Admin'in eklediği müşteri (K-54) telefonunu ilk SMS kodu girişinde doğrular.
        customer.verified_at = _now()
    return customer


def create_customer_by_staff(
    db: Session,
    phone: str,
    *,
    full_name: str,
    email: str | None,
    country_code: str | None,
    locale: str,
) -> Customer:
    """K-54: uygulamayı kullanmayan müşteri (WhatsApp, telefon) admin tarafından eklenir.
    Telefon doğrulanmamış sayılır (`verified_at` boş); müşteri isterse aynı numarayla SMS koduyla girer."""
    user = db.scalar(
        select(User).where(User.kind == UserKind.CUSTOMER, User.phone_hash == blind_index(phone))
    )
    if user is not None:
        existing = db.scalar(select(Customer).where(Customer.user_id == user.id))
        if existing is not None:
            raise Conflict("bu telefonla kayıtlı müşteri var", code="customer_exists",
                           details={"customer_id": str(existing.id)})
    else:
        user = User(kind=UserKind.CUSTOMER, phone=phone, phone_hash=blind_index(phone))
        db.add(user)
        db.flush()
    country = country_code.upper() if country_code else None
    customer = Customer(
        user_id=user.id,
        full_name=full_name,
        email=email,
        country_code=country,
        locale=locale,
        currency=currency_for_country(country),
        verified_at=None,
    )
    db.add(customer)
    db.flush()
    return customer


def get_or_create_driver_user(db: Session, phone: str) -> User:
    user = db.scalar(
        select(User).where(User.kind == UserKind.DRIVER, User.phone_hash == blind_index(phone))
    )
    if user is None:
        user = User(kind=UserKind.DRIVER, phone=phone, phone_hash=blind_index(phone))
        db.add(user)
        db.flush()
    return user


def driver_for_user(db: Session, user_id: uuid.UUID) -> Driver | None:
    return db.scalar(select(Driver).where(Driver.user_id == user_id))


# --- Personel (e-posta + parola + TOTP) ---------------------------------------


def create_staff_user(
    db: Session,
    *,
    email: str,
    password: str,
    roles: list[RoleCode],
    actor_id: uuid.UUID | None,
    ip: str | None = None,
) -> User:
    email = normalize_email(email)
    if db.scalar(select(User).where(User.email_hash == blind_index(email))):
        raise Forbidden("bu e-posta ile kullanıcı var")
    role_rows = list(db.scalars(select(Role).where(Role.code.in_(roles))))
    if len(role_rows) != len(set(roles)):
        raise ValueError("bilinmeyen rol")
    user = User(
        kind=UserKind.STAFF,
        email=email,
        email_hash=blind_index(email),
        password_hash=hash_password(password),
        roles=role_rows,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        actor_id=actor_id,
        action="staff_user.create",
        entity_type="user",
        entity_id=user.id,
        changes={"roles": [r.value for r in roles]},
        ip=ip,
    )
    return user


def change_staff_password(db: Session, user: User, current: str, new: str, ip: str | None) -> None:
    """Personel kendi parolasını değiştirir; diğer oturumları kapatılır."""
    if not verify_password(user.password_hash, current):
        raise Unauthorized("mevcut parola hatalı", code="wrong_password")
    if current == new:
        raise Forbidden("yeni parola eskisiyle aynı olamaz", code="same_password")
    user.password_hash = hash_password(new)
    audit.record(db, actor_id=user.id, action="staff_user.change_password", entity_type="user",
                 entity_id=user.id, ip=ip)


@dataclass(frozen=True)
class StaffLoginStep:
    mfa_token: str
    setup_required: bool
    provisioning_uri: str | None = None


def staff_login(db: Session, email: str, password: str, ip: str | None) -> StaffLoginStep:
    email = normalize_email(email)
    user = db.scalar(
        select(User).where(User.kind == UserKind.STAFF, User.email_hash == blind_index(email))
    )
    ok = verify_password(user.password_hash if user else None, password)
    if not ok or user is None or user.status is not UserStatus.ACTIVE:
        audit.record(db, actor_id=user.id if user else None, action="staff.login_failed",
                     entity_type="user", entity_id=user.id if user else None, ip=ip)
        raise Unauthorized("e-posta veya parola hatalı")
    if user.two_factor_enabled:
        return StaffLoginStep(tokens.create_mfa_token(user.id, "mfa"), setup_required=False)
    # İlk giriş: 2FA kurulumu zorunlu (K-22).
    if not user.two_factor_secret:
        user.two_factor_secret = pyotp.random_base32()
    uri = pyotp.TOTP(user.two_factor_secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)
    return StaffLoginStep(
        tokens.create_mfa_token(user.id, "mfa_setup"), setup_required=True, provisioning_uri=uri
    )


def staff_verify_2fa(
    db: Session, mfa_token: str, code: str, *, device_info: str | None, ip: str | None
) -> TokenPair:
    try:
        payload = tokens.decode_token(mfa_token, "mfa")
    except tokens.TokenError:
        try:
            payload = tokens.decode_token(mfa_token, "mfa_setup")
        except tokens.TokenError as exc:
            raise Unauthorized("doğrulama oturumu geçersiz, tekrar giriş yapın") from exc
    user = db.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.kind is not UserKind.STAFF or not user.two_factor_secret:
        raise Unauthorized("geçersiz istek")
    if not pyotp.TOTP(user.two_factor_secret).verify(code, valid_window=1):
        audit.record(db, actor_id=user.id, action="staff.2fa_failed", entity_type="user",
                     entity_id=user.id, ip=ip)
        raise Unauthorized("doğrulama kodu hatalı", code="totp_invalid")
    if not user.two_factor_enabled:
        user.two_factor_enabled = True
        audit.record(db, actor_id=user.id, action="staff.2fa_enabled", entity_type="user",
                     entity_id=user.id, ip=ip)
    audit.record(db, actor_id=user.id, action="staff.login", entity_type="user",
                 entity_id=user.id, ip=ip)
    return issue_session(db, user, device_info=device_info, ip=ip)


def ensure_roles(db: Session) -> None:
    names = {
        RoleCode.ADMIN: "Tam yetkili yönetici",
        RoleCode.OPERATIONS: "Operasyon",
        RoleCode.ACCOUNTING: "Muhasebe",
        RoleCode.SUPPORT: "Destek",
    }
    existing = {r.code for r in db.scalars(select(Role))}
    for code, name in names.items():
        if code not in existing:
            db.add(Role(code=code, name=name))
    db.flush()
