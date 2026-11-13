"""Oturum yönetimi ve personel girişi (K-21, K-22)."""

from __future__ import annotations

import hmac
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
    # AUTH-08: personel oturumu mutlak 12 saat (yenileme uzatmaz); müşteri ve sürücü jwt_refresh_days.
    lifetime = (timedelta(hours=s.staff_session_hours) if user.kind is UserKind.STAFF
                else timedelta(days=s.jwt_refresh_days))
    session = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        refresh_token_hash=tokens.hash_refresh_token(refresh),
        device_info=(device_info or "")[:255] or None,
        ip=ip,
        expires_at=_now() + lifetime,
    )
    db.add(session)
    user.last_login_at = _now()
    return TokenPair(
        access_token=tokens.create_access_token(user.id, session.id, user.kind.value),
        refresh_token=refresh,
        expires_in=s.jwt_access_minutes * 60,
    )


def _handle_refresh_reuse(db: Session, token_hash: str, ip: str | None) -> None:
    """AUTH-08: döndürülmüş (eski) jeton tekrar geldi. Tolerans penceresi dışındaysa jeton çalınmış
    sayılır: oturum ailesi (aynı oturum satırı, tüm rotasyonları) iptal edilir ve denetim kaydı yazılır.
    Çağıran, Unauthorized yükseltmeden önce commit etmelidir."""
    session = db.scalar(
        select(AuthSession).where(AuthSession.previous_refresh_hash == token_hash).with_for_update(of=AuthSession)
    )
    if session is None or session.revoked_at is not None:
        return
    now = _now()
    grace = timedelta(seconds=get_settings().refresh_reuse_grace_seconds)
    if session.rotated_at is not None and now - session.rotated_at < grace:
        return  # eşzamanlı meşru yenileme (BFF paralel istekleri): yalnızca bu istek reddedilir
    session.revoked_at = now
    audit.record(db, actor_id=session.user_id, action="security.refresh_reuse", entity_type="session",
                 entity_id=session.id,
                 changes={"user_kind": session.user.kind.value,
                          "rotated_at": session.rotated_at.isoformat() if session.rotated_at else None},
                 ip=ip)


def refresh_session(db: Session, refresh_token: str, *, ip: str | None = None) -> TokenPair:
    token_hash = tokens.hash_refresh_token(refresh_token)
    session = db.scalar(
        select(AuthSession)
        .where(AuthSession.refresh_token_hash == token_hash)
        .with_for_update(of=AuthSession)
    )
    if session is None:
        _handle_refresh_reuse(db, token_hash, ip)
        raise Unauthorized("oturum geçersiz")
    if session.revoked_at or session.expires_at <= _now():
        raise Unauthorized("oturum geçersiz")
    if session.user.status is not UserStatus.ACTIVE:
        raise Unauthorized("hesap pasif")
    new_refresh = tokens.new_refresh_token()
    session.previous_refresh_hash = token_hash
    session.rotated_at = _now()
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


def revoke_all_sessions(db: Session, user_id: uuid.UUID, *, keep: uuid.UUID | None = None) -> int:
    """Kullanıcının tüm açık oturumlarını (ve dolayısıyla refresh jetonlarını) iptal eder.
    `keep` verilirse o oturum açık kalır (ör. kendi kaydını düzenleyen admin). İptal sayısını döner."""
    q = select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if keep is not None:
        q = q.where(AuthSession.id != keep)
    n = 0
    for s in db.scalars(q):
        s.revoked_at = _now()
        n += 1
    return n


def reset_staff_2fa(db: Session, user: User) -> None:
    """AUTH-02: 2FA sıfırlanınca sır ve bekleyen MFA durumu silinir; bir sonraki girişte yeni kurulum."""
    user.two_factor_enabled = False
    user.two_factor_secret = None
    user.mfa_jti = None
    user.mfa_attempts = 0
    user.totp_last_step = None


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


_LOGIN_FAILED = "e-posta veya parola hatalı"
_MFA_SESSION_INVALID = "doğrulama oturumu geçersiz, tekrar giriş yapın"


def _is_locked(user: User, now: datetime) -> bool:
    return user.locked_until is not None and user.locked_until > now


def _register_failure(db: Session, user: User, now: datetime, ip: str | None, *, stage: str) -> None:
    """AUTH-01: parola ve TOTP hataları aynı hesap sayacına yazılır. Pencere içinde eşik aşılırsa
    hesap geçici kilitlenir; kilit bilgisi yalnızca denetim kaydına gider, yanıta yansımaz."""
    s = get_settings()
    started = user.failed_login_started_at
    if started is None or now - started >= timedelta(minutes=s.staff_login_window_minutes):
        user.failed_login_count = 0
        user.failed_login_started_at = now
    user.failed_login_count = (user.failed_login_count or 0) + 1
    action = "staff.login_failed" if stage == "password" else "staff.2fa_failed"
    audit.record(db, actor_id=user.id, action=action, entity_type="user", entity_id=user.id,
                 changes={"failures": user.failed_login_count}, ip=ip)
    if user.failed_login_count >= s.staff_login_max_failures:
        audit.record(db, actor_id=user.id, action="staff.locked", entity_type="user", entity_id=user.id,
                     changes={"failures": user.failed_login_count, "minutes": s.staff_lockout_minutes,
                              "stage": stage}, ip=ip)
        user.locked_until = now + timedelta(minutes=s.staff_lockout_minutes)
        user.failed_login_count = 0
        user.failed_login_started_at = None
        user.mfa_jti = None
        user.mfa_attempts = 0


