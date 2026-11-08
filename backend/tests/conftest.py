"""Entegrasyon testleri gerçek PostgreSQL + PostGIS ve Redis ister (docker compose up -d).

Saf birim testleri (test_pricing, test_domain) veritabanı olmadan da çalışır.
Veritabanı gereken testler `db_app` fikstürünü kullanır; veritabanı yoksa atlanır.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault(
    "GETAWAY_DATABASE_URL", "postgresql+psycopg://getaway:getaway@localhost:5432/getaway_test"
)
os.environ.setdefault("GETAWAY_REDIS_URL", "redis://localhost:6379/15")
os.environ["GETAWAY_ENV"] = "test"
os.environ["GETAWAY_SMS_PROVIDER"] = "console"
os.environ["GETAWAY_PAYMENT_PROVIDER"] = "fake"
os.environ["GETAWAY_ROUTING_PROVIDER"] = "haversine"
os.environ["GETAWAY_PLACES_PROVIDER"] = "fake"
os.environ["GETAWAY_PUSH_PROVIDER"] = "console"
os.environ["GETAWAY_STORAGE_DIR"] = tempfile.mkdtemp(prefix="getaway-test-")

import pyotp  # noqa: E402
import pytest  # noqa: E402

PDF = b"%PDF-1.4 test document"


def _db_available() -> bool:
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(os.environ["GETAWAY_DATABASE_URL"])
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        engine.dispose()
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.fixture(scope="session")
def db_app():
    if not _db_available():
        pytest.skip("test veritabanı yok (docker compose up -d)")
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    from app import seed
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed.run(db)
        db.commit()

    from app.main import app

    return app


@pytest.fixture
def client(db_app):
    from fastapi.testclient import TestClient

    return TestClient(db_app)


@pytest.fixture(autouse=True)
def _drain_push():
    """Commit sonrası arka planda giden push'lar test bitmeden tamamlanır (push_outbox)."""
    yield
    from app.services import push_outbox

    push_outbox.drain()


@pytest.fixture
def route_line_cleanup():
    """Testin yeni oluşturduğu `route_line:*` Redis anahtarlarını siler (öncesinden var olanlara dokunmaz)."""
    from app.services import route_line

    r = route_line._redis()
    before = set(r.scan_iter("route_line:*"))
    yield
    for key in set(r.scan_iter("route_line:*")) - before:
        r.delete(key)


@pytest.fixture
def db(db_app):
    from app.db import SessionLocal

    with SessionLocal() as session:
        yield session


@pytest.fixture
def sms_outbox():
    from app.providers.sms import get_sms_sender

    sender = get_sms_sender()
    sender.outbox.clear()
    return sender.outbox


def random_phone() -> str:
    return "+90532" + str(uuid.uuid4().int)[:7]


def otp_login(client, phone: str, purpose: str = "customer", country_code: str | None = "DE") -> dict:
    from app.providers.sms import get_sms_sender

    outbox = get_sms_sender().outbox
    r = client.post("/api/v1/auth/otp/request", json={"phone": phone, "purpose": purpose, "locale": "en"})
    assert r.status_code == 200, r.text
    code = next(text for p, text in reversed(outbox) if p == phone).split(": ")[1][:6]
    body = {"phone": phone, "purpose": purpose, "code": code}
    if country_code:
        body["country_code"] = country_code
    r = client.post("/api/v1/auth/otp/verify", json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def staff_headers(client, db, roles: list[str]) -> dict:
    from app.models.enums import RoleCode
    from app.services import auth

    email = f"staff-{uuid.uuid4().hex[:8]}@getawaytransfers.com"
    auth.create_staff_user(db, email=email, password="correct horse battery", roles=[RoleCode(r) for r in roles],
                           actor_id=None)
    db.commit()
    r = client.post("/api/v1/auth/staff/login", json={"email": email, "password": "correct horse battery"})
    assert r.status_code == 200, r.text
    step = r.json()
    assert step["setup_required"] is True
    secret = pyotp.parse_uri(step["provisioning_uri"]).secret
    r = client.post("/api/v1/auth/staff/2fa", json={"mfa_token": step["mfa_token"], "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def region_id(client, code: str) -> int:
    return next(r["id"] for r in client.get("/api/v1/regions").json() if r["code"] == code)


def future(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def booking_body(client, *, hours_ahead: float = 72, round_trip: bool = False, booking_type: str = "planli",
                 vehicle: str = "minivan", country: str | None = None, **extra) -> dict:
    body = {
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "kemer"), "address": "Otel Örnek, Kemer"},
        "vehicle_type_code": vehicle,
        "pickup_at": future(hours_ahead),
        "passenger_count": 2,
        "luggage_count": 2,
    }
    if round_trip:
        body["return_pickup_at"] = future(hours_ahead + 24 * 5)
    if country:
        body["country_code"] = country
    quote = client.post("/api/v1/quotes", json=body)
    assert quote.status_code == 200, quote.text
    body.update(
        booking_type=booking_type,
        expected_total=quote.json()["total"],
        passenger_name="Anna Schmidt",
        accept_disclosure=True,
        accept_distance_sales=True,
        locale="de",
    )
    body.update(extra)
    return body


def pay(client, headers: dict, code: str, status: str = "success") -> None:
    r = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers)
    assert r.status_code == 200, r.text
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    r = client.post(f"/api/v1/payments/fake/{oid}/complete", data={"status": status})
    assert r.status_code == 200, r.text
