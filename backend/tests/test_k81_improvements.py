"""K-81: açık konulardan dış bağımlılığı olmayan iyileştirmeler (BIZ-04 ve diğerleri)."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app import commission
from tests.conftest import staff_headers
from tests.trip_clock import relaxed_trip_clock  # noqa: F401 - fikstür
from tests.test_admin_manual_booking import _booking_body, _new_customer

API = "/api/v1"


# --- BIZ-04: fiyat ezme sınırı, tahsilat referansı, görev ayrılığı, hakediş tavanı -----------------


def test_override_total_outside_ratio_requires_admin(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    body = _booking_body(client, ops, c["id"], send_sms=False)
    system_total = Decimal(body["expected_total"])
    low = str((system_total * Decimal("0.3")).quantize(Decimal("0.01")))
    high = str((system_total * Decimal("2")).quantize(Decimal("0.01")))
    for total in (low, high):
        r = client.post(f"{API}/admin/bookings", headers=ops,
                        json={**body, "override_total": total, "override_reason": "özel anlaşma"})
        assert r.status_code == 400 and r.json()["error"]["code"] == "override_out_of_range", r.text
        details = r.json()["error"]["details"]
        assert details["min_percent"] == 50 and details["max_percent"] == 150

    inside = str((system_total * Decimal("1.2")).quantize(Decimal("0.01")))
    ok = client.post(f"{API}/admin/bookings", headers=ops,
                     json={**body, "override_total": inside, "override_reason": "ek durak"})
    assert ok.status_code == 201, ok.text

    admin = staff_headers(client, db, ["admin"])
    r = client.post(f"{API}/admin/bookings", headers=admin,
                    json={**body, "override_total": low, "override_reason": "yönetim onaylı kampanya"})
    assert r.status_code == 201, r.text

    catalog = client.get(f"{API}/admin/booking-catalog", headers=ops).json()
    assert catalog["override_min_percent"] == 50 and catalog["override_max_percent"] == 150


def test_manual_payment_requires_reference(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    b = client.post(f"{API}/admin/bookings", headers=ops,
                    json=_booking_body(client, ops, c["id"], send_sms=False)).json()["booking"]
    url = f"{API}/admin/bookings/{b['id']}/manual-payment"
    missing = client.post(url, headers=ops, json={"method": "havale", "amount": b["total_amount"]})
    assert missing.status_code == 422
    blank = client.post(url, headers=ops, json={"method": "havale", "amount": b["total_amount"], "reference": "   "})
    assert blank.status_code == 400 and blank.json()["error"]["code"] == "payment_reference_required"
    ok = client.post(url, headers=ops, json={"method": "havale", "amount": b["total_amount"], "reference": "DK-1"})
    assert ok.status_code == 200, ok.text


def test_overriding_staff_cannot_record_payment_of_same_booking(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    other = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    body = _booking_body(client, ops, c["id"], send_sms=False)
    total = str((Decimal(body["expected_total"]) * Decimal("0.9")).quantize(Decimal("0.01")))
    b = client.post(f"{API}/admin/bookings", headers=ops,
                    json={**body, "override_total": total, "override_reason": "sadık müşteri"}).json()["booking"]
    pay = {"method": "nakit", "amount": b["total_amount"], "reference": "MAKBUZ-5"}
    url = f"{API}/admin/bookings/{b['id']}/manual-payment"
    same = client.post(url, headers=ops, json=pay)
    assert same.status_code == 409 and same.json()["error"]["code"] == "manual_payment_needs_other_staff"
    ok = client.post(url, headers=other, json=pay)
    assert ok.status_code == 200 and ok.json()["booking"]["status"] == "onaylandi"

    # Fiyatı değiştirilmemiş rezervasyonda aynı kişi tahsilat girebilir.
    plain = client.post(f"{API}/admin/bookings", headers=ops, json=body).json()["booking"]
    r = client.post(f"{API}/admin/bookings/{plain['id']}/manual-payment", headers=ops,
                    json={**pay, "amount": plain["total_amount"]})
    assert r.status_code == 200, r.text


def test_overridden_booking_earning_capped():
    # Sistem 100 (garanti 10), ezilen 190: bacak payı sistem fiyatı oranına (90/180) iner.
    assert commission.earning_base(Decimal("180.00"), Decimal("190.00"), Decimal("100.00"), Decimal("10.00")) == Decimal("90.00")
    # Aşağı ezmede ve ezme yokken bacak fiyatı olduğu gibi kalır.
    assert commission.earning_base(Decimal("60.00"), Decimal("60.00"), Decimal("100.00"), Decimal("0")) == Decimal("60.00")
    assert commission.earning_base(Decimal("60.00"), Decimal("60.00"), None, Decimal("0")) == Decimal("60.00")

    booking = SimpleNamespace(total_amount=Decimal("150.00"), system_total_amount=Decimal("100.00"),
                              guarantee_fee=Decimal("0"), commission_rate=Decimal("0.20"))
    leg = SimpleNamespace(leg_price=Decimal("150.00"), booking=booking)
    split = commission.leg_split(leg)
    assert split.gross == Decimal("100.00") and split.net == Decimal("80.00")


def test_override_percent_settings_validated(client, db):
    admin = staff_headers(client, db, ["admin"])
    for key, value in (("price_override_min_percent", 0), ("price_override_min_percent", 120),
                       ("price_override_max_percent", 90), ("price_override_max_percent", 5000)):
        r = client.put(f"{API}/admin/settings/{key}", headers=admin, json={"value": value})
        assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_setting_value", (key, value)
    r = client.put(f"{API}/admin/settings/price_override_min_percent", headers=admin, json={"value": 50})
    assert r.status_code == 200


# --- K-74: incelemedeki ödemeler listesi ---------------------------------------------------------


def test_under_review_payments_listed_until_refund_completes(client, db):
    from tests.test_phase2_review_fixes import _rejected_charge

    _, code, booking_id = _rejected_charge(client, db)  # iade başarısız, rezervasyon incelemede
    finance = staff_headers(client, db, ["muhasebe"])
    rows = client.get(f"{API}/admin/payments/under-review", headers=finance).json()
    row = next(r for r in rows if r["booking_code"] == code)
    assert row["booking_id"] == str(booking_id) and row["booking_status"] == "odeme_bekliyor"
    assert row["failure_reason"] == "tahsilat tutarı bildirilmedi"
    [refund] = row["refunds"]
    assert refund["status"] == "basarisiz" and refund["manual"] is False

    support = staff_headers(client, db, ["destek"])
    assert client.get(f"{API}/admin/payments/under-review", headers=support).status_code == 403

    # İade tamamlanınca satır listeden düşer.
    from app.services import bookings
    from tests.test_phase2_review_fixes import _provider

    bookings.retry_refund(db, refund_id_of(refund), _provider())
    db.commit()
    rows = client.get(f"{API}/admin/payments/under-review", headers=finance).json()
    assert all(r["booking_code"] != code for r in rows)


def refund_id_of(refund: dict):
    import uuid

    return uuid.UUID(refund["id"])


# --- K-80 kalanı: aday listesinde sürücü başına sorgu yok -------------------------------------------


def test_candidate_search_uses_constant_number_of_queries(client, db):
    from datetime import datetime, timezone

    from sqlalchemy import event, select

    from app.models import Booking
    from app.services import dispatch
    from tests.conftest import booking_body, otp_login, random_phone
    from tests.test_api_driver_admin import onboard_driver

    ops = staff_headers(client, db, ["operasyon"])
    new_ids = {onboard_driver(client, ops, online=False)[1] for _ in range(3)}

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    assert r.status_code == 201, r.text
    booking = db.scalar(select(Booking).where(Booking.booking_code == r.json()["booking_code"]))
    leg = booking.legs[0]

    statements: list[str] = []
    engine = db.get_bind()

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        found = dispatch.eligible_candidates(db, leg, require_online=False, now=datetime.now(timezone.utc))
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert new_ids <= {str(c.driver.id) for c in found}
    assert len(statements) <= 8, statements  # sürücü sayısıyla büyümez


# --- MON-15: /ready yalnızca iç ağdan, veritabanı ve Redis denetimi -------------------------------------


def test_ready_checks_dependencies_and_is_internal_only(db_app, monkeypatch):
    from fastapi.testclient import TestClient

    from app import readiness

    internal = TestClient(db_app, client=("127.0.0.1", 50000))
    r = internal.get("/ready")
    assert r.status_code == 200 and r.json() == {"status": "ready", "checks": {"database": True, "redis": True}}

    # Vekilden geçen ya da dış adresten gelen istek yolu göremez.
    assert internal.get("/ready", headers={"X-Forwarded-For": "203.0.113.5"}).status_code == 404
    assert TestClient(db_app, client=("8.8.8.8", 50000)).get("/ready").status_code == 404

    monkeypatch.setattr(readiness, "_check_redis", lambda: False)
    r = internal.get("/ready")
    assert r.status_code == 503 and r.json()["checks"] == {"database": True, "redis": False}


# --- K-80 kalanı: sürücü bütün günleri birlikte kabul eder, müşteriye tek bildirim ---------------------------

from tests.test_k79_daily_completion import _booking, _close_open_daily_legs  # noqa: E402,F401 - fikstür


def _daily_paid(client, days=3, hours_ahead=72):
    from tests.conftest import otp_login, pay, random_phone
    from tests.test_k29_daily_rental import _book

    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=days, hours_ahead=hours_ahead).json()["booking_code"]
    pay(client, customer, code)
    return customer, code


def _assigned_updates(client, customer):
    return [u for u in client.get(f"{API}/me/updates", headers=customer).json() if u["code"] == "driver_assigned"]


def test_driver_accepts_all_days_with_one_customer_notice(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_trips import _job

    ops = staff_headers(client, db, ["operasyon"])
    customer, code = _daily_paid(client, days=3)
    driver, driver_id = onboard_driver(client, ops, online=False)
    job = _job(client, driver, code)
    assert job["open_days"] == 3 and job["service_type"] == "gunluk"
    assert Decimal(job["open_days_amount"]) == Decimal(job["driver_amount"]) * 3

    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept-all", headers=driver)
    assert r.status_code == 200, r.text
    assert r.json()["accepted_days"] == [1, 2, 3] and r.json()["trip"]["leg_id"]
    booking = _booking(db, code)
    assert {str(leg.driver_id) for leg in booking.legs} == {driver_id}
    assert len({leg.vehicle_id for leg in booking.legs}) == 1 and booking.status.value == "atandi"
    [notice] = _assigned_updates(client, customer)
    assert "Tagen" in notice["body"]  # müşteri dili de: "an allen Tagen Ihrer Buchung"


def test_accept_all_leaves_other_drivers_days(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_trips import _job

    ops = staff_headers(client, db, ["operasyon"])
    customer, code = _daily_paid(client, days=3)
    first, first_id = onboard_driver(client, ops, online=False)
    second, second_id = onboard_driver(client, ops, online=False)
    booking = _booking(db, code)
    day2 = next(leg for leg in booking.legs if leg.leg_order == 2)
    assert client.post(f"{API}/driver/jobs/{day2.id}/accept", headers=first).status_code == 200

    job = _job(client, second, code)
    assert job["open_days"] == 2
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept-all", headers=second)
    assert r.status_code == 200 and r.json()["accepted_days"] == [1, 3], r.text
    owners = {leg.leg_order: str(leg.driver_id) for leg in _booking(db, code).legs}
    assert owners == {1: second_id, 2: first_id, 3: second_id}
    # 2. gün başka sürücüde: "bütün günlerde sizinle" yazılmaz.
    assert all("Tagen" not in u["body"] for u in _assigned_updates(client, customer))
    # Alınmış güne toplu kabul: başka sürücünün günü.
    r = client.post(f"{API}/driver/jobs/{day2.id}/accept-all", headers=second)
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_taken"


def test_accept_all_is_all_or_nothing(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_trips import _job, _paid_booking

    ops = staff_headers(client, db, ["operasyon"])
    _, code = _daily_paid(client, days=3, hours_ahead=72)
    driver, _ = onboard_driver(client, ops, online=False)
    # 2. gün 96. saatte başlar; 98. saatteki transferi alan sürücü o güne uygun değildir.
    _, transfer = _paid_booking(client, hours_ahead=98)
    t_job = _job(client, driver, transfer)
    assert client.post(f"{API}/driver/jobs/{t_job['leg_id']}/accept", headers=driver).status_code == 200

    job = _job(client, driver, code)
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept-all", headers=driver)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_eligible", r.text
    assert 2 in r.json()["error"]["details"]["days"]
    assert all(leg.driver_id is None for leg in _booking(db, code).legs)


def test_accept_all_rejected_for_transfer(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_trips import _job, _paid_booking

    ops = staff_headers(client, db, ["operasyon"])
    driver, _ = onboard_driver(client, ops, online=False)
    _, code = _paid_booking(client, hours_ahead=60)
    job = _job(client, driver, code)
    assert job["open_days"] is None
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept-all", headers=driver)
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_daily"


def test_admin_assign_all_sends_one_customer_notice(client, db):
    from tests.test_api_driver_admin import onboard_driver

    ops = staff_headers(client, db, ["operasyon"])
    customer, code = _daily_paid(client, days=3)
    _, driver_id = onboard_driver(client, ops, online=False)
    booking = _booking(db, code)
    r = client.post(f"{API}/admin/dispatch/bookings/{booking.id}/assign-all", headers=ops, json={"driver_id": driver_id})
    assert r.status_code == 200, r.text
    assert len(_assigned_updates(client, customer)) == 1


# --- K-81: bahşişin elle iadesi -------------------------------------------------------------------------------


def _tipped(client, db):
    from tests.test_meeting import _complete, _setup

    ops = staff_headers(client, db, ["operasyon"])
    driver, customer, code, _, trip = _setup(client, ops)
    _complete(client, driver, trip["leg_id"])
    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer,
                    json={"stars": 5, "tip_amount": "10"})
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    assert client.post(f"{API}/payments/fake/{oid}/complete", data={"status": "success"}).status_code == 200
    return ops, customer, code, trip["leg_id"]


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_staff_refunds_tip_and_cancels_tip_earning(client, db):
    from sqlalchemy import select

    from app.models import Booking, DriverLedger

    ops, customer, code, leg_id = _tipped(client, db)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    detail = client.get(f"{API}/admin/bookings/{booking.id}", headers=ops).json()
    tip = next(p for p in detail["payments"] if p["purpose"] == "tip")
    assert tip["refundable"] == "10.00"
    # Rezervasyonun elle iade hedefi bahşiş değildir.
    assert detail["refund_target"]["payment_id"] != tip["id"]

    support = staff_headers(client, db, ["destek"])
    assert client.post(f"{API}/admin/bookings/{booking.id}/tip-refund", headers=support,
                       json={"reason": "müşteri talebi"}).status_code == 403
    r = client.post(f"{API}/admin/bookings/{booking.id}/tip-refund", headers=ops, json={"reason": "müşteri talebi"})
    assert r.status_code == 200 and r.json()["amount"] == "10.00" and r.json()["status"] == "tamamlandi", r.text

    db.expire_all()
    ledger = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == leg_id, DriverLedger.kind == "tip"))
    assert ledger.status.value == "iptal"
    trip_ledger = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == leg_id, DriverLedger.kind == "trip"))
    assert trip_ledger.status.value != "iptal"
    state = client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()
    assert state["tip_status"] == "iade_edildi"
    assert client.post(f"{API}/me/bookings/{code}/tip", headers=customer,
                       json={"amount": "5"}).json()["error"]["code"] == "tip_already_paid"
    again = client.post(f"{API}/admin/bookings/{booking.id}/tip-refund", headers=ops, json={"reason": "ikinci"})
    assert again.status_code == 409


@pytest.mark.usefixtures("relaxed_trip_clock")
def test_tip_refund_blocked_after_payout(client, db):
    from sqlalchemy import select

    from app.models import Booking, DriverLedger

    ops, _, code, leg_id = _tipped(client, db)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    ledger = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == leg_id, DriverLedger.kind == "tip"))
    from app.models.enums import LedgerStatus

    ledger.status = LedgerStatus.PAID
    db.commit()
    try:
        r = client.post(f"{API}/admin/bookings/{booking.id}/tip-refund", headers=ops, json={"reason": "geç talep"})
        assert r.status_code == 409 and r.json()["error"]["code"] == "tip_paid_out"
    finally:
        # Test verisi sonraki hakediş ödemesi testlerine ve migration geri almasına karışmasın.
        db.rollback()
        ledger.status = LedgerStatus.CANCELLED
        db.commit()


def test_tip_refund_without_tip(client, db):
    from tests.test_trips import _paid_booking
    from sqlalchemy import select

    from app.models import Booking

    ops = staff_headers(client, db, ["operasyon"])
    _, code = _paid_booking(client)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    r = client.post(f"{API}/admin/bookings/{booking.id}/tip-refund", headers=ops, json={"reason": "deneme"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_tip_payment"


# --- K-81: sürücü fotoğrafı admin onayı ------------------------------------------------------------------------


def test_driver_photo_review_reject_and_reupload(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_meeting import PNG

    ops = staff_headers(client, db, ["operasyon"])
    driver, driver_id = onboard_driver(client, ops, online=False)
    assert client.post(f"{API}/admin/drivers/{driver_id}/photo/review", headers=ops,
                       json={"approve": True, "photo_version": "0" * 16}).status_code == 404  # fotoğraf yok
    assert client.post(f"{API}/driver/me/photo", headers=driver,
                       files={"file": ("a.png", PNG, "image/png")}).status_code == 200
    pending = client.get(f"{API}/admin/drivers", headers=ops, params={"photo_pending": True}).json()
    assert any(d["id"] == driver_id for d in pending)
    photo = client.get(f"{API}/admin/drivers/{driver_id}/photo", headers=ops)
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    version = client.get(f"{API}/admin/drivers/{driver_id}", headers=ops).json()["photo_version"]
    assert photo.headers["x-photo-version"] == version

    no_reason = client.post(f"{API}/admin/drivers/{driver_id}/photo/review", headers=ops,
                            json={"approve": False, "photo_version": version})
    assert no_reason.status_code == 400 and no_reason.json()["error"]["code"] == "reason_required"
    r = client.post(f"{API}/admin/drivers/{driver_id}/photo/review", headers=ops,
                    json={"approve": False, "reason": "Yüzünüz net görünmüyor", "photo_version": version})
    assert r.status_code == 200 and r.json()["photo_status"] == "reddedildi"
    me = client.get(f"{API}/driver/me", headers=driver).json()
    assert me["photo_status"] == "reddedildi" and me["photo_reject_reason"] == "Yüzünüz net görünmüyor"

    # Yeni yükleme onaya döner, gerekçe silinir.
    assert client.post(f"{API}/driver/me/photo", headers=driver,
                       files={"file": ("a.png", PNG, "image/png")}).status_code == 200
    me = client.get(f"{API}/driver/me", headers=driver).json()
    assert me["photo_status"] == "beklemede" and me["photo_reject_reason"] is None
    # Admin eski sürümü onaylayamaz: arada yüklenen görülmemiş fotoğraf onaylanmaz.
    stale = client.post(f"{API}/admin/drivers/{driver_id}/photo/review", headers=ops,
                        json={"approve": True, "photo_version": version})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "photo_changed"

    support = staff_headers(client, db, ["destek"])
    assert client.post(f"{API}/admin/drivers/{driver_id}/photo/review", headers=support,
                       json={"approve": True, "photo_version": version}).status_code == 403


# --- K-81: web kalanları (rezervasyon sayfalama, veri talebini geri çekme, dilli ödeme dönüşü) ----------------


def test_my_bookings_paging(client):
    from tests.conftest import booking_body, otp_login, random_phone

    customer = otp_login(client, random_phone())
    codes = [client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client, hours_ahead=72 + i)).json()["booking_code"]
             for i in range(3)]
    everything = client.get(f"{API}/me/bookings", headers=customer).json()
    assert [b["booking_code"] for b in everything] == list(reversed(codes))  # en yeni önce
    first = client.get(f"{API}/me/bookings", headers=customer, params={"limit": 2}).json()
    rest = client.get(f"{API}/me/bookings", headers=customer, params={"limit": 2, "offset": 2}).json()
    assert [b["booking_code"] for b in first + rest] == list(reversed(codes))
    assert client.get(f"{API}/me/bookings", headers=customer, params={"limit": 500}).status_code == 422


def test_customer_withdraws_open_data_request(client, db):
    from tests.conftest import otp_login, random_phone

    customer = otp_login(client, random_phone())
    req = client.post(f"{API}/me/data-requests", headers=customer, json={"request_type": "silme"}).json()
    r = client.post(f"{API}/me/data-requests/{req['id']}/withdraw", headers=customer)
    assert r.status_code == 200 and r.json()["status"] == "geri_cekildi" and r.json()["completed_at"]
    again = client.post(f"{API}/me/data-requests/{req['id']}/withdraw", headers=customer)
    assert again.status_code == 409 and again.json()["error"]["code"] == "data_request_not_open"

    # Personel geri çekilmiş talebi kapatamaz; işleme alınmış talep müşterice geri çekilemez.
    admin = staff_headers(client, db, ["admin"])
    closed = client.post(f"{API}/admin/data-requests/{req['id']}", headers=admin, json={"status": "tamamlandi"})
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "data_request_withdrawn"
    other = client.post(f"{API}/me/data-requests", headers=customer, json={"request_type": "erisim"}).json()
    support = staff_headers(client, db, ["destek"])
    assert client.post(f"{API}/admin/data-requests/{other['id']}", headers=support,
                       json={"status": "isleniyor"}).status_code == 200
    assert client.post(f"{API}/me/data-requests/{other['id']}/withdraw", headers=customer).status_code == 409
    assert client.post(f"{API}/admin/data-requests/{other['id']}", headers=support,
                       json={"status": "geri_cekildi"}).status_code == 400

    # Başka müşterinin talebi görünmez.
    stranger = otp_login(client, random_phone())
    mine = client.post(f"{API}/me/data-requests", headers=customer, json={"request_type": "erisim"}).json()
    assert client.post(f"{API}/me/data-requests/{mine['id']}/withdraw", headers=stranger).status_code == 404


def test_payment_return_url_carries_booking_locale(client):
    from app.providers.payments import PaytrProvider, result_path
    from tests.conftest import booking_body, otp_login, random_phone

    assert result_path("booking", "de") == "/de/booking/payment-result"
    assert result_path("tip", "xx") == "/booking/tip-result"  # bilinmeyen dil önek almaz
    ok = "https://getawaytransfers.com/booking/payment-result?status=ok"
    assert PaytrProvider._return_url(ok, "booking", "ar") == "https://getawaytransfers.com/ar/booking/payment-result?status=ok"

    customer = otp_login(client, random_phone())
    body = booking_body(client)
    body["locale"] = "de"
    code = client.post(f"{API}/me/bookings", headers=customer, json=body).json()["booking_code"]
    oid = client.post(f"{API}/me/bookings/{code}/payments", headers=customer).json()["iframe_url"].rsplit("/", 1)[1]
    done = client.post(f"{API}/payments/fake/{oid}/complete", data={"status": "success"})
    assert "/de/booking/payment-result?status=ok" in done.text


# --- K-81: e2e test verisi temizliği ---------------------------------------------------------------------------


def test_e2e_cleanup_only_touches_fictional_numbers(client, db, monkeypatch):
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.models import Booking, Customer
    from app.services import e2e_cleanup
    from tests.conftest import booking_body, otp_login, random_phone

    assert e2e_cleanup.is_fictional("+12125550142") and e2e_cleanup.is_fictional("+447700900123")
    assert not e2e_cleanup.is_fictional("+12125551234") and not e2e_cleanup.is_fictional("+905551234567")

    import uuid as _uuid

    digits = str(_uuid.uuid4().int)
    fake = otp_login(client, f"+1{2 + int(digits[0]) % 8}{digits[1:3]}55501{digits[3:5]}")
    real_phone = random_phone()
    real = otp_login(client, real_phone)
    fake_code = client.post(f"{API}/me/bookings", headers=fake, json=booking_body(client)).json()["booking_code"]
    real_code = client.post(f"{API}/me/bookings", headers=real, json=booking_body(client)).json()["booking_code"]

    preview = e2e_cleanup.cleanup(db, datetime.now(timezone.utc), dry_run=True)
    assert preview.customers >= 1 and preview.closed_bookings >= 1
    assert db.scalar(select(Booking).where(Booking.booking_code == fake_code)).status.value == "odeme_bekliyor"

    e2e_cleanup.cleanup(db, datetime.now(timezone.utc))
    db.commit()
    db.expire_all()
    fake_booking = db.scalar(select(Booking).where(Booking.booking_code == fake_code))
    assert fake_booking.status.value == "iptal" and fake_booking.passenger_name != "Anna Schmidt"
    assert db.get(Customer, fake_booking.customer_id).deleted_at is not None
    real_booking = db.scalar(select(Booking).where(Booking.booking_code == real_code))
    assert real_booking.status.value == "odeme_bekliyor"
    assert db.get(Customer, real_booking.customer_id).deleted_at is None

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "env", "prod")
    import pytest as _pytest

    with _pytest.raises(RuntimeError):
        e2e_cleanup.cleanup(db, datetime.now(timezone.utc))


def test_accept_all_skips_days_the_driver_declined(client, db):
    from tests.test_api_driver_admin import onboard_driver
    from tests.test_trips import _job

    ops = staff_headers(client, db, ["operasyon"])
    _, code = _daily_paid(client, days=3)
    driver, driver_id = onboard_driver(client, ops, online=False)
    day3 = next(leg for leg in _booking(db, code).legs if leg.leg_order == 3)
    assert client.post(f"{API}/driver/jobs/{day3.id}/decline", headers=driver).status_code == 204
    job = _job(client, driver, code)
    assert job["open_days"] == 2
    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept-all", headers=driver)
    assert r.status_code == 200 and r.json()["accepted_days"] == [1, 2], r.text
    assert next(leg for leg in _booking(db, code).legs if leg.leg_order == 3).driver_id is None


def test_ready_rejects_ipv4_mapped_public_address():
    from types import SimpleNamespace

    from app import readiness

    req = SimpleNamespace(headers={}, client=SimpleNamespace(host="::ffff:8.8.8.8"))
    assert readiness.is_internal_request(req) is False
    req.client.host = "::ffff:10.0.0.5"
    assert readiness.is_internal_request(req) is True
