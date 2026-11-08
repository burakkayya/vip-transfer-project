"""K-54: admin'in uygulamayı kullanmayan müşteri için manuel kayıt ve rezervasyonu."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from tests.conftest import future, otp_login, random_phone, region_id, staff_headers

API = "/api/v1"


def _new_customer(client, ops, *, country="DE", locale="de", phone=None) -> dict:
    r = client.post(f"{API}/admin/customers", headers=ops, json={
        "phone": phone or random_phone(), "full_name": "Hans Müller", "country_code": country, "locale": locale,
    })
    assert r.status_code == 201, r.text
    return r.json()


def _booking_body(client, ops, customer_id: str, *, hours_ahead: float = 72, **extra) -> dict:
    trip = {
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "kemer"), "address": "Otel Örnek, Kemer"},
        "pickup_at": future(hours_ahead),
        "passenger_count": 2,
        "luggage_count": 1,
        "country_code": "DE",
    }
    quotes = client.post(f"{API}/admin/quotes", headers=ops, json=trip)
    assert quotes.status_code == 200, quotes.text
    minivan = next(q for q in quotes.json() if q["vehicle_type_code"] == "minivan")
    body = {**trip, "vehicle_type_code": "minivan", "customer_id": customer_id, "channel": "whatsapp",
            "consent_confirmed": True, "expected_total": minivan["quote"]["total"],
            "passenger_name": "Hans Müller", "locale": "de"}
    body.update(extra)
    return body


def test_create_customer_and_lookup(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    phone = random_phone()
    c = _new_customer(client, ops, phone=phone)
    assert c["full_name"] == "Hans Müller" and c["verified"] is False and c["currency"] == "EUR"
    assert phone not in c["phone"]  # maskeli

    dup = client.post(f"{API}/admin/customers", headers=ops,
                      json={"phone": phone, "full_name": "Başka", "locale": "tr"})
    assert dup.status_code == 409 and dup.json()["error"]["details"]["customer_id"] == c["id"]

    found = client.get(f"{API}/admin/customers/lookup", headers=ops, params={"phone": phone})
    assert found.status_code == 200 and found.json()["id"] == c["id"]
    assert found.json()["full_name"] == "H***"  # aramada ad maskeli (ekran 14)
    assert client.get(f"{API}/admin/customers/lookup", headers=ops,
                      params={"phone": random_phone()}).status_code == 404

    # Müşteri sonra aynı numarayla SMS koduyla girerse aynı kayıt doğrulanır.
    headers = otp_login(client, phone)
    assert client.get(f"{API}/me/profile", headers=headers).json()["full_name"] == "Hans Müller"
    assert client.get(f"{API}/admin/customers/lookup", headers=ops, params={"phone": phone}).json()["verified"]


def test_quotes_all_vehicle_types_with_capacity_notes(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    r = client.post(f"{API}/admin/quotes", headers=ops, json={
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "kemer")},
        "pickup_at": future(48), "passenger_count": 10, "luggage_count": 0,
    })
    assert r.status_code == 200, r.text
    by_code = {q["vehicle_type_code"]: q for q in r.json()}
    assert by_code["minivan"]["error"] == "capacity_exceeded"
    assert Decimal(by_code["minibus"]["quote"]["total"]) > 0
    assert "sedan" not in by_code


def test_payment_link_booking_sends_sms_and_customer_pays(client, db, sms_outbox):
    from tests.conftest import pay

    ops = staff_headers(client, db, ["operasyon"])
    phone = random_phone()
    c = _new_customer(client, ops, phone=phone)
    r = client.post(f"{API}/admin/bookings", headers=ops, json=_booking_body(client, ops, c["id"]))
    assert r.status_code == 201, r.text
    data = r.json()
    b, manual = data["booking"], data["manual"]
    assert b["status"] == "odeme_bekliyor"
    assert manual["source"] == "admin" and manual["channel"] == "whatsapp"
    assert manual["pay_url"].endswith(f"/de/bookings/{b['booking_code']}/pay")
    assert b["booking_code"] in manual["share_text"] and manual["pay_url"] in manual["share_text"]
    due = datetime.fromisoformat(manual["payment_due_at"])
    assert timedelta(hours=23) < due - datetime.now(timezone.utc) <= timedelta(hours=24)
    sms = [text for p, text in sms_outbox if p == phone]
    assert sms and manual["pay_url"] in sms[-1]

    # Müşteri bağlantıdan SMS koduyla girip kartla öder.
    headers = otp_login(client, phone)
    pay(client, headers, b["booking_code"])
    detail = client.get(f"{API}/admin/bookings/{b['id']}", headers=ops).json()
    assert detail["booking"]["status"] == "onaylandi"
    assert detail["manual"]["source"] == "admin"


def test_unpaid_admin_booking_expires_at_due(client, db):
    from app.models import Booking
    from app.services import jobs

    ops = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    r = client.post(f"{API}/admin/bookings", headers=ops,
                    json=_booking_body(client, ops, c["id"], payment_hours=2, send_sms=False))
    assert r.status_code == 201, r.text
    bid = r.json()["booking"]["id"]
    now = datetime.now(timezone.utc)
    jobs.cancel_unpaid_bookings(db, now + timedelta(hours=1))
    db.commit()
    assert db.get(Booking, bid).status.value == "odeme_bekliyor"
    jobs.cancel_unpaid_bookings(db, now + timedelta(hours=3))
    db.commit()
    db.expire_all()
    assert db.get(Booking, bid).status.value == "iptal"


def test_manual_payment_at_creation_confirms(client, db, sms_outbox):
    ops = staff_headers(client, db, ["operasyon"])
    phone = random_phone()
    c = _new_customer(client, ops, phone=phone)
    body = _booking_body(client, ops, c["id"])
    body["payment"] = {"method": "havale", "amount": body["expected_total"], "reference": "DEKONT-123"}
    r = client.post(f"{API}/admin/bookings", headers=ops, json=body)
    assert r.status_code == 201, r.text
    assert r.json()["booking"]["status"] == "onaylandi"
    detail = client.get(f"{API}/admin/bookings/{r.json()['booking']['id']}", headers=ops).json()
    [p] = detail["payments"]
    assert p["provider"] == "elle" and p["manual_method"] == "havale" and p["provider_ref"] == "DEKONT-123"
    texts = [t for ph, t in sms_outbox if ph == phone]
    assert len(texts) == 1 and "bestaetigt" in texts[0]  # yalnızca onay SMS'i


def test_manual_payment_amount_must_match_and_once(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    r = client.post(f"{API}/admin/bookings", headers=ops,
                    json=_booking_body(client, ops, c["id"], send_sms=False))
    b = r.json()["booking"]
    wrong = client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=ops,
                        json={"method": "nakit", "amount": "1.00"})
    assert wrong.status_code == 400 and wrong.json()["error"]["code"] == "amount_mismatch"
    ok = client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=ops,
                     json={"method": "nakit", "amount": b["total_amount"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["booking"]["status"] == "onaylandi"
    again = client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=ops,
                        json={"method": "nakit", "amount": b["total_amount"]})
    assert again.status_code == 409


def test_price_override_requires_reason_and_is_recorded(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    c = _new_customer(client, ops)
    body = _booking_body(client, ops, c["id"], send_sms=False)
    system_total = Decimal(body["expected_total"])
    no_reason = client.post(f"{API}/admin/bookings", headers=ops, json={**body, "override_total": "40.00"})
    assert no_reason.status_code == 422

    r = client.post(f"{API}/admin/bookings", headers=ops,
                    json={**body, "override_total": "40.00", "override_reason": "Sadık müşteri indirimi"})
    assert r.status_code == 201, r.text
    b = r.json()["booking"]
    assert Decimal(b["total_amount"]) == Decimal("40.00")
    from app.models import Booking

    stored = db.get(Booking, b["id"])
    assert sum(leg.leg_price for leg in stored.legs) == Decimal("40.00")
    manual = r.json()["manual"]
    assert Decimal(manual["system_total_amount"]) == system_total
    assert manual["price_override_reason"] == "Sadık müşteri indirimi"

    from app.models import AuditLog
    from sqlalchemy import select

    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == b["id"], AuditLog.action == "booking.admin_create"))
    assert log is not None and log.changes["override_reason"] == "Sadık müşteri indirimi"


def test_consent_required_and_roles(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    support = staff_headers(client, db, ["destek"])
    c = _new_customer(client, support)  # destek müşteri ekleyebilir
    body = _booking_body(client, ops, c["id"], send_sms=False)
    r = client.post(f"{API}/admin/bookings", headers=ops, json={**body, "consent_confirmed": False})
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent_required"
    assert client.post(f"{API}/admin/bookings", headers=support, json=body).status_code == 403


def test_manual_refund_stays_pending_until_finance_completes(client, db):
    ops = staff_headers(client, db, ["operasyon"])
    finance = staff_headers(client, db, ["muhasebe"])
    c = _new_customer(client, ops)
    body = _booking_body(client, ops, c["id"], hours_ahead=96, send_sms=False)
    body["payment"] = {"method": "nakit", "amount": body["expected_total"]}
    b = client.post(f"{API}/admin/bookings", headers=ops, json=body).json()["booking"]

    r = client.post(f"{API}/admin/bookings/{b['id']}/cancel", headers=ops, json={"reason": "müşteri vazgeçti"})
    assert r.status_code == 200, r.text
    [p] = client.get(f"{API}/admin/bookings/{b['id']}", headers=ops).json()["payments"]
    [refund] = p["refunds"]
    assert refund["status"] == "beklemede" and refund["percent"] == 100

    done = client.post(f"{API}/admin/refunds/{refund['id']}/complete-manual", headers=finance,
                       json={"reference": "Nakit iade, makbuz 7"})
    assert done.status_code == 200 and done.json()["status"] == "tamamlandi"
    [p] = client.get(f"{API}/admin/bookings/{b['id']}", headers=ops).json()["payments"]
    assert p["status"] == "iade_edildi"


def test_manual_payment_rules_roles_and_source(client, db):
    from tests.conftest import booking_body

    ops = staff_headers(client, db, ["operasyon"])
    support = staff_headers(client, db, ["destek"])
    c = _new_customer(client, ops)
    b = client.post(f"{API}/admin/bookings", headers=ops,
                    json=_booking_body(client, ops, c["id"], send_sms=False)).json()["booking"]
    pay = {"method": "havale", "amount": b["total_amount"]}
    assert client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=support, json=pay).status_code == 403
    assert client.post(f"{API}/admin/bookings/{b['id']}/resend-sms", headers=support).status_code == 403
    three = client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=ops,
                        json={**pay, "amount": "10.005"})
    assert three.status_code == 422  # kuruş hanesi en fazla 2

    # K-12: müşterinin sitede açtığı rezervasyona elle tahsilat (havale) kaydedilemez.
    customer = otp_login(client, random_phone())
    own = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client)).json()
    r = client.post(f"{API}/admin/bookings/{own['id']}/manual-payment", headers=ops,
                    json={"method": "havale", "amount": own["total_amount"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "manual_payment_not_allowed"


def test_late_card_payment_after_manual_is_refunded(client, db):
    """K-46 yolu: ödeme bağlantısı açıkken elle tahsilat kaydedilir, kart bildirimi geç gelirse tam iade."""
    ops = staff_headers(client, db, ["operasyon"])
    phone = random_phone()
    c = _new_customer(client, ops, phone=phone)
    b = client.post(f"{API}/admin/bookings", headers=ops,
                    json=_booking_body(client, ops, c["id"], send_sms=False)).json()["booking"]
    headers = otp_login(client, phone)
    r = client.post(f"{API}/me/bookings/{b['booking_code']}/payments", headers=headers)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    ok = client.post(f"{API}/admin/bookings/{b['id']}/manual-payment", headers=ops,
                     json={"method": "nakit", "amount": b["total_amount"]})
    assert ok.status_code == 200, ok.text
    assert client.post(f"{API}/payments/fake/{oid}/complete", data={"status": "success"}).status_code == 200
    payments = client.get(f"{API}/admin/bookings/{b['id']}", headers=ops).json()["payments"]
    card = next(p for p in payments if p["provider"] != "elle")
    manual = next(p for p in payments if p["provider"] == "elle")
    assert card["status"] == "iade_edildi" and manual["status"] == "odendi"


def test_complete_manual_refund_rejects_card_refund(client, db):
    from tests.conftest import booking_body, pay as card_pay

    ops = staff_headers(client, db, ["operasyon"])
    finance = staff_headers(client, db, ["muhasebe"])
    customer = otp_login(client, random_phone())
    own = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client, hours_ahead=96)).json()
    card_pay(client, customer, own["booking_code"])
    client.post(f"{API}/admin/bookings/{own['id']}/cancel", headers=ops, json={"reason": "test iptal"})
    [p] = client.get(f"{API}/admin/bookings/{own['id']}", headers=ops).json()["payments"]
    [refund] = p["refunds"]
    r = client.post(f"{API}/admin/refunds/{refund['id']}/complete-manual", headers=finance, json={"reference": "x1"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_manual_payment"


def test_payment_due_bounds():
    from app.api.admin.manual_bookings import payment_due

    now = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
    assert payment_due(now + timedelta(days=5), now, 24) == now + timedelta(hours=24)
    assert payment_due(now + timedelta(hours=6), now, 24) == now + timedelta(hours=5)  # alıştan 1 saat önce
    assert payment_due(now + timedelta(minutes=40), now, 24) == now + timedelta(minutes=15)  # en az 15 dk


def test_override_scales_price_eur_for_try():
    from types import SimpleNamespace

    from app.models.enums import Currency
    from app.services.bookings import override_quote
    from app.services.quotes import LegPlan, Quote

    def leg(price):
        return LegPlan(pickup_region=None, dropoff_region=None, pickup=None, dropoff=None, pickup_at=None,
                       distance_km=Decimal("10"), duration_minutes=10, price=Decimal(price))

    q = Quote(vehicle_type=SimpleNamespace(), legs=(leg("1500.00"), leg("1500.00")), price_eur=Decimal("80.00"),
              price=Decimal("3000.00"), guarantee_fee=Decimal("0"), total=Decimal("3000.00"), currency=Currency.TRY,
              pricing_rule=None, discount=None, exchange_rate=None)
    o = override_quote(q, Decimal("2400.00"))
    assert o.total == Decimal("2400.00") and sum(x.price for x in o.legs) == Decimal("2400.00")
    assert o.price_eur == Decimal("64.00")
