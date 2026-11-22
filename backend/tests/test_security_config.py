"""Faz 0 güvenlik düzeltmeleri: INF-01, INF-02, PRIV-02, RT-01 (docs/security/remediation-plan.md F0-1, F0-5, F0-6).

Veritabanı gerektirmez. Secret değerleri yalnızca test amaçlı sahte dizgelerdir.
"""

from __future__ import annotations

import logging

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.config import Settings


@pytest.fixture
def fcm_file(tmp_path):
    path = tmp_path / "sa.json"
    path.write_text("{}", encoding="utf-8")
    return str(path)


def _prod_kwargs(fcm_file: str) -> dict:
    """Geçerli bir üretim yapılandırması; her test yalnızca bir alanı bozar."""
    return dict(
        _env_file=None,
        env="prod",
        database_url="postgresql+psycopg://app:uzun-test-db-parolasi@db.internal:5432/getaway?sslmode=verify-full",
        redis_url="rediss://:uzun-test-redis-parolasi@redis.internal:6380/0",
        cors_origins=["https://getawaytransfers.com", "https://admin.getawaytransfers.com"],
        public_web_url="https://getawaytransfers.com",
        jwt_secret="j" * 48,
        field_encryption_keys=Fernet.generate_key().decode(),
        blind_index_key="b" * 48,
        sms_provider="netgsm",
        netgsm_usercode="u",
        netgsm_password="p",
        netgsm_header="H",
        push_provider="fcm",
        fcm_credentials_file=fcm_file,
        routing_provider="google",
        places_provider="google",
        google_maps_api_key="k",
        payment_provider="paytr",
        paytr_merchant_id="123456",
        paytr_merchant_key="m" * 16,
        paytr_merchant_salt="s" * 16,
        paytr_test_mode=False,
        trusted_proxies=["10.0.0.0/8"],
        email_provider="smtp",
        smtp_host="smtp.internal",
        smtp_from="noreply@getawaytransfers.com",
        incident_alert_emails=["ops@getawaytransfers.com"],
        public_admin_url="https://admin.getawaytransfers.com",
        log_format="json",
    )


def _prod(fcm_file: str, **overrides) -> Settings:
    return Settings(**{**_prod_kwargs(fcm_file), **overrides})


def test_valid_prod_settings_accepted(fcm_file):
    s = _prod(fcm_file)
    assert s.env == "prod"


# --- F0-1 / INF-01 -------------------------------------------------------------


@pytest.mark.parametrize("env", ["production", "staging", "Prod", "PROD", ""])
def test_settings_rejects_unknown_env(fcm_file, env):
    with pytest.raises(ValidationError):
        _prod(fcm_file, env=env)


def _app_for(monkeypatch, settings: Settings):
    import app.main as main

    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return main.create_app()


def _dev(env: str = "dev") -> Settings:
    return Settings(_env_file=None, env=env, places_provider="google", routing_provider="google",
                    google_maps_api_key="k")


def _mounted(app, name: str, **params) -> bool:
    from starlette.routing import NoMatchFound

    try:
        app.url_path_for(name, **params)
        return True
    except NoMatchFound:
        return False


def test_fake_payment_routes_not_mounted_in_prod(monkeypatch, fcm_file):
    from fastapi.testclient import TestClient

    app = _app_for(monkeypatch, _prod(fcm_file))
    assert not _mounted(app, "fake_page", oid="x")
    assert not _mounted(app, "fake_complete", oid="x")
    # Gerçek PayTR bildirimi kayıtlı kalır.
    assert _mounted(app, "paytr_callback")
    # Router'da yok: çerçevenin kendi 404'ü döner, uygulama koduna hiç girilmez.
    r = TestClient(app).post("/api/v1/payments/fake/abc/complete", data={"status": "success"})
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


def test_fake_payment_routes_mounted_in_dev_and_test(monkeypatch):
    for env in ("dev", "test"):
        app = _app_for(monkeypatch, _dev(env))
        assert _mounted(app, "fake_page", oid="x")
        assert _mounted(app, "fake_complete", oid="x")


def test_docs_disabled_outside_dev_test(monkeypatch, fcm_file):
    app = _app_for(monkeypatch, _prod(fcm_file))
    assert app.docs_url is None and app.openapi_url is None
    dev = _app_for(monkeypatch, _dev())
    assert dev.docs_url == "/docs"


# --- F0-5 / PRIV-02 ---------------------------------------------------------------


def test_console_sms_log_masks_phone_and_omits_code(caplog):
    from app.providers.sms import ConsoleSms

    sms = ConsoleSms()
    with caplog.at_level(logging.DEBUG, logger="app.providers.sms"):
        sms.send("+905321234567", "getawaytransfers giris kodunuz: 482915")
    assert "482915" not in caplog.text
    assert "+905321234567" not in caplog.text
    assert "5321234" not in caplog.text
    assert "4567" in caplog.text  # son haneler eşleştirme için kalabilir
    # Testler ve dev akışı kodu bellekteki kutudan okumaya devam eder.
    assert sms.outbox[-1] == ("+905321234567", "getawaytransfers giris kodunuz: 482915")


# --- F0-5 / INF-02 ----------------------------------------------------------------


def test_prod_rejects_console_sms(fcm_file):
    with pytest.raises(ValidationError, match="SMS"):
        _prod(fcm_file, sms_provider="console")


