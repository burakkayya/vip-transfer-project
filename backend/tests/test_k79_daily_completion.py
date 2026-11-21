"""K-79 günlük kiralama tamamlama: SMS şablonu, tek gün iptali, admin manuel rezervasyon, toplu atama,
dinlenme süresi ve gün sonu km kaydı."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Booking, BookingLeg, Refund
from tests.conftest import future, otp_login, pay, random_phone, region_id, staff_headers
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_k29_daily_rental import _book, _quote_body
from tests.test_trips import _job
from tests.trip_clock import backdate_start, make_due

API = "/api/v1"


@pytest.fixture(autouse=True)
def _close_open_daily_legs(db):
    """Test veritabanı oturum boyunca birikir; açık bırakılan günlük işler sürücü havuzunu (POOL_LIMIT) doldurup
    sonraki dosyaların işlerini gizlemesin diye her testten sonra kapatılır."""
    yield
    from sqlalchemy import update

    from app.models.enums import LegStatus, ServiceType

    db.rollback()
    db.execute(update(BookingLeg).where(
        BookingLeg.booking_id.in_(select(Booking.id).where(Booking.service_type == ServiceType.DAILY)),
        BookingLeg.status.in_([LegStatus.PENDING, LegStatus.ASSIGNED]),
    ).values(status=LegStatus.CANCELLED))
    db.commit()


def _booking(db, code) -> Booking:
    db.expire_all()
    return db.scalar(select(Booking).where(Booking.booking_code == code))


# --- SMS şablonu -----------------------------------------------------------------------------------------------


def test_daily_confirmation_sms_uses_daily_template(client, db, sms_outbox):
    phone = random_phone()
    customer = otp_login(client, phone)
    code = _book(client, customer, days=3).json()["booking_code"]
    sms_outbox.clear()
    pay(client, customer, code)
    texts = [t for p, t in sms_outbox if p == phone]
    assert texts, sms_outbox
    text = texts[-1]
    assert code in text and "3 Tag" in text and ">" not in text  # locale de; "Kemer > Kemer" yok


def test_transfer_confirmation_sms_unchanged(client, sms_outbox):
    from tests.conftest import booking_body

    phone = random_phone()
    customer = otp_login(client, phone)
    b = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client)).json()
    sms_outbox.clear()
    pay(client, customer, b["booking_code"])
    assert any(">" in t for p, t in sms_outbox if p == phone)


# --- Tek gün iptali --------------------------------------------------------------------------------------------


def test_customer_cancels_one_day_with_policy_refund(client, db):
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=3, hours_ahead=30).json()["booking_code"]
    pay(client, customer, code)
    b = client.get(f"{API}/me/bookings/{code}", headers=customer).json()
    day1, day2, day3 = (leg["id"] for leg in sorted(b["legs"], key=lambda x: x["leg_order"]))
    price = _booking(db, code).legs[0].leg_price

    # 3. gün 78 saat sonra: %100 iade.
    q = client.get(f"{API}/me/bookings/{code}/days/{day3}/cancellation", headers=customer).json()
    assert q["refund_percent"] == 100 and Decimal(q["refund_amount"]) == price
    r = client.post(f"{API}/me/bookings/{code}/days/{day3}/cancel", headers=customer, json={"reason": "plan değişti"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] in ("onaylandi", "atandi")
    assert [leg["status"] for leg in sorted(out["legs"], key=lambda x: x["leg_order"])] == \
        ["beklemede", "beklemede", "iptal"]
    booking = _booking(db, code)
    refunds = list(db.scalars(select(Refund).join(Refund.payment).where(Refund.payment.has(booking_id=booking.id))))
    assert len(refunds) == 1 and refunds[0].amount == price

    # Aynı gün ikinci kez iptal edilemez.
    again = client.post(f"{API}/me/bookings/{code}/days/{day3}/cancel", headers=customer, json={})
    assert again.status_code == 409 and again.json()["error"]["code"] == "day_not_cancellable"

    # Tam iptal artık yalnızca kalan günleri iade eder.
    full = client.get(f"{API}/me/bookings/{code}/cancellation", headers=customer).json()
    # 1. gün 30 saat sonra (%50), 2. gün 54 saat sonra (%100); iptal edilen 3. gün tabanda yok.
    assert Decimal(full["refund_amount"]) == price * Decimal("0.5") + price
    _ = (day1, day2)


def test_cancelling_last_open_day_cancels_booking(client, db):
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=1).json()["booking_code"]
    pay(client, customer, code)
    leg = client.get(f"{API}/me/bookings/{code}", headers=customer).json()["legs"][0]["id"]
    r = client.post(f"{API}/me/bookings/{code}/days/{leg}/cancel", headers=customer, json={})
    assert r.status_code == 200 and r.json()["status"] == "iptal", r.text


def test_day_cancel_rejected_for_transfer_and_unpaid(client):
    from tests.conftest import booking_body

    customer = otp_login(client, random_phone())
    t = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client)).json()
    r = client.post(f"{API}/me/bookings/{t['booking_code']}/days/{t['legs'][0]['id']}/cancel", headers=customer,
                    json={})
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_daily"
    d = _book(client, customer, days=2).json()
    r = client.post(f"{API}/me/bookings/{d['booking_code']}/days/{d['legs'][1]['id']}/cancel", headers=customer,
                    json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_cancellable"  # ödeme bekliyor


def test_day_cancel_only_own_booking(client):
    owner = otp_login(client, random_phone())
    d = _book(client, owner, days=2).json()
    other = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings/{d['booking_code']}/days/{d['legs'][1]['id']}/cancel", headers=other,
                    json={})
    assert r.status_code == 404


def test_admin_cancels_day_with_override(client, db, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=2, hours_ahead=30).json()["booking_code"]
    pay(client, customer, code)
    booking = _booking(db, code)
    first = sorted(booking.legs, key=lambda x: x.leg_order)[0]
    preview = client.get(f"{API}/admin/bookings/{booking.id}/days/{first.id}/cancellation", headers=ops).json()
    assert preview["refund_percent"] == 50  # 30 saat: K-14 %50 kademesi
    r = client.post(f"{API}/admin/bookings/{booking.id}/days/{first.id}/cancel", headers=ops,
                    json={"reason": "araç arızası", "refund_percent": 100})
    assert r.status_code == 200, r.text
    refund = db.scalar(select(Refund).where(Refund.payment.has(booking_id=booking.id)))
    assert refund.amount == first.leg_price and refund.refund_percent == 100


# --- Admin manuel günlük rezervasyon ----------------------------------------------------------------------------


def _admin_customer(client, ops):  # noqa: F811
    r = client.post(f"{API}/admin/customers", headers=ops, json={
        "phone": random_phone(), "full_name": "Hans Müller", "country_code": "DE", "locale": "de"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_admin_daily_quotes_and_booking(client, db, ops, sms_outbox):  # noqa: F811
    cid = _admin_customer(client, ops)
    plan = {k: v for k, v in _quote_body(client, days=2, hours_ahead=6).items() if k != "vehicle_type_code"}
    quotes = client.post(f"{API}/admin/daily-quotes", headers=ops, json=plan)
    assert quotes.status_code == 200, quotes.text
    minivan = next(q for q in quotes.json() if q["vehicle_type_code"] == "minivan")
    assert minivan["quote"]["days"] == 2

    body = {**plan, "vehicle_type_code": "minivan", "customer_id": cid, "channel": "telefon",
            "consent_confirmed": True, "expected_total": minivan["quote"]["total"], "passenger_name": "Hans Müller",
            "locale": "de", "note": "Gün 1: Side"}
    sms_outbox.clear()
    r = client.post(f"{API}/admin/daily-bookings", headers=ops, json=body)
    assert r.status_code == 201, r.text  # 24 saat ön koşulu admin girişinde yok
    out = r.json()
    assert out["booking"]["service_type"] == "gunluk" and len(out["booking"]["legs"]) == 2
    assert out["booking"]["status"] == "odeme_bekliyor"
    assert "1) " in out["manual"]["share_text"] and "→" not in out["manual"]["share_text"]
    assert any("2 Tag" in t for _, t in sms_outbox)


def test_admin_daily_booking_with_manual_payment_and_override(client, db, ops):  # noqa: F811
    cid = _admin_customer(client, ops)
    plan = _quote_body(client, days=2)
    q = client.post(f"{API}/daily-quotes", json=plan).json()
    body = {**plan, "customer_id": cid, "channel": "whatsapp", "consent_confirmed": True,
            "expected_total": q["total"], "passenger_name": "Hans Müller", "override_total": "300.00",
            "override_reason": "sadık müşteri", "payment": {"method": "havale", "amount": "300.00"}}
    r = client.post(f"{API}/admin/daily-bookings", headers=ops, json=body)
    assert r.status_code == 201, r.text
    booking = _booking(db, r.json()["booking"]["booking_code"])
    assert booking.total_amount == Decimal("300.00") and booking.status.value == "onaylandi"
    assert sum(leg.leg_price for leg in booking.legs) == Decimal("300.00")


def test_admin_daily_booking_requires_consent_and_ops_role(client, db, ops):  # noqa: F811
    cid = _admin_customer(client, ops)
    plan = _quote_body(client, days=1)
    q = client.post(f"{API}/daily-quotes", json=plan).json()
    body = {**plan, "customer_id": cid, "channel": "telefon", "consent_confirmed": False,
            "expected_total": q["total"], "passenger_name": "Hans Müller"}
    r = client.post(f"{API}/admin/daily-bookings", headers=ops, json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent_required"
    support = staff_headers(client, db, ["destek"])
    assert client.post(f"{API}/admin/daily-bookings", headers=support,
                       json={**body, "consent_confirmed": True}).status_code == 403


# --- Toplu atama ve dinlenme ------------------------------------------------------------------------------------


def test_assign_all_days_to_one_driver(client, db, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=3).json()["booking_code"]
    pay(client, customer, code)
    _, driver_id = onboard_driver(client, ops, online=False)
    booking = _booking(db, code)
    cands = client.get(f"{API}/admin/dispatch/bookings/{booking.id}/candidates", headers=ops).json()
    assert any(c["driver_id"] == driver_id for c in cands)
    r = client.post(f"{API}/admin/dispatch/bookings/{booking.id}/assign-all", headers=ops,
                    json={"driver_id": driver_id})
    assert r.status_code == 200, r.text
    assert r.json()["assigned_days"] == [1, 2, 3]
    booking = _booking(db, code)
    assert {str(leg.driver_id) for leg in booking.legs} == {driver_id}
    assert len({leg.vehicle_id for leg in booking.legs}) == 1
    assert booking.status.value == "atandi"


def test_assign_all_is_all_or_nothing(client, db, ops):  # noqa: F811
    from tests.test_trips import _paid_booking

    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=2, hours_ahead=72).json()["booking_code"]
    pay(client, customer, code)
    driver, driver_id = onboard_driver(client, ops, online=False)
    # Sürücünün 2. gün başlamadan 3 saat önce biten bir transferi var: dinlenme süresi (9 sa) yetmez.
    _, other_code = _paid_booking(client, hours_ahead=72 + 24 - 4)
    other = _booking(db, other_code)
    r = client.post(f"{API}/admin/dispatch/legs/{other.legs[0].id}/assign", headers=ops,
                    json={"driver_id": driver_id})
    assert r.status_code == 204, r.text
    booking = _booking(db, code)
    r = client.post(f"{API}/admin/dispatch/bookings/{booking.id}/assign-all", headers=ops,
                    json={"driver_id": driver_id})
    assert r.status_code == 409 and r.json()["error"]["details"]["days"] == [2], r.text
    booking = _booking(db, code)
    assert all(leg.driver_id is None for leg in booking.legs)


def test_rest_rule_blocks_transfer_right_after_daily_day(client, db, ops):  # noqa: F811
    from app.services import system_settings
    from tests.test_trips import _paid_booking

    assert system_settings.get(db, "daily_rest_hours") == 9
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=1, hours_ahead=72).json()["booking_code"]
    pay(client, customer, code)
    driver, driver_id = onboard_driver(client, ops, online=False)
    booking = _booking(db, code)
    assert client.post(f"{API}/admin/dispatch/bookings/{booking.id}/assign-all", headers=ops,
                       json={"driver_id": driver_id}).status_code == 200
    # Gün 72. saatte başlar, 82. saatte biter. 85. saatteki transfer (3 sa sonra) dinlenmeye takılır,
    # 93. saatteki (11 sa sonra) takılmaz.
    _, near = _paid_booking(client, hours_ahead=85)
    _, far = _paid_booking(client, hours_ahead=93)
    jobs = {j["booking_code"] for j in client.get(f"{API}/driver/jobs", headers=driver).json()}
    assert near not in jobs and far in jobs


# --- Gün sonu km kaydı ------------------------------------------------------------------------------------------


def test_driver_day_report_and_admin_usage(client, db, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=2).json()["booking_code"]
    pay(client, customer, code)
    driver, _ = onboard_driver(client, ops, online=False)
    job = _job(client, driver, code)
    leg_id = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()["leg_id"]

    early = client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver, json={"km_used": 100})
    assert early.status_code == 409 and early.json()["error"]["code"] == "day_not_started"

    make_due(db, leg_id)
    kemer = next(x for x in client.get(f"{API}/regions").json() if x["code"] == "kemer")
    point = {"lat": float(kemer["latitude"]), "lng": float(kemer["longitude"])}
    for event in ("yola_cikti", "vardi", "basladi"):
        assert client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver,
                           json={"event": event, **point}).status_code == 200
    r = client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver, json={"km_used": 280})
    assert r.status_code == 200 and r.json()["day_km_used"] == 280, r.text
    assert client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver,
                       json={"km_used": 5000}).status_code == 422

    backdate_start(db, leg_id, 11 * 60 + 20)  # 11 sa 20 dk sürdü: 10 saatlik pakette 2 saat aşım
    assert client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver,
                       json={"event": "bitti", **point}).status_code == 200
    # Bitişten sonra düzeltme yapılabilir (24 saat içinde).
    assert client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver,
                       json={"km_used": 290}).status_code == 200

    booking = _booking(db, code)
    detail = client.get(f"{API}/admin/bookings/{booking.id}", headers=ops).json()
    day1 = detail["day_usage"][0]
    assert day1["km_used"] == 290 and day1["extra_km"] == 40 and day1["extra_hours"] == 2
    rate = booking.daily_rate
    assert Decimal(day1["extra_amount"]) == rate.extra_hour_price * 2 + rate.extra_km_price * 40
    assert detail["day_usage"][1]["km_used"] is None


def test_day_report_window_closes(client, db, ops):  # noqa: F811
    from app.models import TripEvent
    from app.models.enums import TripEventType

    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=1).json()["booking_code"]
    pay(client, customer, code)
    driver, _ = onboard_driver(client, ops, online=False)
    job = _job(client, driver, code)
    leg_id = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()["leg_id"]
    make_due(db, leg_id)
    for event in ("yola_cikti", "vardi", "basladi"):
        client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver, json={"event": event})
    client.post(f"{API}/me/bookings/{code}/finish", headers=customer)
    db.expire_all()
    ev = db.scalar(select(TripEvent).where(TripEvent.booking_leg_id == BookingLeg.id,
                                           TripEvent.event_type == TripEventType.FINISHED,
                                           BookingLeg.booking.has(booking_code=code)))
    ev.occurred_at = datetime.now(timezone.utc) - timedelta(hours=30)
    db.commit()
    r = client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver, json={"km_used": 120})
    assert r.status_code == 409 and r.json()["error"]["code"] == "day_report_closed"


def test_day_report_rejected_for_transfer(client, db, ops):  # noqa: F811
    from tests.test_trips import _paid_booking

    driver, _ = onboard_driver(client, ops, online=False)
    _, code = _paid_booking(client, hours_ahead=50)
    job = _job(client, driver, code)
    leg_id = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()["leg_id"]
    r = client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=driver, json={"km_used": 10})
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_daily"
    _ = (future, region_id)


# --- İnceleme sonrası (K-80) --------------------------------------------------------------------------------------


def test_admin_override_on_last_open_day_uses_only_that_day(client, db, ops):  # noqa: F811
    """Son açık gün ezilmiş oranla iptal edilince oran yalnızca o günün payına uygulanır (fazla iade yok)."""
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=3, hours_ahead=80).json()["booking_code"]
    pay(client, customer, code)
    booking = _booking(db, code)
    days = sorted(booking.legs, key=lambda x: x.leg_order)
    price = days[0].leg_price
    for leg in days[1:]:
        r = client.post(f"{API}/admin/bookings/{booking.id}/days/{leg.id}/cancel", headers=ops, json={"reason": "plan"})
        assert r.status_code == 200, r.text
    r = client.post(f"{API}/admin/bookings/{booking.id}/days/{days[0].id}/cancel", headers=ops,
                    json={"reason": "son gün", "refund_percent": 50})
    assert r.status_code == 200 and r.json()["status"] == "iptal", r.text
    refunds = sorted(db.scalars(select(Refund).where(Refund.payment.has(booking_id=booking.id))),
                     key=lambda x: x.created_at)
    assert [x.amount for x in refunds] == [price, price, (price * Decimal("0.5")).quantize(Decimal("0.01"))]


def test_rest_rule_blocks_daily_day_right_after_transfer(client, db, ops):  # noqa: F811
    from tests.test_trips import _paid_booking

    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=1, hours_ahead=76).json()["booking_code"]
    pay(client, customer, code)
    _, driver_id = onboard_driver(client, ops, online=False)
    _, transfer = _paid_booking(client, hours_ahead=72)  # transfer biter bitmez (birkaç saat) günlük iş başlar
    t_leg = _booking(db, transfer).legs[0]
    assert client.post(f"{API}/admin/dispatch/legs/{t_leg.id}/assign", headers=ops,
                       json={"driver_id": driver_id}).status_code == 204
    booking = _booking(db, code)
    r = client.post(f"{API}/admin/dispatch/bookings/{booking.id}/assign-all", headers=ops,
                    json={"driver_id": driver_id})
    assert r.status_code == 409 and r.json()["error"]["details"]["days"] == [1], r.text


def test_day_report_other_driver_404(client, db, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=1).json()["booking_code"]
    pay(client, customer, code)
    driver, _ = onboard_driver(client, ops, online=False)
    other, _ = onboard_driver(client, ops, online=False)
    job = _job(client, driver, code)
    leg_id = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()["leg_id"]
    r = client.post(f"{API}/driver/trips/{leg_id}/day-report", headers=other, json={"km_used": 10})
    assert r.status_code == 404


def test_assign_all_finds_common_vehicle_across_days(db, monkeypatch):
    """Sürücünün iki aracı varsa (A yalnızca ilk günler, B her gün uygun) ortak araç B seçilir."""
    import uuid as _uuid
    from types import SimpleNamespace

    from app.services import dispatch

    drv = SimpleNamespace(id=_uuid.uuid4())
    va, vb = SimpleNamespace(id=_uuid.UUID(int=1)), SimpleNamespace(id=_uuid.UUID(int=2))
    legs = [SimpleNamespace(id=_uuid.uuid4(), leg_order=i, status=dispatch.LegStatus.PENDING, driver_id=None,
                            vehicle_id=None) for i in (1, 2, 3)]
    by_day = {legs[0].id: [va, vb], legs[1].id: [va, vb], legs[2].id: [vb]}
    calls, assigned = [], []

    def fake_candidates(_db, leg, **kw):
        calls.append(kw)
        return [dispatch.Candidate(drv, v) for v in by_day[leg.id]]

    class _DB:
        def scalars(self, *_a, **_k):
            return legs

        def refresh(self, *_a, **_k):
            return None

    monkeypatch.setattr(dispatch, "eligible_candidates", fake_candidates)
    monkeypatch.setattr(dispatch, "_assignable_booking", lambda leg: None)
    monkeypatch.setattr(dispatch, "assign", lambda _db, leg, c, **kw: assigned.append((leg.leg_order, c.vehicle.id)))
    booking = SimpleNamespace(id=_uuid.uuid4(), is_daily=True)
    dispatch.assign_all_days(_DB(), booking, drv.id, None, actor_id=_uuid.uuid4(), now=datetime.now(timezone.utc),
                             ip=None)
    assert assigned == [(1, vb.id), (2, vb.id), (3, vb.id)]
    assert all(kw.get("per_vehicle") for kw in calls)
