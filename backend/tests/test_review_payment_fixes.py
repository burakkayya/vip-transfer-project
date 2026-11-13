"""Bağımsız inceleme düzeltmeleri: REV-A-5 (belge süresi dolan sürücünün işleri), REV-A-6 (belirsiz iadenin
mutabakatlı yeniden denenmesi ve elle tamamlanması), REV-A-7 (PENDING'de takılan iade)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

from sqlalchemy import select

from app.localtime import local_date
from app.models import AuditLog, Booking, BookingLeg, Document, Driver, Payment, Refund
from app.models.enums import DriverStatus, LegStatus, PaymentProviderCode, PaymentStatus, RefundStatus
from app.providers.payments import get_payment_provider
from app.services import bookings, jobs
from tests.conftest import staff_headers
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _event, _job, _paid_booking, _region
from tests.trip_clock import backdate_start, make_due

API = "/api/v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _code(r):
    return r.json().get("error", {}).get("code")


def _leg(db, leg_id) -> BookingLeg:
    db.expire_all()
    return db.get(BookingLeg, uuid.UUID(str(leg_id)))


def _accepted(client, ops_headers, *, hours_ahead=72):
    driver, driver_id = onboard_driver(client, ops_headers, online=False)
    customer, code = _paid_booking(client, hours_ahead=hours_ahead)
    job = _job(client, driver, code)
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver)
    assert r.status_code == 200, r.text
    return driver, driver_id, code, r.json()["leg_id"]


def _started(client, db, ops_headers):
    driver, driver_id, code, leg_id = _accepted(client, ops_headers)
    make_due(db, leg_id)
    for event in ("yola_cikti", "vardi", "basladi"):
        assert _event(client, driver, leg_id, event).status_code == 200
    return driver, driver_id, code, leg_id


def _kemer(client):
    k = _region(client, "kemer")
    return float(k["latitude"]), float(k["longitude"])


def _expire_driver_doc(db, driver_id) -> datetime:
    """Sürücünün zorunlu belgesinin süresini doldurur; job'un çalışacağı anı döner."""
    doc = db.scalar(select(Document).where(Document.owner_id == uuid.UUID(str(driver_id)),
                                           Document.doc_type == "src_belgesi"))
    later = _now() + timedelta(hours=1)
    doc.valid_until = local_date(later) - timedelta(days=1)
    db.commit()
    return later


def _set_driver_status(db, driver_id, status: DriverStatus) -> None:
    db.expire_all()
    db.get(Driver, uuid.UUID(str(driver_id))).status = status
    db.commit()


# --- REV-A-5: otomatik pasifleştirmede işler serbest bırakılır ---------------------------


def test_auto_passive_releases_unstarted_legs(client, db, ops):
    _, driver_id, _, leg_id = _accepted(client, ops)
    later = _expire_driver_doc(db, driver_id)

    jobs.expire_documents(db, later)
    db.commit()

    db.expire_all()
    assert db.get(Driver, uuid.UUID(driver_id)).status is DriverStatus.PASSIVE
    leg = _leg(db, leg_id)
    assert leg.status is LegStatus.PENDING and leg.driver_id is None and leg.vehicle_id is None
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == leg_id,
                                           AuditLog.action == "booking_leg.release_suspended_driver"))
    assert log is not None and log.actor_id is None


def test_auto_passive_keeps_started_leg(client, db, ops):
    _, driver_id, _, leg_id = _started(client, db, ops)
    later = _expire_driver_doc(db, driver_id)

    jobs.expire_documents(db, later)
    db.commit()

    leg = _leg(db, leg_id)
    assert leg.status is LegStatus.STARTED and str(leg.driver_id) == driver_id
    assert db.scalar(select(AuditLog).where(AuditLog.entity_id == driver_id,
                                            AuditLog.action == "driver.suspended_with_active_trip"))


def test_suspended_driver_can_finish_own_started_trip(client, db, ops):
    """Yolcu araçtayken yolculuk yarıda bırakılmaz: askıdaki/pasif sürücü kendi başlamış yolculuğunu bitirebilir."""
    driver, driver_id, _, leg_id = _started(client, db, ops)
    _set_driver_status(db, driver_id, DriverStatus.PASSIVE)
    backdate_start(db, leg_id, _leg(db, leg_id).duration_minutes)

    r = _event(client, driver, leg_id, "bitti", _kemer(client))
    assert r.status_code == 200, r.text
    assert _leg(db, leg_id).status is LegStatus.COMPLETED


