"""Bağımsız inceleme düzeltmeleri: REV-A-1 (OTP IP öneki ve küresel alarm), REV-A-4 (personel girişi
hesap kilidi DoS'u: argon2 satır kilidi dışında, kilit (hesap, IP öneki) çiftine göre)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

PASSWORD = "correct horse battery"


def _phone() -> str:
    return "+90532" + str(uuid.uuid4().int)[:7]


def _v6_prefix() -> str:
    """Her test için ayrı, rastgele bir /64 (2001:db8::/32 belgeleme aralığı)."""
    return f"2001:db8:{uuid.uuid4().hex[:4]}:{uuid.uuid4().hex[:4]}"


# --- REV-A-1 (a): IP öneki normalizasyonu ------------------------------------------


def test_ip_bucket_ipv4_exact_ipv6_slash64():
    from app.services.auth import ip_bucket

    assert ip_bucket("203.0.113.7") == "203.0.113.7"
    assert ip_bucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd") == "2001:db8:1:2::/64"
    assert ip_bucket("2001:db8:1:2::1") == ip_bucket("2001:0db8:0001:0002:ffff::9")
    assert ip_bucket("2001:db8:1:3::1") != ip_bucket("2001:db8:1:2::1")
    # IPv4-mapped IPv6 adresi IPv4 sayılır.
    assert ip_bucket("::ffff:203.0.113.7") == "203.0.113.7"
    # IP olmayan değer (ör. test istemcisi) olduğu gibi kalır; None None kalır.
    assert ip_bucket("testclient") == "testclient"
    assert ip_bucket(None) is None


def test_otp_per_ip_limit_groups_ipv6_by_slash64(db, monkeypatch, sms_outbox):
    from app.config import get_settings
    from app.errors import TooManyRequests
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    monkeypatch.setattr(get_settings(), "otp_max_per_ip_per_hour", 3)
    prefix = _v6_prefix()
    # Saldırgan aynı /64 içinde her istekte farklı adres kullanır.
    for i in range(3):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=f"{prefix}:{i + 1:x}::{uuid.uuid4().hex[:4]}")
    db.commit()
    sent = len(sms_outbox)
    with pytest.raises(TooManyRequests):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip=f"{prefix}:ffff::1")
    db.rollback()
    assert len(sms_outbox) == sent
    # Başka bir /64 etkilenmez.
    otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                     locale="en", ip=f"{_v6_prefix()}::1")
    db.rollback()


# --- REV-A-1 (b): küresel eşik alarm, sert ret ayrı tavanda --------------------------


def _recent_otp_count(db) -> int:
    from app.models import OtpChallenge

    return db.scalar(select(func.count(OtpChallenge.id)).where(
        OtpChallenge.created_at > datetime.now(timezone.utc) - timedelta(hours=1)))


def test_otp_global_soft_threshold_alarms_but_does_not_reject(db, monkeypatch, caplog, sms_outbox):
    from app.config import get_settings
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    s = get_settings()
    existing = _recent_otp_count(db)
    monkeypatch.setattr(s, "otp_max_per_ip_per_hour", 10_000)
    monkeypatch.setattr(s, "otp_global_max_per_hour", existing)
    monkeypatch.setattr(s, "otp_global_hard_limit_per_hour", existing + 10)
    monkeypatch.setattr(otp, "_alarm_slot_claimed", lambda now: True)
    sent = len(sms_outbox)
    with caplog.at_level(logging.WARNING, logger="app.services.otp"):
        # Eşik aşıldı ama meşru kullanıcı kod almaya devam eder.
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip="198.51.100.1")
    db.rollback()
    assert len(sms_outbox) == sent + 1
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors and "otp" in errors[0].getMessage().lower()


def test_otp_global_alarm_logged_once_per_hour(db, monkeypatch, caplog):
    from app.config import get_settings
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    s = get_settings()
    existing = _recent_otp_count(db)
    monkeypatch.setattr(s, "otp_max_per_ip_per_hour", 10_000)
    monkeypatch.setattr(s, "otp_global_max_per_hour", existing)
    monkeypatch.setattr(s, "otp_global_hard_limit_per_hour", existing + 10)
    claimed: set[str] = set()

    def fake_slot(now):
        key = f"{now:%Y%m%d%H}"
        if key in claimed:
            return False
        claimed.add(key)
        return True

    monkeypatch.setattr(otp, "_alarm_slot_claimed", fake_slot)
    with caplog.at_level(logging.ERROR, logger="app.services.otp"):
        for i in range(3):
            otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                             locale="en", ip=f"198.51.100.{10 + i}")
    db.rollback()
    assert len([r for r in caplog.records if r.levelno >= logging.ERROR]) == 1


def test_otp_alarm_slot_dedup_falls_back_without_redis(monkeypatch):
    import redis

    from app.services import otp

    class Down:
        def set(self, *a, **k):
            raise redis.ConnectionError("down")

    monkeypatch.setattr(otp, "_redis", lambda: Down())
    monkeypatch.setattr(otp, "_local_alarm_hours", set())
    now = datetime(2026, 11, 13, 10, 5, tzinfo=timezone.utc)
    assert otp._alarm_slot_claimed(now) is True
    assert otp._alarm_slot_claimed(now + timedelta(minutes=30)) is False
    assert otp._alarm_slot_claimed(now + timedelta(hours=1)) is True


def test_otp_global_hard_limit_rejects(client, db, monkeypatch, sms_outbox):
    from app.config import get_settings
    from app.errors import TooManyRequests
    from app.models.enums import OtpPurpose
    from app.providers.sms import get_sms_sender
    from app.services import otp

    s = get_settings()
    existing = _recent_otp_count(db)
    monkeypatch.setattr(s, "otp_max_per_ip_per_hour", 10_000)
    monkeypatch.setattr(s, "otp_global_max_per_hour", 1)
    monkeypatch.setattr(s, "otp_global_hard_limit_per_hour", existing + 1)
    monkeypatch.setattr(otp, "_alarm_slot_claimed", lambda now: False)
    otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                     locale="en", ip="198.51.100.50")
    db.commit()
    with pytest.raises(TooManyRequests):
        otp.request_code(db, get_sms_sender(), phone=_phone(), purpose=OtpPurpose.CUSTOMER_LOGIN,
                         locale="en", ip="198.51.100.51")
    db.rollback()
    sent = len(sms_outbox)
    r = client.post("/api/v1/auth/otp/request", json={"phone": _phone(), "purpose": "customer", "locale": "en"})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "too_many_requests"
    assert len(sms_outbox) == sent


def test_otp_global_limit_defaults():
    from app.config import Settings

    fields = Settings.model_fields
    assert fields["otp_global_max_per_hour"].default == 100
    assert fields["otp_global_hard_limit_per_hour"].default == 2000


# --- REV-A-4: personel girişi kilidi ----------------------------------------------


def _new_staff(db) -> tuple[str, uuid.UUID]:
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"rev-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    user = auth.create_staff_user(db, email=email, password=PASSWORD, roles=[RoleCode.ADMIN], actor_id=None)
    db.commit()
    return email, user.id


def _client_from(db_app, ip: str):
    from fastapi.testclient import TestClient

    return TestClient(db_app, client=(ip, 50000))


def _login(c, email: str, password: str = PASSWORD):
    return c.post("/api/v1/auth/staff/login", json={"email": email, "password": password})


def _audit(db, user_id: uuid.UUID) -> list[tuple[str, dict | None]]:
    from app.models import AuditLog

    db.expire_all()
    return [(a.action, a.changes) for a in db.scalars(select(AuditLog).where(AuditLog.entity_id == str(user_id)))]


def test_staff_defaults_for_account_wide_lock():
    from app.config import Settings

    fields = Settings.model_fields
    assert fields["staff_login_max_failures"].default == 10
    assert fields["staff_login_account_max_failures"].default == 50


def test_attacker_ip_cannot_lock_admin_out_from_other_ip(db_app, db):
    email, user_id = _new_staff(db)
    attacker = _client_from(db_app, "203.0.113.66")
    admin = _client_from(db_app, f"{_v6_prefix()}::10")
    for _ in range(10):
        assert _login(attacker, email, "wrong password").status_code == 401
    # Saldırganın IP'si bu hesap için kilitli (doğru parolayla bile).
    blocked = _login(attacker, email)
    assert blocked.status_code == 401 and "mfa_token" not in blocked.text
    # Admin kendi IP'sinden girebilir.
    assert _login(admin, email).status_code == 200
    actions = [a for a, _ in _audit(db, user_id)]
    assert "staff.locked" in actions and "staff.login_blocked" in actions


def test_ip_lock_applies_to_whole_ipv6_slash64(db_app, db):
    email, _ = _new_staff(db)
    prefix = _v6_prefix()
    for i in range(10):
        _login(_client_from(db_app, f"{prefix}::{i + 1:x}"), email, "wrong password")
    # Aynı /64 içindeki başka bir adres de kilitli.
    assert _login(_client_from(db_app, f"{prefix}::abcd"), email).status_code == 401


def test_account_wide_lock_at_higher_threshold(db_app, db, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "staff_login_account_max_failures", 15)
    email, user_id = _new_staff(db)
    # Dağıtık saldırı: her IP çift eşiğinin altında kalır, hesap genelindeki sayaç dolar.
    for n in range(3):
        c = _client_from(db_app, f"198.51.100.{120 + n}")
        for _ in range(5):
            _login(c, email, "wrong password")
    fresh = _client_from(db_app, "192.0.2.77")
    r = _login(fresh, email)
    assert r.status_code == 401 and "mfa_token" not in r.text
    locked = [c for a, c in _audit(db, user_id) if a == "staff.locked"]
    assert locked and locked[-1].get("scope") == "account"


def test_lock_responses_identical_to_wrong_password(db_app, db):
    email, _ = _new_staff(db)
    c = _client_from(db_app, "203.0.113.90")
    wrong = _login(c, email, "wrong password")
    for _ in range(9):
        _login(c, email, "wrong password")
    locked = _login(c, email)
    unknown = _login(c, f"nobody-{uuid.uuid4().hex[:8]}@getawaytransfers.com", "wrong password")
    assert wrong.status_code == locked.status_code == unknown.status_code == 401
    assert wrong.json() == locked.json() == unknown.json()


def test_redis_down_falls_back_to_account_lock_at_low_threshold(db_app, db, monkeypatch):
    import redis

    from app.services import auth

    class Down:
        def __getattr__(self, name):
            def fail(*a, **k):
                raise redis.ConnectionError("down")
            return fail

    monkeypatch.setattr(auth, "_login_redis", lambda: Down())
    email, user_id = _new_staff(db)
    c = _client_from(db_app, "203.0.113.120")
    for _ in range(10):
        assert _login(c, email, "wrong password").status_code == 401
    # Redis yokken koruma kaybolmaz: hesap genelindeki DB sayacı eski eşikte (10) kilitler.
    assert _login(_client_from(db_app, "192.0.2.120"), email).status_code == 401
    locked = [c for a, c in _audit(db, user_id) if a == "staff.locked"]
    assert locked and locked[-1].get("scope") == "account"


def test_password_verified_outside_row_lock(db_app, db, monkeypatch):
    """Argon2 doğrulaması sürerken kullanıcı satırı kilitli olmamalı (paralel denemeler kuyruk oluşturmasın)."""
    from sqlalchemy.exc import OperationalError

    from app.db import SessionLocal
    from app.models import User
    from app.services import auth

    email, user_id = _new_staff(db)
    observed: list[bool] = []
    real_verify = auth.verify_password

    def probing_verify(password_hash, password):
        with SessionLocal() as other:
            try:
                other.scalar(select(User.id).where(User.id == user_id).with_for_update(nowait=True))
                observed.append(False)
            except OperationalError:
                observed.append(True)  # satır kilitli
            finally:
                other.rollback()
        return real_verify(password_hash, password)

    monkeypatch.setattr(auth, "verify_password", probing_verify)
    with pytest.raises(Exception):
        auth.staff_login(db, email, "wrong password", "203.0.113.130")
    db.rollback()
    assert observed == [False]


def test_unknown_account_still_runs_argon2(db, monkeypatch):
    from app.errors import Unauthorized
    from app.services import auth

    calls: list[str | None] = []
    real_verify = auth.verify_password

    def spy(password_hash, password):
        calls.append(password_hash)
        return real_verify(password_hash, password)

    monkeypatch.setattr(auth, "verify_password", spy)
    with pytest.raises(Unauthorized):
        auth.staff_login(db, f"none-{uuid.uuid4().hex[:8]}@getawaytransfers.com", "wrong password", "192.0.2.5")
    db.rollback()
    assert calls == [None]


def test_totp_ip_lock_does_not_block_admin_2fa_from_other_ip(db_app, db):
    import pyotp

    email, _ = _new_staff(db)
    attacker = _client_from(db_app, "203.0.113.140")
    admin = _client_from(db_app, "192.0.2.140")
    for _ in range(10):
        _login(attacker, email, "wrong password")
    step = _login(admin, email).json()
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    r = admin.post("/api/v1/auth/staff/2fa", json={"mfa_token": step["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200
