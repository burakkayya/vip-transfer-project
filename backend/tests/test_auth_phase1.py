"""Güvenlik Faz 1: F1-1 (AUTH-02), F1-2 (AUTH-05), F1-4 (AUTH-08), AUTH-06'nın bağımlılık parçası
ve F1-14 (DB-03) test veritabanı koruması."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pyotp
import pytest
from sqlalchemy import select

from conftest import otp_login, random_phone

API = "/api/v1"
PASSWORD = "correct horse battery"


# --- yardımcılar ----------------------------------------------------------------


def _staff_tokens(client, db, roles: list[str]) -> tuple[uuid.UUID, dict]:
    """Personel oluşturur, parola + 2FA ile girer; (user_id, token yanıtı) döner."""
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"p1-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    user = auth.create_staff_user(db, email=email, password=PASSWORD, roles=[RoleCode(r) for r in roles],
                                  actor_id=None)
    db.commit()
    step = client.post(f"{API}/auth/staff/login", json={"email": email, "password": PASSWORD}).json()
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    r = client.post(f"{API}/auth/staff/2fa", json={"mfa_token": step["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200, r.text
    return user.id, r.json()


def _bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _customer_tokens(client) -> dict:
    from app.providers.sms import get_sms_sender

    phone = random_phone()
    outbox = get_sms_sender().outbox
    assert client.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "customer", "locale": "en"}
                       ).status_code == 200
    code = next(text for p, text in reversed(outbox) if p == phone).split(": ")[1][:6]
    r = client.post(f"{API}/auth/otp/verify",
                    json={"phone": phone, "purpose": "customer", "code": code, "country_code": "DE"})
    assert r.status_code == 200, r.text
    return r.json()


def _refresh(client, rt: str):
    return client.post(f"{API}/auth/refresh", json={"refresh_token": rt})


def _me(client, tokens: dict):
    return client.get(f"{API}/auth/me", headers=_bearer(tokens))


# --- F1-2 (AUTH-05): güvenilir proxy modeli -----------------------------------------


def _request(peer: str, headers: dict[str, str] | None = None):
    from starlette.requests import Request

    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw, "client": (peer, 40000)})


@pytest.fixture
def trusted(monkeypatch):
    from app.config import get_settings

    def _set(cidrs: list[str]) -> None:
        monkeypatch.setattr(get_settings(), "trusted_proxies", cidrs)

    return _set


def test_trusted_proxies_default_empty():
    from app.config import Settings

    assert Settings.model_fields["trusted_proxies"].default == []


def test_client_ip_ignores_header_from_untrusted_peer(trusted):
    from app.api.deps import client_ip

    trusted([])
    req = _request("203.0.113.5", {"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8"})
    assert client_ip(req) == "203.0.113.5"
    trusted(["10.0.0.0/8"])
    assert client_ip(req) == "203.0.113.5"


def test_client_ip_uses_header_from_trusted_proxy(trusted):
    from app.api.deps import client_ip

    trusted(["10.0.0.0/8", "2001:db8::/32"])
    assert client_ip(_request("10.1.2.3", {"cf-connecting-ip": "198.51.100.7"})) == "198.51.100.7"
    assert client_ip(_request("2001:db8::1", {"cf-connecting-ip": "2001:0db8:0000::0009"})) == "2001:db8::9"


def test_client_ip_xff_takes_rightmost_untrusted_hop(trusted):
    from app.api.deps import client_ip

    trusted(["10.0.0.0/8"])
    # İstemci en soldaki değeri uydurabilir; güvenilir proxy'lerin eklediği sağdaki ilk güvenilmeyen adres esastır.
    req = _request("10.0.0.1", {"x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2"})
    assert client_ip(req) == "198.51.100.7"


def test_client_ip_invalid_value_falls_back_to_socket(trusted):
    from app.api.deps import client_ip

    trusted(["10.0.0.0/8"])
    assert client_ip(_request("10.0.0.1", {"cf-connecting-ip": "not-an-ip"})) == "10.0.0.1"
    assert client_ip(_request("10.0.0.1", {"cf-connecting-ip": "1.2.3.4' or 1=1"})) == "10.0.0.1"
    assert client_ip(_request("10.0.0.1", {"x-forwarded-for": "x" * 300})) == "10.0.0.1"


def test_trusted_proxies_invalid_cidr_rejected():
    from app.config import Settings

    with pytest.raises(ValueError):
        Settings(trusted_proxies=["not-a-cidr"])


def test_spoofed_header_not_written_to_audit(client, db):
    """Varsayılan (güvenilir proxy yok) ayarda istemci başlığı denetim kaydına yazılmaz."""
    from app.models import OtpChallenge

    phone = random_phone()
    r = client.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "customer", "locale": "en"},
                    headers={"cf-connecting-ip": "9.9.9.9"})
    assert r.status_code == 200
    from app.security.crypto import blind_index

    db.expire_all()
    ips = set(db.scalars(select(OtpChallenge.ip).where(OtpChallenge.phone_hash == blind_index(phone))))
    assert "9.9.9.9" not in ips


# --- F1-1 (AUTH-02): 2FA sıfırlama ve kurulum --------------------------------------


def test_reset_2fa_revokes_all_sessions(client, db):
    _, admin = _staff_tokens(client, db, ["admin"])
    target_id, target = _staff_tokens(client, db, ["operasyon"])
    assert _me(client, target).status_code == 200
    r = client.patch(f"{API}/admin/users/{target_id}", headers=_bearer(admin), json={"reset_2fa": True})
    assert r.status_code == 200, r.text
    assert _me(client, target).status_code == 401
    assert _refresh(client, target["refresh_token"]).status_code == 401
    # İşlemi yapan admin oturumu açık kalır.
    assert _me(client, admin).status_code == 200


def test_role_change_revokes_sessions(client, db):
    _, admin = _staff_tokens(client, db, ["admin"])
    target_id, target = _staff_tokens(client, db, ["operasyon"])
    r = client.patch(f"{API}/admin/users/{target_id}", headers=_bearer(admin), json={"roles": ["destek"]})
    assert r.status_code == 200, r.text
    assert _me(client, target).status_code == 401
    assert _refresh(client, target["refresh_token"]).status_code == 401


def test_reset_2fa_clears_pending_mfa_state(client, db):
    from app.models import User

    _, admin = _staff_tokens(client, db, ["admin"])
    target_id, _ = _staff_tokens(client, db, ["operasyon"])
    client.patch(f"{API}/admin/users/{target_id}", headers=_bearer(admin), json={"reset_2fa": True})
    db.expire_all()
    u = db.get(User, target_id)
    assert u.two_factor_enabled is False and u.two_factor_secret is None
    assert u.mfa_jti is None and u.totp_last_step is None


def test_2fa_setup_generates_new_secret_each_time(client, db):
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"p1-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    auth.create_staff_user(db, email=email, password=PASSWORD, roles=[RoleCode.SUPPORT], actor_id=None)
    db.commit()
    first = client.post(f"{API}/auth/staff/login", json={"email": email, "password": PASSWORD}).json()
    second = client.post(f"{API}/auth/staff/login", json={"email": email, "password": PASSWORD}).json()
    s1 = pyotp.parse_uri(first["provisioning_uri"]).secret
    s2 = pyotp.parse_uri(second["provisioning_uri"]).secret
    assert s1 != s2
    # Önceki kurulum ekranındaki sır artık işe yaramaz.
    r = client.post(f"{API}/auth/staff/2fa", json={"mfa_token": second["mfa_token"], "code": pyotp.TOTP(s1).now()})
    assert r.status_code == 401


def test_mfa_token_type_must_match_2fa_state(client, db):
    """2FA etkin hesapta kurulum (mfa_setup) jetonu, kurulmamış hesapta normal (mfa) jeton kabul edilmez."""
    from app.models import User
    from app.security import tokens

    target_id, _ = _staff_tokens(client, db, ["destek"])
    db.expire_all()
    u = db.get(User, target_id)
    secret = u.two_factor_secret
    jti = uuid.uuid4()
    u.mfa_jti = jti
    db.commit()
    # Girişte kullanılan kod tekrar engeline takılmasın: bir sonraki adımın kodu (valid_window=1 içinde).
    from datetime import datetime, timezone

    code = pyotp.TOTP(secret).at(datetime.now(timezone.utc) + timedelta(seconds=30))
    forged = tokens.create_mfa_token(target_id, "mfa_setup", jti)
    r = client.post(f"{API}/auth/staff/2fa", json={"mfa_token": forged, "code": code})
    assert r.status_code == 401
    # Aynı jti ile doğru türdeki jeton kabul edilir (testin kendisi doğru kurulmuş).
    db.expire_all()
    u = db.get(User, target_id)
    u.mfa_jti = jti
    db.commit()
    ok = tokens.create_mfa_token(target_id, "mfa", jti)
    assert client.post(f"{API}/auth/staff/2fa", json={"mfa_token": ok, "code": code}).status_code == 200


# --- F1-4 (AUTH-08): refresh yeniden kullanım tespiti ------------------------------


def test_refresh_rotation_still_works(client):
    t0 = _customer_tokens(client)
    r = _refresh(client, t0["refresh_token"])
    assert r.status_code == 200
    t1 = r.json()
    assert _refresh(client, t1["refresh_token"]).status_code == 200


@pytest.fixture
def no_grace(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "refresh_reuse_grace_seconds", 0)


def test_refresh_reuse_within_grace_does_not_revoke(client, monkeypatch):
    """BFF'nin paralel istekleri aynı jetonla yenilerse meşru oturum düşmez (yalnızca 401)."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "refresh_reuse_grace_seconds", 60)
    t0 = _customer_tokens(client)
    t1 = _refresh(client, t0["refresh_token"]).json()
    assert _refresh(client, t0["refresh_token"]).status_code == 401
    assert _refresh(client, t1["refresh_token"]).status_code == 200


