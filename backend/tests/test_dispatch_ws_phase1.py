"""Güvenlik Faz 1: F1-8 (BIZ-02) yolculuk zaman ve konum kuralları, AUTH-06 askıya alma etkileri,
F1-16 (RT-03, RT-04, RT-05) canlı takip WebSocket'i."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import redis
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.models import AuditLog, AuthSession, BookingLeg
from app.models.enums import LegStatus
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _event, _job, _paid_booking, _region
from tests.trip_clock import backdate_start, make_due

API = "/api/v1"


def _accept(client, driver, code):
    job = _job(client, driver, code)
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver)
    assert r.status_code == 200, r.text
    return r.json()["leg_id"]


def _accepted(client, ops_headers, *, hours_ahead=72):
    driver, driver_id = onboard_driver(client, ops_headers, online=False)
    customer, code = _paid_booking(client, hours_ahead=hours_ahead)
    return driver, driver_id, customer, code, _accept(client, driver, code)


def _kemer(client):
    k = _region(client, "kemer")
    return float(k["latitude"]), float(k["longitude"])


def _code(r):
    return r.json().get("error", {}).get("code")


def _leg(db, leg_id) -> BookingLeg:
    db.expire_all()
    return db.get(BookingLeg, uuid.UUID(leg_id))


def _started(client, db, ops_headers):
    driver, driver_id, customer, code, leg_id = _accepted(client, ops_headers)
    make_due(db, leg_id)
    for event in ("yola_cikti", "vardi", "basladi"):
        assert _event(client, driver, leg_id, event).status_code == 200
    return driver, driver_id, customer, code, leg_id


# --- F1-8 (BIZ-02) -----------------------------------------------------------


def test_trip_cannot_depart_before_window(client, db, ops):
    driver, _, _, _, leg_id = _accepted(client, ops)  # alış 72 saat sonra
    r = _event(client, driver, leg_id, "yola_cikti")
    assert r.status_code == 409 and _code(r) == "too_early_to_depart", r.text
    assert _leg(db, leg_id).status is LegStatus.ASSIGNED

    make_due(db, leg_id, minutes_from_now=60)  # pencere içinde (varsayılan 180 dk)
    assert _event(client, driver, leg_id, "yola_cikti").status_code == 200


def test_trip_cannot_start_before_window(client, db, ops):
    driver, _, _, _, leg_id = _accepted(client, ops)
    make_due(db, leg_id, minutes_from_now=120)
    assert _event(client, driver, leg_id, "yola_cikti").status_code == 200
    assert _event(client, driver, leg_id, "vardi").status_code == 200
    r = _event(client, driver, leg_id, "basladi")
    assert r.status_code == 409 and _code(r) == "too_early_to_start", r.text

    make_due(db, leg_id, minutes_from_now=10)  # varsayılan tolerans 30 dk
    assert _event(client, driver, leg_id, "basladi").status_code == 200


def test_trip_finish_requires_min_duration_after_start(client, db, ops):
    driver, driver_id, _, _, leg_id = _started(client, db, ops)
    r = _event(client, driver, leg_id, "bitti", _kemer(client))
    assert r.status_code == 409 and _code(r) == "trip_too_short", r.text
    assert _leg(db, leg_id).status is LegStatus.STARTED

    # Reddedilen deneme ayrı işlemle denetim kaydına düşer (istek geri alınsa da).
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                           AuditLog.action == "booking_leg.event_rejected"))
    assert log is not None and log.changes["reason_code"] == "trip_too_short"

    backdate_start(db, leg_id, _leg(db, leg_id).duration_minutes)
    assert _event(client, driver, leg_id, "bitti", _kemer(client)).status_code == 200


def test_trip_finish_rejects_impossible_speed_jump(client, db, ops):
    driver, _, _, _, leg_id = _started(client, db, ops)
    backdate_start(db, leg_id, _leg(db, leg_id).duration_minutes)
    # Son paylaşılan konum havalimanı tarafında; birkaç saniye sonra ~40 km ötede "bitti" fiziksel olarak imkânsız.
    assert client.post(f"{API}/driver/trips/{leg_id}/location", headers=driver,
                       json={"lat": 36.9, "lng": 30.8}).status_code == 204
    r = _event(client, driver, leg_id, "bitti", _kemer(client))
    assert r.status_code == 409 and _code(r) == "implausible_location", r.text
    assert _leg(db, leg_id).status is LegStatus.STARTED


def test_early_driver_finish_is_audited(client, db, ops):
    """Asgari süreyi geçen ama planlananın yarısından kısa süren sürücü bitirişi kabul edilir ve işaretlenir."""
    driver, _, _, _, leg_id = _started(client, db, ops)
    planned = _leg(db, leg_id).duration_minutes
    backdate_start(db, leg_id, planned * 0.35)
    assert _event(client, driver, leg_id, "bitti", _kemer(client)).status_code == 200
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                           AuditLog.action == "booking_leg.driver_early_finish"))
    assert log is not None and log.changes["planned_minutes"] == planned


# --- AUTH-06: askıya alma ---------------------------------------------------


def test_suspend_driver_returns_future_legs_to_pending(client, db, ops):
    driver, driver_id, customer, code, leg_id = _accepted(client, ops)
    # Aynı sürücünün yola çıktığı ama yolcuyu henüz almadığı ikinci iş.
    _, code2 = _paid_booking(client, hours_ahead=150)
    leg2 = _accept(client, driver, code2)
    make_due(db, leg2)
    assert _event(client, driver, leg2, "yola_cikti").status_code == 200

    r = client.post(f"{API}/admin/drivers/{driver_id}/status", headers=ops,
                    json={"status": "askida", "reason": "şikâyet incelemesi"})
    assert r.status_code == 200, r.text
    assert r.json()["released_legs"] == 2

    for lid in (leg_id, leg2):
        leg = _leg(db, lid)
        assert leg.status is LegStatus.PENDING and leg.driver_id is None and leg.vehicle_id is None
    assert client.get(f"{API}/me/bookings/{code}", headers=customer).json()["status"] == "onaylandi"
    assert db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                            AuditLog.action == "booking_leg.release_suspended_driver"))

    other, _ = onboard_driver(client, ops, online=False)
    assert _job(client, other, code) is not None  # iş havuza geri döndü


def test_suspend_driver_keeps_started_trip(client, db, ops):
    """Yolcu araçtayken bacak havuza düşürülmez (yolcu güvenliği); operasyon elle yönetir."""
    driver, driver_id, _, _, leg_id = _started(client, db, ops)
    r = client.post(f"{API}/admin/drivers/{driver_id}/status", headers=ops, json={"status": "askida"})
    assert r.status_code == 200 and r.json()["released_legs"] == 0
    leg = _leg(db, leg_id)
    assert leg.status is LegStatus.STARTED and str(leg.driver_id) == driver_id


def test_suspend_driver_revokes_sessions(client, db, ops):
    driver, driver_id = onboard_driver(client, ops, online=False)
    assert client.get(f"{API}/driver/me", headers=driver).status_code == 200
    r = client.post(f"{API}/admin/drivers/{driver_id}/status", headers=ops, json={"status": "askida"})
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/driver/me", headers=driver).status_code == 401


# --- F1-16 (RT-03, RT-04, RT-05) ---------------------------------------------


@pytest.fixture
def fast_ws(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ws_poll_seconds", 0.05)
    monkeypatch.setattr(s, "ws_revalidate_seconds", 0.1)
    return s


def _token(headers) -> str:
    return headers["Authorization"].split()[1]


def _ws_url(code):
    return f"{API}/ws/bookings/{code}/location"


def _drain_until_closed(ws, limit=400) -> int:
    for _ in range(limit):
        try:
            ws.receive_json()
        except WebSocketDisconnect as exc:
            return exc.code
    raise AssertionError("bağlantı kapanmadı")


def test_ws_closes_after_session_revoked(client, db, fast_ws):
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": _token(customer)}))
        assert "location" in ws.receive_json()
        sid = jwt.decode(_token(customer), options={"verify_signature": False})["sid"]
        db.get(AuthSession, uuid.UUID(sid)).revoked_at = datetime.now(timezone.utc)
        db.commit()
        assert _drain_until_closed(ws) == 4401


def test_ws_closes_after_token_expiry(client, db, fast_ws):
    customer, code = _paid_booking(client)
    claims = jwt.decode(_token(customer), options={"verify_signature": False})
    now = datetime.now(timezone.utc)
    short = jwt.encode({**claims, "iat": now, "exp": now + timedelta(seconds=1)}, fast_ws.jwt_secret,
                       algorithm="HS256")
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": short}))
        assert "location" in ws.receive_json()
        assert _drain_until_closed(ws) == 4401


def test_ws_closes_when_all_legs_terminal(client, db, fast_ws):
    customer, code = _paid_booking(client)
    assert client.post(f"{API}/me/bookings/{code}/cancel", headers=customer, json={}).status_code == 200
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": _token(customer)}))
        assert _drain_until_closed(ws) == 1000


def test_ws_rejects_oversized_first_message(client, fast_ws):
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": _token(customer), "pad": "x" * 5000}))
        assert _drain_until_closed(ws) == 1009


def test_ws_first_message_timeout(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ws_auth_timeout_seconds", 0.2)
    _, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as ws:
        assert _drain_until_closed(ws) == 4408


def test_ws_connection_limit_per_session(client, fast_ws, monkeypatch):
    monkeypatch.setattr(fast_ws, "ws_max_per_session", 1)
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as first:
        first.send_text(json.dumps({"token": _token(customer)}))
        assert "location" in first.receive_json()
        with client.websocket_connect(_ws_url(code)) as second:
            second.send_text(json.dumps({"token": _token(customer)}))
            assert _drain_until_closed(second) == 4429
        assert "location" in first.receive_json()  # ilk bağlantı etkilenmez
    # İlk bağlantı kapanınca yer açılır.
    with client.websocket_connect(_ws_url(code)) as again:
        again.send_text(json.dumps({"token": _token(customer)}))
        assert "location" in again.receive_json()


def test_ws_connection_limit_per_booking(client, fast_ws, monkeypatch):
    monkeypatch.setattr(fast_ws, "ws_max_per_booking", 1)
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as first:
        first.send_text(json.dumps({"token": _token(customer)}))
        assert "location" in first.receive_json()
        with client.websocket_connect(_ws_url(code)) as second:
            second.send_text(json.dumps({"token": _token(customer)}))
            assert _drain_until_closed(second) == 4429


def test_live_location_redis_client_has_timeouts():
    from app.services import live_location

    kwargs = live_location._redis().connection_pool.connection_kwargs
    assert kwargs.get("socket_timeout") and kwargs.get("socket_connect_timeout")


def test_driver_location_redis_error_is_controlled(client, monkeypatch):
    """Redis erişilemezse canlı konum 500 yerine "konum yok" (null) döner."""
    from app.services import live_location

    class Down:
        def get(self, *a, **k):
            raise redis.ConnectionError("down")

    customer, code = _paid_booking(client)
    # Bacak beklemede; Redis'e gidilmesi için her durum izlenebilir sayılır.
    monkeypatch.setattr(live_location, "TRACKABLE", tuple(LegStatus))
    monkeypatch.setattr(live_location, "_redis", lambda: Down())
    r = client.get(f"{API}/me/bookings/{code}/driver-location", headers=customer)
    assert r.status_code == 200 and r.json() is None
