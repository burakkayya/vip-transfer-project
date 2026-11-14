"""Güvenlik Faz 2: F2-10 (AUTH-07, AUTH-10), F2-11 (API-08, API-09, API-10, API-11),
F2-12'nin ödeme kalanları (BIZ-07, BIZ-09)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

import pyotp
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from tests.conftest import booking_body, otp_login, random_phone, region_id

API = "/api/v1"
PASSWORD = "correct horse battery"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- yardımcılar (personel) ---------------------------------------------------------


def _new_staff(db) -> tuple[str, uuid.UUID]:
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"p2-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    user = auth.create_staff_user(db, email=email, password=PASSWORD, roles=[RoleCode.ADMIN], actor_id=None)
    db.commit()
    return email, user.id


def _login(client, email: str):
    r = client.post(f"{API}/auth/staff/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def _2fa(client, token: str, code: str, headers: dict | None = None):
    return client.post(f"{API}/auth/staff/2fa", json={"mfa_token": token, "code": code}, headers=headers or {})


def _audit_actions(db, user_id: uuid.UUID) -> list[str]:
    from app.models import AuditLog

    db.expire_all()
    return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == str(user_id))))


# --- F2-10 / AUTH-07 ---------------------------------------------------------------------


def test_totp_code_reuse_rejected(client, db):
    email, _ = _new_staff(db)
    step = _login(client, email)
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    code = pyotp.TOTP(secret).now()
    assert _2fa(client, step["mfa_token"], code).status_code == 200
    # Yeni MFA jetonuyla aynı (pencere içindeki) kod reddedilir.
    again = _login(client, email)
    r = _2fa(client, again["mfa_token"], code)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "totp_invalid"


def test_totp_older_step_rejected_after_newer_used(client, db):
    """Son kabul edilen adımdan ESKİ (ama valid_window içindeki) adımın kodu da reddedilir."""
    from app.models import User

    email, user_id = _new_staff(db)
    step = _login(client, email)
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    totp = pyotp.TOTP(secret)
    assert _2fa(client, step["mfa_token"], totp.now()).status_code == 200
    db.expire_all()
    last = db.get(User, user_id).totp_last_step
    assert last is not None
    older = totp.generate_otp(last - 1)
    again = _login(client, email)
    assert _2fa(client, again["mfa_token"], older).status_code == 401


# --- F2-10 / AUTH-10 ---------------------------------------------------------------------


def test_2fa_rejects_disabled_user(client, db):
    from app.models import AuthSession, User
    from app.models.enums import UserStatus

    email, user_id = _new_staff(db)
    step = _login(client, email)
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    db.expire_all()
    user = db.get(User, user_id)
    user.status = UserStatus.DISABLED
    db.commit()
    r = _2fa(client, step["mfa_token"], pyotp.TOTP(secret).now())
    assert r.status_code == 401
    assert "access_token" not in r.text
    db.expire_all()
    user = db.get(User, user_id)
    assert user.last_login_at is None
    assert user.mfa_jti is None  # jeton tüketildi, tekrar denenemez
    assert user.two_factor_enabled is False  # kurulum tamamlanmış sayılmadı
    assert db.scalar(select(AuthSession).where(AuthSession.user_id == user_id)) is None
    actions = _audit_actions(db, user_id)
    assert "staff.login" not in actions
    assert "staff.login_blocked" in actions


# --- F2-11 / API-08 ----------------------------------------------------------------------


def test_long_user_agent_does_not_500(client, db):
    from app.models import AuthSession

    ua = "Mozilla/5.0 " + "A" * 6000
    email, user_id = _new_staff(db)
    step = _login(client, email)
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    r = _2fa(client, step["mfa_token"], pyotp.TOTP(secret).now(), headers={"User-Agent": ua})
    assert r.status_code == 200, r.text
    db.expire_all()
    s = db.scalar(select(AuthSession).where(AuthSession.user_id == user_id))
    assert s.device_info is not None and len(s.device_info) <= 255
    # Müşteri OTP girişi de aynı kurala uyar.
    from app.providers.sms import get_sms_sender

    phone = random_phone()
    client.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "customer", "locale": "en"})
    code = next(t for p, t in reversed(get_sms_sender().outbox) if p == phone).split(": ")[1][:6]
    r = client.post(f"{API}/auth/otp/verify", json={"phone": phone, "purpose": "customer", "code": code},
                    headers={"User-Agent": ua})
    assert r.status_code == 200, r.text


def test_session_device_info_strips_control_chars(db):
    from app.services import auth

    _, user_id = _new_staff(db)
    from app.models import User

    user = db.get(User, user_id)
    auth.issue_session(db, user, device_info="App/1.0\r\nX-Injected: 1\x00\x1b[31m", ip="203.0.113.7")
    db.flush()
    from app.models import AuthSession

    s = db.scalar(select(AuthSession).where(AuthSession.user_id == user_id))
    assert "\r" not in s.device_info and "\n" not in s.device_info and "\x00" not in s.device_info
    assert "\x1b" not in s.device_info
    db.rollback()


@pytest.mark.parametrize("raw,expected", [
    ("203.0.113.7", "203.0.113.7"),
    ("2001:db8::1", "2001:db8::1"),
    (" 198.51.100.2 ", "198.51.100.2"),
    ("testclient", None),
    ("x" * 200, None),
    ("", None),
    (None, None),
])
def test_session_ip_validated_before_write(db, raw, expected):
    """IP geçerli değilse kolona None yazılır; uzun/bozuk değer String(45) kolonunda 500 üretmez."""
    from app.models import AuthSession, User
    from app.services import auth

    _, user_id = _new_staff(db)
    user = db.get(User, user_id)
    auth.issue_session(db, user, device_info=None, ip=raw)
    db.flush()
    s = db.scalar(select(AuthSession).where(AuthSession.user_id == user_id))
    assert s.ip == expected
    db.rollback()


# --- F2-11 / API-09 ----------------------------------------------------------------------


def _quote_body(client, **over) -> dict:
    body = {
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "kemer")},
        "vehicle_type_code": "minivan",
        "pickup_at": (_now() + timedelta(hours=72)).isoformat(),
        "passenger_count": 2,
    }
    body.update(over)
    return body


def test_quote_rejects_far_future_pickup(client):
    r = client.post(f"{API}/quotes", json=_quote_body(client, pickup_at=(_now() + timedelta(days=400)).isoformat()))
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    # Uç değer (9999 yılı) 500 değil 422 üretir (OverflowError).
    r = client.post(f"{API}/quotes", json=_quote_body(client, pickup_at="9999-12-31T23:00:00+00:00"))
    assert r.status_code == 422, r.text


def test_quote_rejects_past_pickup(client):
    r = client.post(f"{API}/quotes", json=_quote_body(client, pickup_at=(_now() - timedelta(days=2)).isoformat()))
    assert r.status_code == 422, r.text


def test_quote_rejects_far_future_return(client):
    body = _quote_body(client, return_pickup_at=(_now() + timedelta(days=500)).isoformat())
    assert client.post(f"{API}/quotes", json=body).status_code == 422


def test_quote_accepts_near_limits(client):
    # Anlık iş: alış "şimdi" (birkaç dakika geçmiş tolere edilir); planlı iş: ~11 ay ileri.
    assert client.post(f"{API}/quotes", json=_quote_body(
        client, pickup_at=(_now() - timedelta(minutes=3)).isoformat())).status_code == 200
    assert client.post(f"{API}/quotes", json=_quote_body(
        client, pickup_at=(_now() + timedelta(days=330)).isoformat())).status_code == 200


def test_quote_rejects_huge_region_id(client):
    body = _quote_body(client)
    body["pickup"] = {"region_id": 10 ** 12}
    r = client.post(f"{API}/quotes", json=body)
    assert r.status_code == 422, r.text


def test_quote_vehicle_type_code_bounded(client):
    r = client.post(f"{API}/quotes", json=_quote_body(client, vehicle_type_code="v" * 500))
    assert r.status_code == 422


@pytest.mark.parametrize("value", ["-1", "1e30", "NaN", "Infinity", "10.001", "12345678901234"])
def test_booking_expected_total_bounds(client, value):
    from app.api.schemas import BookingCreateIn

    body = booking_body(client)
    body["expected_total"] = value
    with pytest.raises(ValidationError):
        BookingCreateIn.model_validate(body)


def test_booking_expected_total_normal_value_accepted(client):
    from app.api.schemas import BookingCreateIn

    body = booking_body(client)
    assert BookingCreateIn.model_validate(body).expected_total == D(body["expected_total"])


def test_auth_token_fields_bounded(client):
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": "a" * 10_000})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": "abc def\r\n"})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/staff/2fa", json={"mfa_token": "a" * 10_000, "code": "123456"})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/otp/request", json={"phone": "+90" + "5" * 5000, "purpose": "customer"})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/otp/request",
                    json={"phone": random_phone(), "purpose": "customer", "locale": "x" * 5000})
    assert r.status_code == 422


def test_refresh_with_valid_shape_still_works(client):
    headers = otp_login(client, random_phone())
    assert headers  # giriş akışı (refresh jetonu biçimi) bozulmadı


# --- F2-11 / API-10 ----------------------------------------------------------------------


class _Resp:
    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body


def _paytr():
    from app.providers.payments import PaytrProvider

    # Test değerleri: gerçek mağaza bilgisi değildir.
    return PaytrProvider(merchant_id="T1", merchant_key="test-key", merchant_salt="test-salt",
                         test_mode=True, ok_url="http://x/ok", fail_url="http://x/fail")


def _checkout_req():
    from app.models.enums import Currency
    from app.providers.payments import CheckoutRequest

    return CheckoutRequest(merchant_oid="GT123ABCD", amount=D("100.00"), currency=Currency.EUR,
                           email="a@b.c", customer_name="Anna", customer_phone="+905320000000",
                           user_ip="203.0.113.5", description="Transfer GT123", locale="en")


def test_payment_error_hides_provider_reason(monkeypatch, caplog):
    from app.errors import ServiceUnavailable

    reason = "paytr_token gecersiz merchant_key\r\nSAHTE SATIR"
    monkeypatch.setattr("app.providers.payments.httpx.post",
                        lambda *a, **k: _Resp({"status": "failed", "reason": reason}))
    with caplog.at_level(logging.WARNING, logger="app.providers.payments"):
        with pytest.raises(ServiceUnavailable) as exc:
            _paytr().create_checkout(_checkout_req())
    assert "merchant_key" not in exc.value.message
    assert "paytr_token" not in exc.value.message
    assert exc.value.details is None
    assert exc.value.code == "payment_provider_error"
    # Ayrıntı sunucu loguna yazılır (tek satır, kırpılmış).
    logged = [r.getMessage() for r in caplog.records]
    assert any("merchant_key" in m for m in logged), logged
    assert all("\n" not in m and "\r" not in m for m in logged)


def test_payment_error_hides_provider_reason_api(client, monkeypatch):
    provider = _paytr()
    monkeypatch.setattr("app.api.customer.get_payment_provider", lambda: provider)
    monkeypatch.setattr("app.providers.payments.httpx.post",
                        lambda *a, **k: _Resp({"status": "failed", "reason": "merchant_salt yanlis"}))
    customer = otp_login(client, random_phone())
    code = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer).json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code == 503
    assert "merchant_salt" not in r.text
    assert r.json()["error"]["code"] == "payment_provider_error"


# --- F2-11 / API-11 ----------------------------------------------------------------------


def test_log_safe_helper():
    from app.services.payments import log_safe

    assert log_safe("ABC\r\nINJECTED\x00\x1b[0m x") == "ABC??INJECTED??[0m?x"
    assert len(log_safe("A" * 10_000)) <= 80
    assert log_safe(None) == "-"


def test_merchant_oid_log_strips_crlf(db, caplog, monkeypatch):
    from app.errors import DomainError
    from app.providers.payments import get_payment_provider
    from app.services import payments as payment_service

    monkeypatch.setattr(payment_service, "_invalid_signature_sample", lambda ip, now: (False, 1))
    oid = "ABC\r\n2026-11-14 INFO sahte satir\x1b[31m" + "Z" * 5000
    form = {"merchant_oid": oid, "status": "success", "total_amount": "100", "hash": "gecersiz"}
    with caplog.at_level(logging.WARNING, logger="app.services.payments"):
        with pytest.raises(DomainError):
            payment_service.handle_callback(db, get_payment_provider(), form, _now(), ip="203.0.113.9\r\nX")
    db.rollback()
    msgs = [r.getMessage() for r in caplog.records if r.name == "app.services.payments"]
    assert msgs
    for m in msgs:
        assert "\r" not in m and "\n" not in m and "\x1b" not in m
        assert "Z" * 200 not in m


# --- F2-12 / BIZ-07 ----------------------------------------------------------------------


def _open_payment(client, db):
    from app.models import Payment

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    return db.scalar(select(Payment).where(Payment.merchant_oid == oid))


def _callback(db, payment, *, total: str, **extra):
    from app.providers.payments import get_payment_provider
    from app.services import payments as payment_service

    provider = get_payment_provider()
    oid = payment.merchant_oid
    form = {"merchant_oid": oid, "status": "success", "total_amount": total,
            "hash": provider.sign(oid, "success", total), **extra}
    payment_service.handle_callback(db, provider, form, _now())
    db.commit()
    db.expire_all()


def test_callback_without_total_amount_rejected(client, db):
    from app.models import Booking, Payment
    from app.models.enums import BookingStatus, PaymentStatus

    payment = _open_payment(client, db)
    _callback(db, payment, total="")  # imza geçerli, ama tutar yok
    p = db.get(Payment, payment.id)
    assert p.status is not PaymentStatus.PAID
    assert p.paid_at is None
    assert db.get(Booking, p.booking_id).status is BookingStatus.PENDING_PAYMENT


def test_callback_currency_mismatch_rejected(client, db):
    from app.models import Booking, Payment
    from app.models.enums import BookingStatus, PaymentStatus

    payment = _open_payment(client, db)
    assert payment.currency.value == "EUR"
    _callback(db, payment, total=str(int(payment.amount * 100)), currency="TL")
    p = db.get(Payment, payment.id)
    assert p.status is not PaymentStatus.PAID
    assert db.get(Booking, p.booking_id).status is BookingStatus.PENDING_PAYMENT


def test_callback_matching_currency_accepted(client, db):
    from app.models import Payment
    from app.models.enums import PaymentStatus

    payment = _open_payment(client, db)
    _callback(db, payment, total=str(int(payment.amount * 100)), currency="EUR")
    assert db.get(Payment, payment.id).status is PaymentStatus.PAID


def test_callback_rejection_still_answers_ok_to_paytr(client, db, monkeypatch):
    """Reddedilen (tutarsız) bildirimde de PayTR'ye "OK" döner; aksi halde PayTR aynı bildirimi tekrar eder."""
    from app.models.enums import PaymentProviderCode
    from app.providers.payments import FakeProvider

    payment = _open_payment(client, db)
    # PayTR uç noktası yalnızca PayTR sağlayıcısıyla çalışır; imzayı test bilsin diye sahte sağlayıcı PayTR kodu taşır.
    fake = FakeProvider(secret="test-secret", public_api_url="http://x", code=PaymentProviderCode.PAYTR)
    monkeypatch.setattr("app.api.payments.get_payment_provider", lambda: fake)
    oid = payment.merchant_oid
    r = client.post(f"{API}/payments/paytr/callback",
                    data={"merchant_oid": oid, "status": "success", "total_amount": "",
                          "hash": fake.sign(oid, "success", "")})
    assert r.status_code == 200 and r.text == "OK"