def test_suspended_driver_cannot_take_other_steps(client, db, ops):
    # Yolcu alınmamış iş: yeni adım atılamaz (askıya alma normalde bu bacağı zaten havuza döndürür).
    driver, driver_id, _, leg_id = _accepted(client, ops)
    make_due(db, leg_id)
    _set_driver_status(db, driver_id, DriverStatus.SUSPENDED)
    r = _event(client, driver, leg_id, "yola_cikti")
    assert r.status_code == 403 and _code(r) == "driver_suspended", r.text
    assert _leg(db, leg_id).status is LegStatus.ASSIGNED


def test_suspended_driver_started_trip_only_finish(client, db, ops):
    driver, driver_id, _, leg_id = _started(client, db, ops)
    other, other_id, _, other_leg = _started(client, db, ops)
    _set_driver_status(db, driver_id, DriverStatus.SUSPENDED)

    # Başlamış bacakta bitirme dışındaki adım durum makinesince reddedilir.
    r = _event(client, driver, leg_id, "basladi")
    assert r.status_code == 409, r.text
    # Başka sürücünün bacağı ve diğer uçlar kapalı kalır.
    r = _event(client, driver, other_leg, "bitti", _kemer(client))
    assert r.status_code == 403 and _code(r) == "driver_suspended", r.text
    for method, url, body in [
        ("get", f"{API}/driver/trips", None),
        ("get", f"{API}/driver/jobs", None),
        ("post", f"{API}/driver/trips/{leg_id}/location", {"lat": 36.9, "lng": 30.7}),
    ]:
        r = getattr(client, method)(url, headers=driver, **({"json": body} if body else {}))
        assert r.status_code == 403 and _code(r) == "driver_suspended", (url, r.text)
    # Yol bileşeni UUID değilse eşleşme yapılmaz.
    r = client.post(f"{API}/driver/trips/not-a-uuid/events", headers=driver, json={"event": "bitti"})
    assert r.status_code == 403 and _code(r) == "driver_suspended", r.text


# --- REV-A-6: belirsiz iade --------------------------------------------------------------


def _paid_payment(client, db) -> Payment:
    _, code = _paid_booking(client)
    db.expire_all()
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    return bookings.paid_payment(db, booking)


def _refund(db, payment: Payment, status: RefundStatus, *, amount="10.00", age_minutes: float = 0) -> uuid.UUID:
    refund = Refund(payment_id=payment.id, amount=D(amount), reason="müşteri iptali | belirsiz: yanıt alınamadı",
                    refund_percent=5, status=status, created_at=_now() - timedelta(minutes=age_minutes))
    db.add(refund)
    db.commit()
    return refund.id


def _spy_refunds(monkeypatch) -> list:
    provider = get_payment_provider()
    calls: list = []
    original = type(provider).refund

    def spy(merchant_oid, amount, *args, **kwargs):
        calls.append((merchant_oid, amount))
        return original(provider, merchant_oid, amount, *args, **kwargs)

    monkeypatch.setattr(provider, "refund", spy)
    return calls


def _status(db, refund_id) -> RefundStatus:
    db.expire_all()
    return db.get(Refund, refund_id).status


def test_unknown_refund_retry_forbidden_for_accounting(client, db, monkeypatch):
    refund_id = _refund(db, _paid_payment(client, db), RefundStatus.UNKNOWN)
    calls = _spy_refunds(monkeypatch)
    finance = staff_headers(client, db, ["muhasebe"])
    for body in (None, {"reconciled": True}):
        r = client.post(f"{API}/admin/refunds/{refund_id}/retry", headers=finance,
                        **({"json": body} if body else {}))
        assert r.status_code == 403, r.text
    assert calls == []
    assert _status(db, refund_id) is RefundStatus.UNKNOWN


