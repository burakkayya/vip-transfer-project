"""Güvenlik F0-2 (AUTH-01, AUTH-07) ve F0-3 (AUTH-04): personel giriş/2FA kaba kuvvet koruması
ve OTP isteğinde IP başına ve küresel sınır."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pyotp
import pytest
from sqlalchemy import func, select

PASSWORD = "correct horse battery"


# --- yardımcılar ----------------------------------------------------------------


def _new_staff(db) -> tuple[str, uuid.UUID]:
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"hard-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    user = auth.create_staff_user(db, email=email, password=PASSWORD, roles=[RoleCode.ADMIN], actor_id=None)
    db.commit()
    return email, user.id


def _login(client, email: str, password: str = PASSWORD):
    return client.post("/api/v1/auth/staff/login", json={"email": email, "password": password})


def _secret(step: dict) -> str:
    return pyotp.parse_uri(step["provisioning_uri"]).secret


def _wrong_code(secret: str) -> str:
    totp = pyotp.TOTP(secret)
    valid = {totp.at(datetime.now(timezone.utc) + timedelta(seconds=d)) for d in (-60, -30, 0, 30, 60)}
    return next(c for c in (f"{i:06d}" for i in range(1000000)) if c not in valid)


def _2fa(client, token: str, code: str):
    return client.post("/api/v1/auth/staff/2fa", json={"mfa_token": token, "code": code})


def _audit_actions(db, user_id: uuid.UUID) -> list[str]:
    from app.models import AuditLog

    db.expire_all()
    return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == str(user_id))))


# --- F0-2: parola adımı hesap kilidi --------------------------------------------


def test_staff_login_locks_after_10_failures_in_15_min(client, db):
    email, _ = _new_staff(db)
    for _ in range(10):
        assert _login(client, email, "wrong password").status_code == 401
    # Doğru parola da artık MFA jetonu vermemeli (kilit).
    r = _login(client, email)
    assert r.status_code == 401
    assert "mfa_token" not in r.text


def test_staff_lock_response_does_not_enumerate(client, db):
    email, _ = _new_staff(db)
    for _ in range(10):
        _login(client, email, "wrong password")
    locked = _login(client, email)
    unknown = _login(client, f"nobody-{uuid.uuid4().hex[:8]}@getawaytransfers.com", "wrong password")
    wrong = _login(client, *_new_staff(db)[:1], "wrong password")
    assert locked.status_code == unknown.status_code == wrong.status_code == 401
    assert locked.json() == unknown.json() == wrong.json()


def test_staff_lockout_writes_audit_event(client, db):
    email, user_id = _new_staff(db)
    for _ in range(10):
        _login(client, email, "wrong password")
    _login(client, email)
    actions = _audit_actions(db, user_id)
    assert actions.count("staff.login_failed") >= 10
    assert "staff.locked" in actions
    assert "staff.login_blocked" in actions


def test_staff_lock_expires(client, db):
    from app.models import User

    email, user_id = _new_staff(db)
    for _ in range(10):
        _login(client, email, "wrong password")
    assert _login(client, email).status_code == 401
    db.expire_all()
    user = db.get(User, user_id)
    user.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert _login(client, email).status_code == 200


def test_staff_failures_outside_window_do_not_lock(client, db):
    from app.models import User

    email, user_id = _new_staff(db)
    for _ in range(9):
        _login(client, email, "wrong password")
    db.expire_all()
    user = db.get(User, user_id)
    user.failed_login_started_at = datetime.now(timezone.utc) - timedelta(minutes=16)
    db.commit()
    # Pencere dolduğu için sayaç sıfırdan başlar; 1 hata daha kilitlemez.
    _login(client, email, "wrong password")
    assert _login(client, email).status_code == 200


def test_successful_login_resets_failure_counter(client, db):
    email, _ = _new_staff(db)
    for _ in range(9):
        _login(client, email, "wrong password")
    step = _login(client, email).json()
    secret = _secret(step)
    assert _2fa(client, step["mfa_token"], pyotp.TOTP(secret).now()).status_code == 200
    for _ in range(9):
        _login(client, email, "wrong password")
    assert _login(client, email).status_code == 200


# --- F0-2: MFA jetonu ve TOTP ---------------------------------------------------


def test_staff_2fa_mfa_token_revoked_after_5_failures(client, db):
    email, _ = _new_staff(db)
    step = _login(client, email).json()
    secret = _secret(step)
    bad = _wrong_code(secret)
    for _ in range(5):
        assert _2fa(client, step["mfa_token"], bad).status_code == 401
    # Doğru kod da artık bu jetonla kabul edilmemeli.
    assert _2fa(client, step["mfa_token"], pyotp.TOTP(secret).now()).status_code == 401


def test_mfa_token_single_use(client, db):
    email, _ = _new_staff(db)
    step = _login(client, email).json()
    secret = _secret(step)
    totp = pyotp.TOTP(secret)
    assert _2fa(client, step["mfa_token"], totp.now()).status_code == 200
    # Aynı jeton, farklı ama geçerli pencere içindeki bir kodla tekrar kullanılamaz.
    other = totp.at(datetime.now(timezone.utc) + timedelta(seconds=30))
    assert _2fa(client, step["mfa_token"], other).status_code == 401


def test_new_login_invalidates_previous_mfa_token(client, db):
    email, _ = _new_staff(db)
    first = _login(client, email).json()
    second = _login(client, email).json()
    secret = _secret(second)
    assert _2fa(client, first["mfa_token"], pyotp.TOTP(secret).now()).status_code == 401
    assert _2fa(client, second["mfa_token"], pyotp.TOTP(secret).now()).status_code == 200


def test_totp_code_replay_rejected(client, db):
    email, _ = _new_staff(db)
    step = _login(client, email).json()
    secret = _secret(step)
    code = pyotp.TOTP(secret).now()
    assert _2fa(client, step["mfa_token"], code).status_code == 200
    # Yeni jetonla aynı (hâlâ pencere içindeki) kod tekrar kullanılamaz.
    step2 = _login(client, email).json()
    assert _2fa(client, step2["mfa_token"], code).status_code == 401


def test_totp_failures_count_toward_account_lock(client, db):
    email, user_id = _new_staff(db)
    step = _login(client, email).json()
    secret = _secret(step)
    bad = _wrong_code(secret)
    # Parolayı bilen saldırgan her girişte yeni jeton alarak TOTP denemeye devam edemez.
    for _ in range(2):
        token = _login(client, email).json()["mfa_token"]
        for _ in range(5):
            _2fa(client, token, bad)
    assert _login(client, email).status_code == 401
    assert "staff.locked" in _audit_actions(db, user_id)


def test_mfa_token_without_jti_rejected(client, db):
    from app.config import get_settings
    import jwt

    email, user_id = _new_staff(db)
    step = _login(client, email).json()
    secret = _secret(step)
    s = get_settings()
    forged = jwt.encode(
        {"sub": str(user_id), "typ": "mfa_setup", "iat": datetime.now(timezone.utc),
         "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        s.jwt_secret, algorithm="HS256",
    )
    assert _2fa(client, forged, pyotp.TOTP(secret).now()).status_code == 401


# --- F0-3: OTP isteğinde IP başına ve küresel sınır -----------------------------


def _phone() -> str:
    return "+90532" + str(uuid.uuid4().int)[:7]


def test_otp_limit_defaults():
    from app.config import Settings

    fields = Settings.model_fields
    assert fields["otp_max_per_ip_per_hour"].default == 10
    assert fields["otp_global_max_per_hour"].default == 100
    assert fields["otp_max_per_hour"].default == 5


def test_otp_request_limited_per_ip(db, monkeypatch, sms_outbox):
    from app.config import get_settings
    from app.errors import TooManyRequests
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    monkeypatch.setattr(get_settings(), "otp_max_per_ip_per_hour", 3)
    ip = f"2001:db8::{uuid.uuid4().hex[:4]}:{uuid.uuid4().hex[:4]}"
    for _ in range(3):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=ip)
    db.commit()
    sent = len(sms_outbox)
    with pytest.raises(TooManyRequests):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=ip)
    db.rollback()
    assert len(sms_outbox) == sent  # SMS gönderilmedi
    # Başka bir IP etkilenmez.
    otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                     locale="en", ip=f"203.0.113.{uuid.uuid4().int % 250 + 1}")
    db.rollback()


def test_otp_request_global_budget_enforced(client, db, monkeypatch, sms_outbox):
    from app.config import get_settings
    from app.errors import TooManyRequests
    from app.models import OtpChallenge
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    s = get_settings()
    monkeypatch.setattr(s, "otp_max_per_ip_per_hour", 10_000)
    existing = db.scalar(select(func.count(OtpChallenge.id)).where(
        OtpChallenge.created_at > datetime.now(timezone.utc) - timedelta(hours=1)))
    monkeypatch.setattr(s, "otp_global_max_per_hour", existing + 2)
    for i in range(2):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=f"192.0.2.{i + 1}")
    db.commit()
    with pytest.raises(TooManyRequests):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip="192.0.2.99")
    db.rollback()
    # API: projedeki hata biçimiyle 429.
    sent = len(sms_outbox)
    r = client.post("/api/v1/auth/otp/request", json={"phone": _phone(), "purpose": "customer", "locale": "en"})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "too_many_requests"
    assert len(sms_outbox) == sent


def test_otp_per_phone_limit_still_enforced(db):
    from app.errors import TooManyRequests
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    phone = _phone()
    for i in range(5):
        otp.request_code(db, get_sms_sender(), phone=phone, purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=f"192.0.2.{100 + i}")
    db.commit()
    with pytest.raises(TooManyRequests):
        otp.request_code(db, get_sms_sender(), phone=phone, purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip="192.0.2.200")
    db.rollback()