def _match_totp_step(secret: str, code: str, now: datetime) -> int | None:
    """valid_window=1 ile eşleşen TOTP zaman adımını döner (tekrar kullanım denetimi için)."""
    totp = pyotp.TOTP(secret)
    base = totp.timecode(now)
    matched = None
    for step in (base - 1, base, base + 1):
        if hmac.compare_digest(totp.generate_otp(step), code):
            matched = step
    return matched


def staff_login(db: Session, email: str, password: str, ip: str | None) -> StaffLoginStep:
    now = _now()
    email = normalize_email(email)
    # Satır kilidi: paralel denemeler sayacı atlatamasın.
    user = db.scalar(
        select(User)
        .where(User.kind == UserKind.STAFF, User.email_hash == blind_index(email))
        .with_for_update(of=User)
    )
    # Parola her durumda doğrulanır (kilitli/olmayan hesap yanıt süresinden ayırt edilmesin).
    ok = verify_password(user.password_hash if user else None, password)
    if user is None:
        audit.record(db, actor_id=None, action="staff.login_failed", entity_type="user", entity_id=None, ip=ip)
        raise Unauthorized(_LOGIN_FAILED)
    if _is_locked(user, now):
        # Kullanıcı numaralandırması olmasın: yanıt yanlış parola ile aynı.
        audit.record(db, actor_id=user.id, action="staff.login_blocked", entity_type="user",
                     entity_id=user.id, changes={"reason": "locked"}, ip=ip)
        raise Unauthorized(_LOGIN_FAILED)
    if not ok or user.status is not UserStatus.ACTIVE:
        _register_failure(db, user, now, ip, stage="password")
        raise Unauthorized(_LOGIN_FAILED)
    # Yalnızca son verilen jeton geçerli; öncekiler ve kalan deneme hakları iptal.
    user.mfa_jti = uuid.uuid4()
    user.mfa_attempts = 0
    if user.two_factor_enabled:
        return StaffLoginStep(tokens.create_mfa_token(user.id, "mfa", user.mfa_jti), setup_required=False)
    # İlk giriş: 2FA kurulumu zorunlu (K-22). AUTH-02: her kurulum başlangıcında yeni sır; önceki
    # girişte (ör. parolayı ele geçiren biri tarafından) görülen sır geçersiz olur.
    user.two_factor_secret = pyotp.random_base32()
    user.totp_last_step = None
    uri = pyotp.TOTP(user.two_factor_secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)
    return StaffLoginStep(
        tokens.create_mfa_token(user.id, "mfa_setup", user.mfa_jti), setup_required=True, provisioning_uri=uri
    )


def staff_verify_2fa(
    db: Session, mfa_token: str, code: str, *, device_info: str | None, ip: str | None
) -> TokenPair:
    now = _now()
    s = get_settings()
    setup = False
    try:
        payload = tokens.decode_token(mfa_token, "mfa")
    except tokens.TokenError:
        try:
            payload = tokens.decode_token(mfa_token, "mfa_setup")
            setup = True
        except tokens.TokenError as exc:
            raise Unauthorized(_MFA_SESSION_INVALID) from exc
    try:
        user_id = uuid.UUID(payload["sub"])
        jti = uuid.UUID(payload["jti"])
    except (KeyError, TypeError, ValueError) as exc:
        raise Unauthorized(_MFA_SESSION_INVALID) from exc
    user = db.scalar(select(User).where(User.id == user_id).with_for_update(of=User))
    if user is None or user.kind is not UserKind.STAFF or not user.two_factor_secret:
        raise Unauthorized("geçersiz istek")
    # Tek kullanımlık jeton: yalnızca kullanıcıda kayıtlı son jti kabul edilir.
    if user.mfa_jti is None or user.mfa_jti != jti:
        raise Unauthorized(_MFA_SESSION_INVALID)
    # AUTH-02: jeton türü hesabın 2FA durumuyla eşleşmeli (kurulum jetonu yalnızca kurulmamış hesapta).
    if setup == user.two_factor_enabled:
        user.mfa_jti = None
        raise Unauthorized(_MFA_SESSION_INVALID)
    if _is_locked(user, now) or user.status is not UserStatus.ACTIVE:
        user.mfa_jti = None
        audit.record(db, actor_id=user.id, action="staff.login_blocked", entity_type="user",
                     entity_id=user.id, changes={"reason": "locked" if _is_locked(user, now) else "inactive"},
                     ip=ip)
        raise Unauthorized(_MFA_SESSION_INVALID)
    step = _match_totp_step(user.two_factor_secret, code, now)
    replay = step is not None and user.totp_last_step is not None and step <= user.totp_last_step
    if step is None or replay:
        user.mfa_attempts = (user.mfa_attempts or 0) + 1
        if user.mfa_attempts >= s.staff_mfa_max_attempts:
            user.mfa_jti = None  # jetonun deneme hakkı bitti
        _register_failure(db, user, now, ip, stage="totp_replay" if replay else "totp")
        raise Unauthorized("doğrulama kodu hatalı", code="totp_invalid")
    user.mfa_jti = None
    user.mfa_attempts = 0
    user.totp_last_step = step
    user.failed_login_count = 0
    user.failed_login_started_at = None
    user.locked_until = None
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