def test_refresh_reuse_revokes_session_family(client, no_grace):
    t0 = _customer_tokens(client)
    t1 = _refresh(client, t0["refresh_token"]).json()
    # Eski (döndürülmüş) jeton tekrar geldi: çalınmış kabul edilir, aile iptal edilir.
    assert _refresh(client, t0["refresh_token"]).status_code == 401
    assert _refresh(client, t1["refresh_token"]).status_code == 401
    assert _me(client, t1).status_code == 401


def test_refresh_reuse_staff_session(client, db, no_grace):
    _, t0 = _staff_tokens(client, db, ["operasyon"])
    t1 = _refresh(client, t0["refresh_token"]).json()
    assert _refresh(client, t0["refresh_token"]).status_code == 401
    assert _refresh(client, t1["refresh_token"]).status_code == 401


def test_refresh_reuse_writes_audit_event(client, db, no_grace):
    from app.models import AuditLog, AuthSession
    from app.security import tokens

    t0 = _customer_tokens(client)
    sess = db.scalar(select(AuthSession).where(
        AuthSession.refresh_token_hash == tokens.hash_refresh_token(t0["refresh_token"])))
    _refresh(client, t0["refresh_token"])
    _refresh(client, t0["refresh_token"])
    db.expire_all()
    rows = list(db.scalars(select(AuditLog).where(AuditLog.action == "security.refresh_reuse",
                                                  AuditLog.entity_id == str(sess.id))))
    assert len(rows) == 1
    assert rows[0].actor_id == sess.user_id
    # Jeton ya da özeti kayda yazılmaz.
    assert t0["refresh_token"] not in str(rows[0].changes)
    assert db.get(AuthSession, sess.id).revoked_at is not None


