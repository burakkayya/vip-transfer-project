"""Bağımsız inceleme (REV-B-2 ... REV-B-8) düzeltmelerinin regresyon testleri.

- REV-B-2: teklif hız sınırı Redis istemcisi zaman aşımlı, Redis arızasında açık (fail-open); kimlikli
  rezervasyon oluşturma da kullanıcı başına sınırlı.
- REV-B-3: kimlik doğrulanmamış WebSocket bağlantıları toplam havuzu tüketemez (ayrı havuz + IP sınırı).
- REV-B-4: WebSocket işleri ayrı iş parçacığı sınırlayıcısında; DB'ye yalnızca yeniden doğrulamada gidilir.
- REV-B-5: uçak erken inerse "yolcu alındı" kabul edilir; operasyon kilitli yolculuğu gerekçeyle ilerletebilir.
- REV-B-6: askıya alınan sürücünün bıraktığı bacaklar için yeniden teklif gönderilir.
- REV-B-7: reddedilen belge kotayı doldurmaz, tek bekleyen belge kuralı veritabanında, sürücü geri çekebilir.
- REV-B-8: reddedilen yolculuk adımı denetim kaydı bacak+olay başına dakikada bir.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import redis
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.models import AuditLog, Booking, BookingLeg, DispatchOffer, Document, Driver, DriverLedger, FlightInfo
from app.models.enums import DocumentOwner, DocumentType, FlightDirection, LegStatus
from tests.conftest import PDF, booking_body, otp_login, random_phone, staff_headers
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_dispatch_ws_phase1 import _accepted, _code, _kemer, _leg, _started, _token, _ws_url
from tests.test_trips import _event, _paid_booking
from tests.trip_clock import make_due

API = "/api/v1"


class _RedisDown:
    """Her çağrıda bağlantı hatası veren sahte Redis istemcisi."""

    def __getattr__(self, name):
        def fail(*a, **k):
            raise redis.ConnectionError("down")

        return fail


# --- REV-B-2: teklif hız sınırı -----------------------------------------------


@pytest.fixture
def clean_quote_limits(db_app):
    from app.services import quotes

    def wipe():
        r = quotes._redis()
        for key in r.scan_iter("quotes_rl:*"):
            r.delete(key)

    wipe()
    yield
    wipe()


def _quote_body(client):
    body = booking_body(client)
    return {k: body[k] for k in ("pickup", "dropoff", "vehicle_type_code", "pickup_at", "passenger_count",
                                 "luggage_count")}


def test_quote_rate_limit_redis_client_has_timeouts():
    from app.services import quotes

    kwargs = quotes._redis().connection_pool.connection_kwargs
    assert kwargs.get("socket_timeout") and kwargs.get("socket_connect_timeout")


def test_quote_rate_limit_fails_open_when_redis_down(client, monkeypatch):
    from app.services import quotes

    body = _quote_body(client)
    monkeypatch.setattr(quotes, "_redis", lambda: _RedisDown())
    r = client.post(f"{API}/quotes", json=body)
    assert r.status_code == 200, r.text


def test_customer_booking_quote_rate_limited_per_user(client, monkeypatch, clean_quote_limits):
    first = otp_login(client, random_phone())
    second = otp_login(client, random_phone())
    body = booking_body(client)
    from app.services import quotes

    for key in quotes._redis().scan_iter("quotes_rl:*"):
        quotes._redis().delete(key)
    monkeypatch.setattr(get_settings(), "quotes_rate_limit_per_minute", 1)
    assert client.post(f"{API}/me/bookings", headers=first, json=body).status_code == 201
    r = client.post(f"{API}/me/bookings", headers=first, json=body)
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "too_many_requests"
    # Sınır kullanıcı başınadır; başka müşteri etkilenmez.
    assert client.post(f"{API}/me/bookings", headers=second, json=body).status_code == 201


# --- REV-B-3 / REV-B-4: WebSocket havuzları ------------------------------------


@pytest.fixture
def fast_ws(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ws_poll_seconds", 0.02)
    monkeypatch.setattr(s, "ws_revalidate_seconds", 0.1)
    return s


def test_ws_unauthenticated_connections_do_not_consume_total_pool(client, fast_ws, monkeypatch):
    monkeypatch.setattr(fast_ws, "ws_max_total", 1)
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)):  # kimlik göndermeyen bağlantı
        with client.websocket_connect(_ws_url(code)) as ws:
            ws.send_text(json.dumps({"token": _token(customer)}))
            assert "location" in ws.receive_json()


def test_ws_unauthenticated_connections_limited_per_ip(client, fast_ws, monkeypatch):
    monkeypatch.setattr(fast_ws, "ws_max_pending_per_ip", 1)
    _, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(_ws_url(code)) as second:
                second.receive_json()
        assert exc.value.code == 4429


def test_ws_unauthenticated_pool_is_bounded(client, fast_ws, monkeypatch):
    monkeypatch.setattr(fast_ws, "ws_max_pending", 1)
    _, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(_ws_url(code)) as second:
                second.receive_json()
        assert exc.value.code == 4429


def test_ws_stream_reads_db_only_on_revalidation(client, db, fast_ws, monkeypatch):
    from app.api import customer as customer_api
    from app.services import live_location

    monkeypatch.setattr(fast_ws, "ws_revalidate_seconds", 3600)
    monkeypatch.setattr(live_location, "TRACKABLE", tuple(LegStatus))  # beklemedeki bacak da izlenebilir sayılsın
    customer, code = _paid_booking(client)
    leg = db.scalar(select(BookingLeg).join(Booking).where(Booking.booking_code == code))

    opened: list[int] = []
    real = customer_api.SessionLocal

    def counting():
        opened.append(1)
        return real()

    monkeypatch.setattr(customer_api, "SessionLocal", counting)
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": _token(customer)}))
        ws.receive_json()
        live_location.store(leg, 36.9, 30.7, None, datetime.now(timezone.utc))
        seen = [ws.receive_json() for _ in range(8)]
    assert any(m["location"] and m["location"]["lat"] == 36.9 for m in seen), seen
    assert len(opened) == 1, f"kimlik dışında DB'ye gidildi: {len(opened)}"
    live_location.clear(leg)


def test_ws_thread_work_uses_dedicated_limiter(client, fast_ws, monkeypatch):
    import anyio.to_thread

    calls: list = []
    real = anyio.to_thread.run_sync

    async def recording(func, *args, **kwargs):
        if getattr(func, "__module__", "") == "app.api.customer":
            calls.append(kwargs.get("limiter"))
        return await real(func, *args, **kwargs)

    monkeypatch.setattr(anyio.to_thread, "run_sync", recording)
    customer, code = _paid_booking(client)
    with client.websocket_connect(_ws_url(code)) as ws:
        ws.send_text(json.dumps({"token": _token(customer)}))
        for _ in range(3):
            ws.receive_json()
    assert calls, "WebSocket thread işi görülmedi"
    assert all(lim is not None and lim.total_tokens == fast_ws.ws_thread_limit for lim in calls), calls


# --- REV-B-5 (a): uçak erken indi ----------------------------------------------


def test_start_allowed_when_flight_lands_early(client, db, ops):  # noqa: F811
    driver, _, _, _, leg_id = _accepted(client, ops)
    make_due(db, leg_id, minutes_from_now=150)  # alış 2,5 saat sonra; normal tolerans 30 dk
    now = datetime.now(timezone.utc)
    db.add(FlightInfo(booking_leg_id=uuid.UUID(leg_id), flight_no="TK1234", direction=FlightDirection.ARRIVAL,
                      scheduled_at=now + timedelta(minutes=120), estimated_at=now - timedelta(minutes=5),
                      purge_at=now + timedelta(days=2)))
    db.commit()
    assert _event(client, driver, leg_id, "yola_cikti").status_code == 200
    assert _event(client, driver, leg_id, "vardi").status_code == 200
    r = _event(client, driver, leg_id, "basladi")
    assert r.status_code == 200, r.text


def test_start_still_rejected_without_early_flight(client, db, ops):  # noqa: F811
    driver, _, _, _, leg_id = _accepted(client, ops)
    make_due(db, leg_id, minutes_from_now=150)
    now = datetime.now(timezone.utc)
    db.add(FlightInfo(booking_leg_id=uuid.UUID(leg_id), flight_no="TK1235", direction=FlightDirection.ARRIVAL,
                      scheduled_at=now + timedelta(minutes=120), estimated_at=now + timedelta(minutes=140),
                      purge_at=now + timedelta(days=2)))
    db.commit()
    assert _event(client, driver, leg_id, "yola_cikti").status_code == 200
    assert _event(client, driver, leg_id, "vardi").status_code == 200
    r = _event(client, driver, leg_id, "basladi")
    assert r.status_code == 409 and _code(r) == "too_early_to_start", r.text


# --- REV-B-5 (b): operasyonun zorla ilerletmesi ---------------------------------


def _force(client, headers, leg_id, event, reason="sürücü telefonu arızalı, yolcu teyitli teslim edildi"):
    body = {"event": event}
    if reason is not None:
        body["reason"] = reason
    return client.post(f"{API}/admin/dispatch/legs/{leg_id}/force-advance", headers=headers, json=body)


def test_ops_can_force_finish_locked_trip(client, db, ops):  # noqa: F811
    driver, _, _, _, leg_id = _started(client, db, ops)
    r = _event(client, driver, leg_id, "bitti", _kemer(client))
    assert r.status_code == 409 and _code(r) == "trip_too_short"

    r = _force(client, ops, leg_id, "bitti")
    assert r.status_code == 200, r.text
    assert _leg(db, leg_id).status is LegStatus.COMPLETED
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                           AuditLog.action == "booking_leg.force_advance"))
    assert log is not None and log.changes["reason"].startswith("sürücü telefonu")
    assert log.changes["event"] == "bitti" and log.changes["old_status"] == "basladi"
    assert db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == uuid.UUID(leg_id)))


def test_force_advance_keeps_state_machine_order(client, db, ops):  # noqa: F811
    _, _, _, _, leg_id = _accepted(client, ops)  # atandı
    r = _force(client, ops, leg_id, "bitti")
    assert r.status_code == 409 and _code(r) == "invalid_transition", r.text
    assert _leg(db, leg_id).status is LegStatus.ASSIGNED
    # Zaman penceresi atlanır (alış 72 saat sonra) ama sıra korunur.
    assert _force(client, ops, leg_id, "yola_cikti").status_code == 200
    assert _leg(db, leg_id).status is LegStatus.EN_ROUTE


def test_force_advance_requires_reason_and_ops_role(client, db, ops):  # noqa: F811
    _, _, _, _, leg_id = _accepted(client, ops)
    assert _force(client, ops, leg_id, "yola_cikti", reason=None).status_code == 422
    assert _force(client, ops, leg_id, "yola_cikti", reason="  kısa ").status_code in (400, 422)
    accounting = staff_headers(client, db, ["muhasebe"])
    assert _force(client, accounting, leg_id, "yola_cikti").status_code == 403
    assert _leg(db, leg_id).status is LegStatus.ASSIGNED


# --- REV-B-6: serbest bırakılan bacaklara yeniden teklif -------------------------


def test_released_legs_are_reoffered(client, db, ops):  # noqa: F811
    driver, driver_id, _, code, leg_id = _accepted(client, ops)
    other, other_id = onboard_driver(client, ops, online=False)
    r = client.post(f"{API}/admin/drivers/{driver_id}/status", headers=ops, json={"status": "askida"})
    assert r.status_code == 200 and r.json()["released_legs"] == 1
    db.expire_all()
    offer = db.scalar(select(DispatchOffer).where(DispatchOffer.booking_leg_id == uuid.UUID(leg_id),
                                                  DispatchOffer.driver_id == uuid.UUID(other_id)))
    assert offer is not None
    assert db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                            AuditLog.action == "booking_leg.reoffer_after_release"))


def test_release_driver_supports_system_actor(client, db, ops):  # noqa: F811
    from app.services import dispatch

    _, driver_id, _, _, leg_id = _accepted(client, ops)
    driver = db.get(Driver, uuid.UUID(driver_id))
    released = dispatch.release_driver(db, driver, actor_id=None, ip=None, now=datetime.now(timezone.utc))
    db.commit()
    assert released == 1
    assert _leg(db, leg_id).status is LegStatus.PENDING


# --- REV-B-7: belge kotası ve tek bekleyen belge ---------------------------------


def _new_driver(client):
    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    r = client.post(f"{API}/driver/register", headers=headers, json={"full_name": "Ali Veli"})
    assert r.status_code == 201
    return headers, r.json()["id"]


def _upload(client, headers, doc_type):
    return client.post(f"{API}/driver/documents", headers=headers, data={"doc_type": doc_type},
                       files={"file": ("x.pdf", PDF, "application/pdf")})


def _reject(client, ops_headers, doc_id):
    r = client.post(f"{API}/admin/documents/{doc_id}/review", headers=ops_headers,
                    json={"decision": "reddedildi", "note": "okunmuyor"})
    assert r.status_code == 200, r.text


def test_rejected_documents_do_not_fill_quota(client, ops, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "document_quota_unapproved", 2)
    headers, _ = _new_driver(client)
    r = _upload(client, headers, "surucu_belgesi")
    assert r.status_code == 201
    _reject(client, ops, r.json()["id"])
    assert _upload(client, headers, "surucu_belgesi").status_code == 201
    r = _upload(client, headers, "src_belgesi")
    assert r.status_code == 201, r.text


def test_rejected_documents_have_wider_cap(client, ops, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "document_quota_unapproved", 10)
    monkeypatch.setattr(get_settings(), "document_quota_including_rejected", 2)
    headers, _ = _new_driver(client)
    for _ in range(2):
        r = _upload(client, headers, "surucu_belgesi")
        assert r.status_code == 201
        _reject(client, ops, r.json()["id"])
    r = _upload(client, headers, "surucu_belgesi")
    assert r.status_code == 429 and r.json()["error"]["code"] == "document_quota_exceeded", r.text


def test_single_pending_document_enforced_by_database(client, db):
    from app.errors import Conflict
    from app.providers.storage import get_storage
    from app.services import documents

    _, driver_id = _new_driver(client)
    owner = uuid.UUID(driver_id)
    kwargs = dict(owner_type=DocumentOwner.DRIVER, owner_id=owner, doc_type=DocumentType.DRIVER_LICENSE,
                  content_type="application/pdf", data=PDF, valid_until=None, actor_id=None)
    documents.upload(db, get_storage(), **kwargs)
    db.commit()
    # Kota kontrolü yarışta atlatılmış gibi doğrudan ikinci yükleme.
    with pytest.raises(Conflict) as exc:
        documents.upload(db, get_storage(), **kwargs)
    assert exc.value.code == "document_pending_exists"
    db.rollback()
    assert db.scalar(select(func.count()).select_from(Document).where(Document.owner_id == owner)) == 1


def test_driver_can_withdraw_own_pending_document(client, ops):  # noqa: F811
    headers, _ = _new_driver(client)
    doc_id = _upload(client, headers, "surucu_belgesi").json()["id"]
    other, _ = _new_driver(client)
    assert client.delete(f"{API}/driver/documents/{doc_id}", headers=other).status_code == 404
    assert client.delete(f"{API}/driver/documents/{doc_id}", headers=headers).status_code == 204
    assert all(d["id"] != doc_id for d in client.get(f"{API}/driver/documents", headers=headers).json())
    assert _upload(client, headers, "surucu_belgesi").status_code == 201
    # İncelenmiş belge geri çekilemez.
    reviewed = _upload(client, headers, "src_belgesi").json()["id"]
    _reject(client, ops, reviewed)
    r = client.delete(f"{API}/driver/documents/{reviewed}", headers=headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "document_not_pending", r.text


def test_withdrawals_count_toward_quota(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "document_quota_unapproved", 2)
    headers, _ = _new_driver(client)
    for _ in range(2):
        doc_id = _upload(client, headers, "surucu_belgesi").json()["id"]
        assert client.delete(f"{API}/driver/documents/{doc_id}", headers=headers).status_code == 204
    r = _upload(client, headers, "surucu_belgesi")
    assert r.status_code == 429 and r.json()["error"]["code"] == "document_quota_exceeded", r.text


# --- REV-B-8: reddedilen adım kaydı seyreltme ------------------------------------


def _rejected_logs(db, leg_id) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(AuditLog).where(
        AuditLog.entity_id == leg_id, AuditLog.action == "booking_leg.event_rejected"))


def test_rejected_event_audit_is_throttled(client, db, ops):  # noqa: F811
    driver, _, _, _, leg_id = _started(client, db, ops)
    for _ in range(3):
        r = _event(client, driver, leg_id, "bitti", _kemer(client))
        assert r.status_code == 409 and _code(r) == "trip_too_short"
    assert _rejected_logs(db, leg_id) == 1


def test_rejected_event_audit_written_when_redis_down(client, db, ops, monkeypatch):  # noqa: F811
    from app.services import live_location

    driver, _, _, _, leg_id = _started(client, db, ops)
    monkeypatch.setattr(live_location, "_redis", lambda: _RedisDown())
    for _ in range(2):
        r = _event(client, driver, leg_id, "bitti", _kemer(client))
        assert r.status_code == 409 and _code(r) == "trip_too_short"
    assert _rejected_logs(db, leg_id) == 2

