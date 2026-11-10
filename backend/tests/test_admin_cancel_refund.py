"""K-57: admin yolculuk iptali (başlamış yolculuk dahil), elle para iadesi ve sürücü hakedişi iptali."""

from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.models import AuditLog, Booking, DriverLedger, DriverPayout
from tests.conftest import booking_body, otp_login, pay, random_phone, staff_headers
from tests.test_api_driver_admin import onboard_driver


@pytest.fixture
def ops(client, db):
    return staff_headers(client, db, ["operasyon"])


def _accepted_instant(client, ops):
    driver, _ = onboard_driver(client, ops)
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=0, booking_type="anlik"),
                    headers=customer)
    assert r.status_code == 201, r.text
    code, booking_id = r.json()["booking_code"], r.json()["id"]
    pay(client, customer, code)
    offer = next(o for o in client.get("/api/v1/driver/offers", headers=driver).json()
                 if o["trip"]["booking_code"] == code)
    leg_id = client.post(f"/api/v1/driver/offers/{offer['offer_id']}/accept", headers=driver).json()["leg_id"]
    return driver, customer, code, booking_id, leg_id


def _event(client, driver, leg_id, event, **extra):
    r = client.post(f"/api/v1/driver/trips/{leg_id}/events", headers=driver, json={"event": event, **extra})
    assert r.status_code == 200, r.text


def _complete(client, driver, leg_id):
    for e in ("yola_cikti", "vardi", "basladi"):
        _event(client, driver, leg_id, e)
    kemer = next(x for x in client.get("/api/v1/regions").json() if x["code"] == "kemer")
    _event(client, driver, leg_id, "bitti", lat=float(kemer["latitude"]), lng=float(kemer["longitude"]))


def test_admin_cancels_started_trip_with_full_refund(client, db, ops):
    driver, customer, code, booking_id, leg_id = _accepted_instant(client, ops)
    for e in ("yola_cikti", "vardi", "basladi"):
        _event(client, driver, leg_id, e)
    assert client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()["status"] == "yolculukta"
    # Müşteri başlamış yolculuğu iptal edemez, personel edebilir.
    r = client.post(f"/api/v1/me/bookings/{code}/cancel", json={"reason": "vazgeçtim"}, headers=customer)
    assert r.json()["error"]["code"] == "not_cancellable"
    r = client.post(f"/api/v1/admin/bookings/{booking_id}/cancel", headers=ops,
                    json={"reason": "araç arızası, yolcu başka araçla", "refund_percent": 100})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "iptal"
    assert r.json()["legs"][0]["status"] == "iptal"
    detail = client.get(f"/api/v1/admin/bookings/{booking_id}", headers=ops).json()
    assert detail["payments"][0]["status"] == "iade_edildi"
    assert detail["payments"][0]["refundable"] == "0.00"
    # İptal edilen yolculuk sürücü tarafından bitirilemez.
    r = client.post(f"/api/v1/driver/trips/{leg_id}/events", headers=driver, json={"event": "bitti"})
    assert r.status_code >= 400


def test_completed_trip_refund_and_earning_cancel(client, db, ops):
    driver, customer, code, booking_id, leg_id = _accepted_instant(client, ops)
    _complete(client, driver, leg_id)
    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    paid = b.total_amount

    # Tamamlanmış yolculuk iptal edilemez; iade ve hakediş iptali ayrı işlemlerdir.
    r = client.post(f"/api/v1/admin/bookings/{booking_id}/cancel", headers=ops, json={"reason": "deneme iptal"})
    assert r.json()["error"]["code"] == "not_cancellable"

    r = client.post(f"/api/v1/admin/bookings/{booking_id}/refund", headers=ops,
                    json={"amount": str(paid + 1), "reason": "fazla iade"})
    assert r.json()["error"]["code"] == "refund_exceeds_payment"
    r = client.post(f"/api/v1/admin/bookings/{booking_id}/refund", headers=ops,
                    json={"amount": "10.00", "reason": "geç kalındı, kısmi iade"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"
    detail = client.get(f"/api/v1/admin/bookings/{booking_id}", headers=ops).json()
    assert detail["payments"][0]["status"] == "kismi_iade"
    assert D(detail["payments"][0]["refundable"]) == paid - D("10.00")

    earning = detail["earnings"][0]
    assert earning["status"] == "beklemede"
    r = client.post(f"/api/v1/admin/ledger/{earning['id']}/cancel", headers=ops, json={"reason": "şikayet"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "iptal"
    r = client.post(f"/api/v1/admin/ledger/{earning['id']}/cancel", headers=ops, json={"reason": "şikayet"})
    assert r.json()["error"]["code"] == "ledger_already_cancelled"
    earnings = client.get("/api/v1/driver/earnings", headers=driver).json()
    assert D(earnings["pending_try"]) == 0
    assert db.scalar(select(AuditLog).where(AuditLog.action == "ledger.cancel",
                                            AuditLog.entity_id == earning["id"])) is not None


def test_earning_in_unpaid_payout_is_removed_paid_cannot_be_cancelled(client, db, ops):
    from datetime import datetime, timezone

    from app.models import ExchangeRate

    db.add(ExchangeRate(rate=D("40.0000"), source="test", valid_from=datetime(2026, 1, 3, tzinfo=timezone.utc)))
    db.commit()
    finance = staff_headers(client, db, ["muhasebe"])
    driver, customer, code, booking_id, leg_id = _accepted_instant(client, ops)
    _complete(client, driver, leg_id)
    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    entry = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == b.legs[0].id))
    assert entry.net_amount_try is not None
    assert client.post("/api/v1/admin/payouts", headers=finance).status_code == 201
    db.refresh(entry)
    payout_id = entry.payout_id
    assert payout_id is not None
    payout = db.get(DriverPayout, payout_id)
    before = payout.total_try
    others = len(list(db.scalars(select(DriverLedger).where(DriverLedger.payout_id == payout_id)))) - 1

    r = client.post(f"/api/v1/admin/ledger/{entry.id}/cancel", headers=finance, json={"reason": "sahte yolculuk"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(DriverLedger, entry.id).payout_id is None
    payout = db.get(DriverPayout, payout_id)
    if others == 0:
        assert payout is None
    else:
        assert payout.total_try == before - entry.net_amount_try


def test_paid_earning_cannot_be_cancelled(client, db, ops):
    from app.models.enums import LedgerStatus

    driver, customer, code, booking_id, leg_id = _accepted_instant(client, ops)
    _complete(client, driver, leg_id)
    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    entry = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == b.legs[0].id))
    entry.status = LedgerStatus.PAID
    db.commit()
    r = client.post(f"/api/v1/admin/ledger/{entry.id}/cancel", headers=ops, json={"reason": "geç fark edildi"})
    assert r.json()["error"]["code"] == "ledger_paid"


def test_support_role_cannot_refund(client, db, ops):
    support = staff_headers(client, db, ["destek"])
    driver, customer, code, booking_id, leg_id = _accepted_instant(client, ops)
    r = client.post(f"/api/v1/admin/bookings/{booking_id}/refund", headers=support,
                    json={"amount": "5.00", "reason": "deneme"})
    assert r.status_code == 403