def test_unknown_refresh_token_no_audit(client, db):
    from app.models import AuditLog
    from sqlalchemy import func

    before = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "security.refresh_reuse"))
    assert _refresh(client, "bilinmeyen-jeton").status_code == 401
    db.expire_all()
    after = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "security.refresh_reuse"))
    assert after == before


def test_staff_session_absolute_lifetime_12h(client, db):
    from app.models import AuthSession
    from app.security import tokens

    _, t0 = _staff_tokens(client, db, ["operasyon"])
    sess = db.scalar(select(AuthSession).where(
        AuthSession.refresh_token_hash == tokens.hash_refresh_token(t0["refresh_token"])))
    assert sess.expires_at - sess.created_at <= timedelta(hours=12, minutes=1)
    # Yenileme ömrü uzatmaz.
    _refresh(client, t0["refresh_token"])
    db.expire_all()
    again = db.get(AuthSession, sess.id)
    assert again.expires_at == sess.expires_at


def test_customer_session_lifetime_unchanged(client, db):
    from app.config import get_settings
    from app.models import AuthSession
    from app.security import tokens

    t0 = _customer_tokens(client)
    sess = db.scalar(select(AuthSession).where(
        AuthSession.refresh_token_hash == tokens.hash_refresh_token(t0["refresh_token"])))
    assert sess.expires_at - sess.created_at > timedelta(days=get_settings().jwt_refresh_days - 1)