def test_unknown_refund_retry_requires_explicit_reconciliation(client, db, monkeypatch):
    refund_id = _refund(db, _paid_payment(client, db), RefundStatus.UNKNOWN)
    calls = _spy_refunds(monkeypatch)
    admin = staff_headers(client, db, ["admin"])
    for body in (None, {}, {"reconciled": False}):
        r = client.post(f"{API}/admin/refunds/{refund_id}/retry", headers=admin,
                        **({"json": body} if body is not None else {}))
        assert r.status_code == 409 and _code(r) == "reconciliation_required", r.text
    assert calls == []

    r = client.post(f"{API}/admin/refunds/{refund_id}/retry", headers=admin, json={"reconciled": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"
    assert len(calls) == 1
    db.expire_all()
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == str(refund_id),
                                           AuditLog.action == "refund.retry"))
    assert log is not None and log.changes["reconciled"] is True and log.changes["previous"] == "belirsiz"


def test_failed_refund_retry_still_allowed_for_accounting(client, db):
    refund_id = _refund(db, _paid_payment(client, db), RefundStatus.FAILED)
    finance = staff_headers(client, db, ["muhasebe"])
    r = client.post(f"{API}/admin/refunds/{refund_id}/retry", headers=finance)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"


def test_unknown_refund_can_be_marked_completed_by_admin(client, db, monkeypatch):
    payment = _paid_payment(client, db)
    refund_id = _refund(db, payment, RefundStatus.UNKNOWN)
    calls = _spy_refunds(monkeypatch)
    url = f"{API}/admin/refunds/{refund_id}/mark-completed"

    finance = staff_headers(client, db, ["muhasebe"])
    assert client.post(url, headers=finance, json={"confirmed": True}).status_code == 403
    admin = staff_headers(client, db, ["admin"])
    r = client.post(url, headers=admin, json={"confirmed": False})
    assert r.status_code == 409 and _code(r) == "reconciliation_required", r.text
    assert _status(db, refund_id) is RefundStatus.UNKNOWN

    r = client.post(url, headers=admin, json={"confirmed": True, "reference": "PANEL-20261113"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"
    assert calls == []  # sağlayıcı yeniden çağrılmaz
    db.expire_all()
    refund = db.get(Refund, refund_id)
    assert refund.status is RefundStatus.COMPLETED and refund.provider_ref == "PANEL-20261113"
    assert db.get(Payment, payment.id).status is PaymentStatus.PARTIALLY_REFUNDED
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == str(refund_id),
                                           AuditLog.action == "refund.mark_completed"))
    assert log is not None and log.changes["previous"] == "belirsiz"

    # Yalnızca belirsiz iade böyle kapatılır.
    failed_id = _refund(db, payment, RefundStatus.FAILED)
    r = client.post(f"{API}/admin/refunds/{failed_id}/mark-completed", headers=admin, json={"confirmed": True})
    assert r.status_code == 409 and _code(r) == "refund_not_unknown", r.text


# --- REV-A-7: PENDING'de takılan iade ----------------------------------------------------


def test_stuck_pending_refund_becomes_unknown(client, db):
    payment = _paid_payment(client, db)
    stuck = _refund(db, payment, RefundStatus.PENDING, age_minutes=jobs.STUCK_REFUND_MINUTES + 5)
    fresh = _refund(db, payment, RefundStatus.PENDING, age_minutes=1)

    assert jobs.mark_stuck_refunds_unknown(db, _now()) >= 1
    db.commit()

    assert _status(db, stuck) is RefundStatus.UNKNOWN
    assert _status(db, fresh) is RefundStatus.PENDING
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == str(stuck),
                                           AuditLog.action == "refund.stuck_pending_unknown"))
    assert log is not None and log.actor_id is None


def test_stuck_pending_manual_refund_untouched(client, db):
    _, code = _paid_booking(client)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    manual = Payment(booking_id=booking.id, provider=PaymentProviderCode.MANUAL,
                     merchant_oid="M" + uuid.uuid4().hex[:20].upper(), amount=D("50.00"),
                     currency=bookings.paid_payment(db, booking).currency, status=PaymentStatus.PAID, paid_at=_now())
    db.add(manual)
    db.commit()
    refund_id = _refund(db, manual, RefundStatus.PENDING, age_minutes=jobs.STUCK_REFUND_MINUTES * 10)

    jobs.mark_stuck_refunds_unknown(db, _now())
    db.commit()
    assert _status(db, refund_id) is RefundStatus.PENDING


def test_stuck_refund_job_scheduled():
    from app import worker

    assert jobs.mark_stuck_refunds_unknown in jobs.ALL_JOBS
    import inspect

    assert "mark_stuck_refunds_unknown" in inspect.getsource(worker.every_minute)
