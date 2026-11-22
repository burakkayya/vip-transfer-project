"""K-83: istek kimliği, olaylar (incident) ve e-posta bildirimi, istemci hata raporu, yolculuk geçmişi ve saklama
süreleri."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models import AuditLog, Booking, BookingActivity, Incident, IncidentOccurrence, TripEvent
from tests.conftest import booking_body, otp_login, random_phone, staff_headers
from tests.test_api_driver_admin import ops  # noqa: F401 - fikstür
from tests.test_trips import _accepted, _event, _region
from tests.trip_clock import relaxed_trip_clock  # noqa: F401 - fikstür

API = "/api/v1"


@pytest.fixture
def email_outbox(monkeypatch):
    from app.config import get_settings
    from app.providers.email import get_email_sender

    monkeypatch.setattr(get_settings(), "incident_alert_emails", ["ops@example.test"])
    sender = get_email_sender()
    sender.outbox.clear()
    return sender.outbox


@pytest.fixture
def boom_route(db_app):
    """Yakalanmamış hata üreten geçici uç (yalnızca bu testlerde)."""

    def boom(phone: str = ""):
        raise RuntimeError(f"gizli ayrıntı {phone}")

    path = f"{API}/_k83_boom"
    db_app.router.add_api_route(path, boom, methods=["GET"])
    yield path
    db_app.router.routes[:] = [r for r in db_app.router.routes if getattr(r, "path", None) != path]


def _unpaid_booking(client) -> str:
    """Ödenmemiş rezervasyon: sürücü havuzuna girmez (havuz 50 işle sınırlı; test veritabanı oturum boyunca birikir)."""
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client))
    assert r.status_code == 201, r.text
    return r.json()["booking_code"]


def _incident(db, code: str) -> Incident | None:
    db.expire_all()
    return db.scalar(select(Incident).where(Incident.code == code).order_by(Incident.last_seen_at.desc()))


# --- İstek kimliği ------------------------------------------------------------------------------------------------


def test_request_id_is_echoed_or_generated(client):
    r = client.get(f"{API}/regions", headers={"X-Request-ID": "web-1234abcd"})
    assert r.headers["X-Request-ID"] == "web-1234abcd"
    # Biçim dışı değer (log enjeksiyonu) yok sayılır, yenisi üretilir.
    r = client.get(f"{API}/regions", headers={"X-Request-ID": "bad id with spaces"})
    assert r.headers["X-Request-ID"] != "bad id with spaces" and len(r.headers["X-Request-ID"]) == 32


def test_json_log_line_has_route_template_not_query(client, caplog):
    from app.logging_setup import ContextFilter, JsonFormatter

    caplog.set_level(logging.INFO, logger="app.access")
    client.get(f"{API}/regions?telefon=905321234567", headers={"X-Request-ID": "trace-abcdef12"})
    record = next(r for r in caplog.records if r.name == "app.access" and getattr(r, "status", None) == 200)
    ContextFilter().filter(record)
    line = json.loads(JsonFormatter().format(record))
    assert line["request_id"] == "trace-abcdef12" and line["route"] == "/api/v1/regions"
    assert "905321234567" not in json.dumps(line)


# --- Olaylar --------------------------------------------------------------------------------------------------------


def test_unhandled_error_returns_request_id_and_records_incident(client, db, boom_route, email_outbox):
    r = client.get(boom_route, params={"phone": "+905321234567"},
                   headers={"X-Request-ID": "req-boom-0001", "X-Client-Platform": "ios", "X-Client-Version": "1.4.2"})
    assert r.status_code == 500
    assert r.json()["error"] == {"code": "internal_error", "message": "beklenmeyen bir hata oluştu",
                                 "request_id": "req-boom-0001"}
    inc = _incident(db, "RuntimeError")
    assert inc is not None and inc.level == "error" and inc.source == "backend" and inc.status == "open"
    # İstisna iletisi (kişisel veri taşıyabilir) yazılmaz; yalnızca kod konumu.
    assert "905321234567" not in (inc.detail or "") and "boom" in (inc.detail or "")
    occ = db.scalar(select(IncidentOccurrence).where(IncidentOccurrence.request_id == "req-boom-0001"))
    ctx = json.loads(occ.context)
    assert ctx["route"] == boom_route and ctx["platform"] == "ios" and ctx["app_version"] == "1.4.2"
    assert ctx["status"] == 500
    # Şifreli: veritabanında düz metin görünmez.
    raw = db.execute(text("select context from incident_occurrences where id = :i"), {"i": occ.id}).scalar()
    assert "req-boom-0001" not in raw
    assert len(email_outbox) == 1
    to, subject, body = email_outbox[0]
    assert to == ["ops@example.test"] and "RuntimeError" in subject and f"/incidents/{inc.id}" in body


def test_repeated_incident_is_grouped_throttled_and_reopened(client, db, boom_route, email_outbox, ops):
    client.get(boom_route)
    first = _incident(db, "RuntimeError")
    count = first.occurrence_count
    sent = len(email_outbox)
    client.get(boom_route)
    again = _incident(db, "RuntimeError")
    assert again.id == first.id and again.occurrence_count == count + 1
    assert len(email_outbox) == sent  # aynı olay saatte bir bildirilir

    # Çözüldü: not zorunlu; tekrar ederse yeniden açılır ve yeniden bildirilir.
    r = client.post(f"{API}/admin/incidents/{first.id}/status", headers=ops, json={"status": "resolved"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "note_required"
    r = client.post(f"{API}/admin/incidents/{first.id}/status", headers=ops,
                    json={"status": "resolved", "note": "Test ucu kaldırılacak"})
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    client.get(boom_route)
    reopened = _incident(db, "RuntimeError")
    assert reopened.status == "open"
    assert len(email_outbox) == sent + 1


def test_worker_job_failure_becomes_incident(db_app, db, email_outbox):
    from app import worker

    def failing_job(_db, _now):
        raise ValueError("iş patladı")

    failing_job.__name__ = f"k83_job_{uuid.uuid4().hex[:6]}"
    assert worker._run(failing_job) is False
    inc = _incident(db, f"{failing_job.__name__}:ValueError")
    assert inc is not None and inc.source == "worker" and inc.kind == "job_failure"


def test_incident_report_never_raises(monkeypatch):
    from app.services import incidents

    monkeypatch.setattr("app.db.SessionLocal", lambda: (_ for _ in ()).throw(RuntimeError("db yok")))
    assert incidents.report(source="backend", kind="x", code="y", title="z") is None


# --- İstemci hata raporu --------------------------------------------------------------------------------------------


def test_client_error_report_is_scrubbed_and_rate_limited(client, db, monkeypatch):
    from app.config import get_settings

    code = f"render_{uuid.uuid4().hex[:6]}"
    r = client.post(f"{API}/client-errors", json={
        "source": "mobile_customer", "code": code, "screen": "/bookings/[code]",
        "message": "TypeError at user anna@example.com +90 532 123 45 67", "stack": "at render (Booking.tsx:12)",
        "app_version": "2.0.1", "request_id": "client-req-01"})
    assert r.status_code == 202
    inc = _incident(db, code)
    assert inc.source == "mobile_customer" and inc.kind == "client_error"
    assert "anna@example.com" not in inc.title + (inc.detail or "")
    assert "532 123 45 67" not in inc.title + (inc.detail or "")
    assert "Booking.tsx:12" in inc.detail

    # Geçersiz kaynak reddedilir.
    assert client.post(f"{API}/client-errors", json={"source": "x", "message": "m"}).status_code == 422
    monkeypatch.setattr(get_settings(), "client_error_rate_limit_per_10min", 0)
    r = client.post(f"{API}/client-errors", json={"source": "web", "message": "m"})
    assert r.status_code == 429


# --- Admin erişimi --------------------------------------------------------------------------------------------------


def test_incident_and_timeline_access_is_admin_or_operations_only(client, db, ops, boom_route):
    client.get(boom_route)
    support = staff_headers(client, db, ["destek"])
    accounting = staff_headers(client, db, ["muhasebe"])
    for headers in (support, accounting):
        assert client.get(f"{API}/admin/incidents", headers=headers).status_code == 403
    customer = otp_login(client, random_phone())
    assert client.get(f"{API}/admin/incidents", headers=customer).status_code == 403

    listing = client.get(f"{API}/admin/incidents", headers=ops).json()
    assert listing["total"] >= 1
    detail = client.get(f"{API}/admin/incidents/{listing['items'][0]['id']}", headers=ops).json()
    assert detail["occurrences"] and "context" in detail["occurrences"][0]
    count = client.get(f"{API}/admin/incidents/count", headers=ops).json()
    assert count["active"] >= 1


# --- Yolculuk geçmişi -----------------------------------------------------------------------------------------------


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_timeline_covers_customer_and_driver_steps_with_reason(client, db, ops):
    driver, customer, code, leg_id = _accepted(client, ops)
    ayt = _region(client, "ayt")
    pickup = (float(ayt["latitude"]), float(ayt["longitude"]))
    for event, point in (("yola_cikti", (pickup[0] + 0.2, pickup[1])), ("vardi", pickup), ("basladi", None)):
        assert _event(client, driver, leg_id, event, point).status_code == 200
    r = client.post(f"{API}/me/bookings/{code}/messages", headers={**customer, "X-Client-Platform": "android"},
                    json={"body": "Kapıdayım, +90 532 000 00 00"})
    assert r.status_code in (200, 201), r.text

    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    r = client.post(f"{API}/admin/bookings/{booking.id}/timeline", headers=ops, json={"reason": "x"})
    assert r.status_code == 422  # gerekçe zorunlu (en az 5 karakter)
    r = client.post(f"{API}/admin/bookings/{booking.id}/timeline", headers=ops, json={"reason": "Şikâyet #42"})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    events = [i["event"] for i in items]
    for expected in ("booking.created", "payment.started", "payment.succeeded", "leg.assigned", "leg.departed",
                     "leg.arrived", "leg.started", "chat.message_sent"):
        assert expected in events, (expected, events)
    # Denetimdeki karşılığı tekrar edilmez.
    assert "booking.create" not in events and "payment.paid" not in events
    assert events.index("booking.created") < events.index("payment.succeeded") < events.index("leg.arrived")
    # Konum yalnızca önemli anda: varışta var, yola çıkışta yok (K-63).
    by_event = {i["event"]: i for i in items}
    assert by_event["leg.arrived"]["location"] is not None
    assert by_event["leg.departed"]["location"] is None
    chat = by_event["chat.message_sent"]
    assert chat["actor_type"] == "customer" and chat["platform"] == "android"
    assert "532" not in json.dumps(items, default=str)  # mesaj metni geçmişe girmez
    # Açılış denetim kaydında.
    db.expire_all()
    viewed = db.scalar(select(AuditLog).where(AuditLog.action == "booking.timeline_view",
                                              AuditLog.entity_id == str(booking.id)))
    assert viewed is not None and viewed.changes["reason"] == "Şikâyet #42"


def test_booking_activities_are_append_only(client, db):
    code = _unpaid_booking(client)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    row_id = db.scalar(select(BookingActivity.id).where(BookingActivity.booking_id == booking.id).limit(1))
    for stmt in ("update booking_activities set event = 'x' where id = :i",
                 "delete from booking_activities where id = :i"):
        with pytest.raises(DBAPIError):
            db.execute(text(stmt), {"i": row_id})
        db.rollback()
    with pytest.raises(DBAPIError):
        db.execute(text("delete from audit_logs where id = (select id from audit_logs limit 1)"))
    db.rollback()


# --- Saklama süreleri -----------------------------------------------------------------------------------------------


def test_retention_purge_deletes_and_clears_location(client, db):
    from app import retention
    from app.services import activity

    code = _unpaid_booking(client)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=retention.ACTIVITY_DAYS + 1)
    mid = now - timedelta(days=retention.LOCATION_DAYS + 1)
    marker = f"k83.test.{uuid.uuid4().hex[:6]}"
    activity.record(db, booking, marker + ".old", actor_type="system", at=old)
    activity.record(db, booking, "leg.arrived", actor_type="system", at=mid, latitude=36.9, longitude=30.8,
                    data={"marker": marker})
    leg = booking.legs[0]
    db.add(TripEvent(booking_leg_id=leg.id, event_type="vardi", latitude=36.9, longitude=30.8, occurred_at=mid))
    audit_id = uuid.uuid4()
    db.add(AuditLog(id=audit_id, action="k83.test", entity_type="test", created_at=old))
    db.commit()

    assert retention.purge(db, now) >= 3
    db.commit()
    db.expire_all()
    assert db.scalar(select(BookingActivity).where(BookingActivity.event == marker + ".old")) is None
    kept = db.scalars(select(BookingActivity).where(BookingActivity.booking_id == booking.id,
                                                    BookingActivity.event == "leg.arrived")).all()
    assert kept and all(a.location is None for a in kept)
    assert all(e.latitude is None for e in db.scalars(select(TripEvent).where(TripEvent.booking_leg_id == leg.id,
                                                                              TripEvent.occurred_at <= mid)))
    assert db.get(AuditLog, audit_id) is None
    # Bayrak işlem içi: purge'den sonra tetikleyici yine korur.
    row_id = db.scalar(select(BookingActivity.id).where(BookingActivity.booking_id == booking.id).limit(1))
    with pytest.raises(DBAPIError):
        db.execute(text("delete from booking_activities where id = :i"), {"i": row_id})
    db.rollback()


def test_retention_policy_endpoint(client, db, ops):
    items = client.get(f"{API}/admin/retention-policy", headers=ops).json()["items"]
    assert any(i["data"].startswith("Yolculuk geçmişi") and i["days"] == 730 for i in items)