# --- AUTH-06 (deps parçası): askıdaki / pasif sürücü --------------------------------


def _driver_with_status(client, db, status) -> dict:
    from app.models import Driver, User
    from app.models.enums import DriverStatus

    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    r = client.post(f"{API}/driver/register", headers=headers, json={"full_name": "Askı Test"})
    assert r.status_code == 201, r.text
    driver = db.get(Driver, uuid.UUID(r.json()["id"]))
    driver.status = DriverStatus(status)
    db.commit()
    return headers


@pytest.mark.parametrize("status", ["askida", "pasif"])
def test_suspended_driver_cannot_access_trips_location_chat(client, db, status):
    headers = _driver_with_status(client, db, status)
    leg = uuid.uuid4()
    calls = [
        ("get", f"{API}/driver/trips", None),
        ("get", f"{API}/driver/jobs", None),
        ("get", f"{API}/driver/offers", None),
        ("post", f"{API}/driver/trips/{leg}/location", {"lat": 36.9, "lng": 30.7}),
        ("get", f"{API}/driver/trips/{leg}/messages", None),
        ("post", f"{API}/driver/trips/{leg}/messages", {"body": "merhaba"}),
        ("post", f"{API}/driver/me/online", {"online": True}),
        ("get", f"{API}/driver/updates", None),
    ]
    for method, url, body in calls:
        r = getattr(client, method)(url, headers=headers, **({"json": body} if body else {}))
        assert r.status_code == 403, (url, r.status_code, r.text)
        assert r.json()["error"]["code"] == "driver_suspended", url


@pytest.mark.parametrize("status", ["askida", "pasif"])
def test_suspended_driver_can_still_read_own_profile(client, db, status):
    """Mobil ana ekran durum kartını gösterebilsin diye kendi profil/belge okuması açık kalır."""
    headers = _driver_with_status(client, db, status)
    r = client.get(f"{API}/driver/me", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == status
    assert client.get(f"{API}/driver/documents", headers=headers).status_code == 200


def test_applied_driver_not_blocked(client, db):
    headers = _driver_with_status(client, db, "basvuru")
    assert client.get(f"{API}/driver/trips", headers=headers).status_code == 200


# --- F1-14 (DB-03): test veritabanı adı koruması -----------------------------------


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://getaway:x@localhost:5432/getaway",
    "postgresql+psycopg://getaway:x@localhost:5432/production",
    "postgresql+psycopg://getaway:x@db.example.com:5432/getaway_test",
    "postgresql+psycopg://getaway:x@10.0.0.5:5432/getaway_test_w1",
    "postgresql+psycopg://getaway:x@localhost:5432/",
])
def test_conftest_refuses_non_test_database(url):
    import conftest

    with pytest.raises(pytest.exit.Exception):
        conftest.assert_safe_test_database(url)


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://getaway:x@localhost:5432/getaway_test",
    "postgresql+psycopg://getaway:x@127.0.0.1:5432/getaway_test_w1",
    "postgresql+psycopg://getaway:x@[::1]:5432/app_test",
])
def test_conftest_accepts_local_test_database(url):
    import conftest

    conftest.assert_safe_test_database(url)