def test_prod_rejects_paytr_test_mode(fcm_file):
    with pytest.raises(ValidationError, match="test modu"):
        _prod(fcm_file, paytr_test_mode=True)


@pytest.mark.parametrize("field", ["paytr_merchant_id", "paytr_merchant_key", "paytr_merchant_salt"])
def test_prod_rejects_empty_paytr_credentials(fcm_file, field):
    with pytest.raises(ValidationError, match="PayTR"):
        _prod(fcm_file, **{field: ""})


@pytest.mark.parametrize(
    "url",
    [
        # Repodaki geliştirme varsayılanı.
        "postgresql+psycopg://getaway:getaway@localhost:5432/getaway",
        # Geliştirme kimlik bilgisi, sslmode olsa bile.
        "postgresql+psycopg://getaway:getaway@db.internal:5432/getaway?sslmode=verify-full",
        # sslmode yok.
        "postgresql+psycopg://app:uzun-test-db-parolasi@db.internal:5432/getaway",
        # sslmode zayıf.
        "postgresql+psycopg://app:uzun-test-db-parolasi@db.internal:5432/getaway?sslmode=prefer",
        "postgresql+psycopg://app:uzun-test-db-parolasi@db.internal:5432/getaway?sslmode=disable",
        # Parolasız.
        "postgresql+psycopg://app@db.internal:5432/getaway?sslmode=verify-full",
    ],
)
def test_prod_rejects_dev_database_url_and_missing_sslmode(fcm_file, url):
    with pytest.raises(ValidationError, match="veritabanı"):
        _prod(fcm_file, database_url=url)


def test_prod_accepts_sslmode_require(fcm_file):
    s = _prod(fcm_file, database_url="postgresql+psycopg://app:uzun-test-db-parolasi@db.internal/getaway?sslmode=require")
    assert "sslmode=require" in s.database_url


@pytest.mark.parametrize(
    "overrides",
    [
        {"cors_origins": ["http://localhost:3000"]},
        {"cors_origins": ["https://getawaytransfers.com", "http://getawaytransfers.com"]},
        {"cors_origins": ["https://localhost:3000"]},
        {"cors_origins": ["https://127.0.0.1"]},
        {"cors_origins": ["*"]},
        {"public_web_url": "http://localhost:3000"},
        {"public_web_url": "http://getawaytransfers.com"},
        {"public_web_url": "https://localhost"},
    ],
)
def test_prod_rejects_localhost_cors_and_http_public_url(fcm_file, overrides):
    with pytest.raises(ValidationError, match="https"):
        _prod(fcm_file, **overrides)


@pytest.mark.parametrize("field", ["jwt_secret", "blind_index_key"])
def test_prod_rejects_short_secrets(fcm_file, field):
    with pytest.raises(ValidationError, match="32"):
        _prod(fcm_file, **{field: "x" * 31})


# --- F0-6 / RT-01 -----------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "redis://localhost:6379/0",  # eski varsayılan
        "redis://:uzun-test-redis-parolasi@redis.internal:6379/0",  # parola var, TLS yok
        "rediss://redis.internal:6380/0",  # TLS var, parola yok
        "rediss://:getaway-redis@redis.internal:6380/0",  # yerel geliştirme parolası
    ],
)
def test_prod_rejects_redis_without_password_or_tls(fcm_file, url):
    with pytest.raises(ValidationError, match="Redis"):
        _prod(fcm_file, redis_url=url)


# --- REV-A-2: güvenilir proxy listesi -------------------------------------------------


def test_prod_rejects_empty_trusted_proxies(fcm_file):
    # BFF arkasında boş liste: tüm kullanıcılar BFF'nin tek IP'sine düşer, IP sınırları herkesi keser.
    with pytest.raises(ValidationError, match="GETAWAY_TRUSTED_PROXIES"):
        _prod(fcm_file, trusted_proxies=[])


def test_dev_allows_empty_trusted_proxies():
    assert _dev().trusted_proxies == []


def test_default_redis_url_has_password():
    """docker-compose Redis'i --requirepass ile çalışır; varsayılan adres buna uyar."""
    from redis.connection import parse_url

    default = Settings.model_fields["redis_url"].default
    assert parse_url(default).get("password")


# --- REV-A (düşük not): anahtar rotasyon listesinde geliştirme anahtarı -------------------


@pytest.mark.parametrize("position", ["first", "last", "spaced"])
def test_prod_rejects_dev_fernet_key_anywhere_in_rotation_list(fcm_file, position):
    from app.config import _DEV_FERNET_KEY

    real = Fernet.generate_key().decode()
    value = {
        "first": f"{_DEV_FERNET_KEY},{real}",
        "last": f"{real},{_DEV_FERNET_KEY}",
        "spaced": f"{real} , {_DEV_FERNET_KEY} ",
    }[position]
    with pytest.raises(ValidationError, match="field_encryption_keys"):
        _prod(fcm_file, field_encryption_keys=value)


def test_prod_accepts_rotation_list_without_dev_key(fcm_file):
    keys = f"{Fernet.generate_key().decode()},{Fernet.generate_key().decode()}"
    assert _prod(fcm_file, field_encryption_keys=keys).field_encryption_keys == keys
