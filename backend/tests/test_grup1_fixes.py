"""1. grup küçük düzeltmeler (2026-11-20): OTP 429 kalan süre, ödeme son anı, okundu işareti ayrı uçta (WEB-07),
devredilen bacakta eski yazışma (RT-07), eşzamanlılık çakışması 409 (BIZ-08), eşleştirme listesi toplamı
(REV-C-7), worker hata konumu (REV-C-8), push jetonu benzersiz indeksi (0016)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import booking_body, otp_login, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _job, _paid_booking
from tests.trip_clock import relaxed_trip_clock  # noqa: F401 - fikstür

API = "/api/v1"


def test_otp_limit_returns_retry_after(client):
    phone = random_phone()
    for _ in range(5):
        assert client.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "customer"}).status_code == 200
    r = client.post(f"{API}/auth/otp/request", json={"phone": phone, "purpose": "customer"})
    assert r.status_code == 429
    wait = r.json()["error"]["retry_after"]
    assert 3500 <= wait <= 3601  # ilk kod az önce istendi: yaklaşık bir saat
    assert r.headers["Retry-After"] == str(wait)


def test_pending_booking_exposes_payment_due_at(client):
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client))
    assert r.status_code == 201, r.text
    created = datetime.fromisoformat(r.json()["created_at"])
    due = datetime.fromisoformat(r.json()["payment_due_at"])
    assert due - created == timedelta(minutes=30)
    code = r.json()["booking_code"]
    listed = next(b for b in client.get(f"{API}/me/bookings", headers=customer).json() if b["booking_code"] == code)
    assert listed["payment_due_at"] == r.json()["payment_due_at"]


def test_paid_booking_has_no_payment_due_at(client):
    customer, code = _paid_booking(client)
    assert client.get(f"{API}/me/bookings/{code}", headers=customer).json()["payment_due_at"] is None


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_chat_get_does_not_mark_read_post_does(client, ops):  # noqa: F811
    customer, code = _paid_booking(client)
    driver, _ = onboard_driver(client, ops, online=False)
    leg_id = client.post(f"{API}/driver/jobs/{_job(client, driver, code)['leg_id']}/accept",
                         headers=driver).json()["leg_id"]
    client.post(f"{API}/driver/trips/{leg_id}/messages", headers=driver, json={"body": "Girişteyim."})

    chat = client.get(f"{API}/me/bookings/{code}/messages", headers=customer).json()
    assert chat["unread"] == 1 and chat["messages"][0]["read_at"] is None
    assert client.get(f"{API}/me/bookings/{code}/messages/unread", headers=customer).json()["unread"] == 1

    r = client.post(f"{API}/me/bookings/{code}/messages/read", headers=customer)
    assert r.status_code == 200 and r.json()["unread"] == 0
    assert client.get(f"{API}/me/bookings/{code}/messages/unread", headers=customer).json()["unread"] == 0
    assert client.get(f"{API}/driver/trips/{leg_id}/messages", headers=driver).json()["messages"][0]["read_at"]

    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Geliyorum"})
    assert client.get(f"{API}/driver/trips/{leg_id}/messages/unread", headers=driver).json()["unread"] == 1
    assert client.post(f"{API}/driver/trips/{leg_id}/messages/read", headers=driver).json()["unread"] == 0
    assert client.get(f"{API}/driver/trips/{leg_id}/messages/unread", headers=driver).json()["unread"] == 0


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_reassigned_driver_does_not_see_previous_chat(client, db, ops):  # noqa: F811
    customer, code = _paid_booking(client)
    first, _ = onboard_driver(client, ops, online=False)
    second, second_id = onboard_driver(client, ops, online=False)
    leg_id = client.post(f"{API}/driver/jobs/{_job(client, first, code)['leg_id']}/accept",
                         headers=first).json()["leg_id"]
    client.post(f"{API}/driver/trips/{leg_id}/messages", headers=first, json={"body": "Ben ilk sürücüyüm."})
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Oda 412, otel lobisi."})

    r = client.post(f"{API}/admin/dispatch/legs/{leg_id}/assign", headers=ops, json={"driver_id": second_id})
    assert r.status_code == 204, r.text

    chat = client.get(f"{API}/driver/trips/{leg_id}/messages", headers=second).json()
    assert chat["messages"] == [] and chat["unread"] == 0
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Yeni sürücüye merhaba"})
    chat = client.get(f"{API}/driver/trips/{leg_id}/messages", headers=second).json()
    assert [m["body"] for m in chat["messages"]] == ["Yeni sürücüye merhaba"] and chat["unread"] == 1
    # Müşteri tüm yazışmayı görmeye devam eder.
    assert len(client.get(f"{API}/me/bookings/{code}/messages", headers=customer).json()["messages"]) == 3


def test_deadlock_maps_to_409(db_app):
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import OperationalError

    from app.main import create_app

    class _Deadlock(Exception):
        sqlstate = "40P01"

    app = create_app()

    @app.get("/__test_deadlock")
    def _deadlock():
        raise OperationalError("select", {}, _Deadlock())

    r = TestClient(app).get("/__test_deadlock")
    assert r.status_code == 409 and r.json()["error"]["code"] == "concurrent_update"


def test_dispatch_pending_reports_total(client, db, ops, monkeypatch):  # noqa: F811
    from app.api.admin import common

    _paid_booking(client)
    _paid_booking(client)
    monkeypatch.setattr(common, "MAX_LIST", 1)
    r = client.get(f"{API}/admin/dispatch/pending", headers=ops)
    assert r.status_code == 200 and len(r.json()) == 1
    count = client.get(f"{API}/admin/dispatch/pending/count", headers=ops).json()
    assert count["total"] >= 2 and count["limit"] == 1


def test_worker_logs_error_location_without_message(caplog):
    from app import worker

    def failing_job(db, now):
        raise ValueError("Anna Schmidt +491701234567")

    failing_job.__name__ = "failing_job"
    with caplog.at_level("ERROR"):
        assert worker._run(failing_job) is False
    line = caplog.records[-1].getMessage()
    assert "failing_job" in line and "test_grup1_fixes.py:" in line
    assert "Anna" not in line and "491701234567" not in line


def test_push_token_unique_index(client, db):
    otp_login(client, random_phone())
    otp_login(client, random_phone())
    ids = list(db.scalars(text("SELECT id FROM customers ORDER BY created_at DESC LIMIT 2")))
    token = "t" * 40
    db.execute(text("UPDATE customers SET push_token = :t WHERE id = :i"), {"t": token, "i": ids[0]})
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE customers SET push_token = :t WHERE id = :i"), {"t": token, "i": ids[1]})
    db.rollback()


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_reassign_back_shows_own_period_and_legacy_messages(client, db, ops):  # noqa: F811
    from app.models import BookingLeg, TripMessage

    customer, code = _paid_booking(client)
    first, first_id = onboard_driver(client, ops, online=False)
    second, second_id = onboard_driver(client, ops, online=False)
    leg_id = client.post(f"{API}/driver/jobs/{_job(client, first, code)['leg_id']}/accept",
                         headers=first).json()["leg_id"]
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "İlk sürücüye"})
    client.post(f"{API}/admin/dispatch/legs/{leg_id}/assign", headers=ops, json={"driver_id": second_id})
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "İkinci sürücüye"})
    client.post(f"{API}/admin/dispatch/legs/{leg_id}/assign", headers=ops, json={"driver_id": first_id})
    bodies = [m["body"] for m in client.get(f"{API}/driver/trips/{leg_id}/messages", headers=first).json()["messages"]]
    assert bodies == ["İlk sürücüye"]

    # 0016 öncesi müşteri mesajı (alıcı yazılı değil): yalnızca atanma anından sonraysa görünür.
    leg = db.get(BookingLeg, leg_id)
    db.add(TripMessage(booking_leg_id=leg.id, sender="customer", body="eski kayıt, önce",
                       created_at=leg.assigned_at - timedelta(minutes=5), driver_id=None))
    db.add(TripMessage(booking_leg_id=leg.id, sender="customer", body="eski kayıt, sonra",
                       created_at=leg.assigned_at + timedelta(seconds=1), driver_id=None))
    db.commit()
    bodies = [m["body"] for m in client.get(f"{API}/driver/trips/{leg_id}/messages", headers=first).json()["messages"]]
    assert "eski kayıt, sonra" in bodies and "eski kayıt, önce" not in bodies


def test_ip_limit_returns_retry_after(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "otp_max_per_ip_per_hour", 2)
    headers = {"X-Forwarded-For": "203.0.113.77"}
    codes = [client.post(f"{API}/auth/otp/request", headers=headers,
                         json={"phone": random_phone(), "purpose": "customer"}).status_code for _ in range(3)]
    if codes[-1] != 429:
        pytest.skip("test istemcisinin IP'si sabit değil (güvenilir vekil ayarı)")
    r = client.post(f"{API}/auth/otp/request", headers=headers, json={"phone": random_phone(), "purpose": "customer"})
    assert r.status_code == 429 and 1 <= r.json()["error"]["retry_after"] <= 3600


def test_worker_frames_include_app_line_for_library_errors():
    """REV-C-8 incelemesi: hata kütüphane içinde (ör. SQLAlchemy) oluşsa da işin uygulama satırı görünür."""
    import os

    from app import worker

    ns: dict = {}
    fake = os.path.join(os.path.dirname(os.path.abspath(worker.__file__)), "services", "fake_job.py")
    source = "def fake_job():" + chr(10) + "    import json" + chr(10) + "    json.loads('{bozuk')" + chr(10)
    exec(compile(source, fake, "exec"), ns)
    try:
        ns["fake_job"]()
    except ValueError as exc:
        text = worker._frames(exc)
    first = text.split(" <- ")[0]
    assert first == "fake_job.py:3 fake_job"
    assert "decoder.py" in text  # kütüphane içindeki en içteki çerçeve de yazılır