def test_paytr_currency_mapping():
    from app.models.enums import Currency
    from app.providers.payments import callback_currency_matches

    assert callback_currency_matches("TL", Currency.TRY)
    assert callback_currency_matches("TRY", Currency.TRY)
    assert callback_currency_matches("eur", Currency.EUR)
    assert not callback_currency_matches("USD", Currency.EUR)
    assert not callback_currency_matches("TL", Currency.EUR)


# --- F2-12 / BIZ-09 ----------------------------------------------------------------------


def test_payment_page_reuse_window_exceeds_provider_timeout(monkeypatch):
    from app.providers.payments import PAYTR_TIMEOUT_LIMIT_MINUTES
    from app.services.payments import CHECKOUT_REUSE_WINDOW

    sent = {}

    def fake_post(url, data, timeout):
        sent.update(data)
        return _Resp({"status": "success", "token": "tok"})

    monkeypatch.setattr("app.providers.payments.httpx.post", fake_post)
    _paytr().create_checkout(_checkout_req())
    assert int(sent["timeout_limit"]) == PAYTR_TIMEOUT_LIMIT_MINUTES
    # Açık sayfa, PayTR'de hâlâ ödenebilir olduğu sürece yeniden kullanılır; ikinci canlı sayfa açılmaz.
    assert CHECKOUT_REUSE_WINDOW > timedelta(minutes=PAYTR_TIMEOUT_LIMIT_MINUTES)
