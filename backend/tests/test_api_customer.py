import uuid
from decimal import Decimal as D

from sqlalchemy import select, text

from app import pricing
from app.models import Booking, Consent, Invoice, Notification, OtpChallenge
from app.providers.polyline import decode
from app.providers.routing import HaversineRouting, Point
from tests.conftest import booking_body, future, otp_login, pay, random_phone, region_id


def test_regions_and_vehicle_types_are_public(client):
    regions = client.get("/api/v1/regions").json()
    codes = {r["code"] for r in regions}
    assert {"ayt", "dlm", "bjv", "kemer", "bodrum", "fethiye"} <= codes
    assert len([r for r in regions if r["type"] == "havalimani"]) == 4
    codes = {v["code"] for v in client.get("/api/v1/vehicle-types").json()}
    assert codes >= {"minivan", "vip_van", "minibus", "vip_minibus"}
    assert "sedan" not in codes  # sedan hizmetten kaldırıldı


def test_quote_matches_pricing_formula(client):
    regions = {r["code"]: r for r in client.get("/api/v1/regions").json()}
    body = {
        "pickup": {"region_id": regions["ayt"]["id"]},
        "dropoff": {"region_id": regions["alanya"]["id"]},
        "vehicle_type_code": "minivan",
        "pickup_at": future(72),
        "passenger_count": 2,
    }
    r = client.post("/api/v1/quotes", json=body)
    assert r.status_code == 200, r.text
    q = r.json()
    route = HaversineRouting(D("1.30")).route(
        Point(D(regions["ayt"]["latitude"]), D(regions["ayt"]["longitude"])),
        Point(D(regions["alanya"]["latitude"]), D(regions["alanya"]["longitude"])),
    )
    assert D(q["total"]) == pricing.quote_price(route.distance_km, pricing.PricingRule(vehicle_multiplier=D("1.30")))
    assert q["currency"] == "EUR"
    assert D(q["total"]) % 5 == 0
    assert q["guarantee_available"] is False


def test_quote_rejects_over_capacity_and_unknown_region(client):
    body = {
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "kemer")},
        "vehicle_type_code": "minivan",
        "pickup_at": future(72),
        "passenger_count": 9,
    }
    assert client.post("/api/v1/quotes", json=body).json()["error"]["code"] == "capacity_exceeded"
    body.update(passenger_count=1, dropoff={"region_id": 99999})
    assert client.post("/api/v1/quotes", json=body).status_code == 404


def test_quote_ignores_raw_client_coordinates(client):
    """K-58: fiyat gerçek noktalardan hesaplanır; jetonsuz ham koordinat fiyatı değiştiremez."""
    base = {
        "pickup": {"region_id": region_id(client, "ayt")},
        "dropoff": {"region_id": region_id(client, "alanya")},
        "vehicle_type_code": "minivan",
        "pickup_at": future(72),
        "passenger_count": 1,
    }
    honest = client.post("/api/v1/quotes", json=base).json()
    # Alış Alanya'ya, bırakış Antalya'ya doğru kaydırılmış koordinatlarla mesafe kısaltılmaya çalışılır.
    forged = {**base,
              "pickup": {**base["pickup"], "lat": "36.75", "lng": "31.15"},
              "dropoff": {**base["dropoff"], "lat": "36.70", "lng": "31.30"}}
    r = client.post("/api/v1/quotes", json=forged).json()
    assert r["total"] == honest["total"]
    assert r["legs"][0]["distance_km"] == honest["legs"][0]["distance_km"]


def test_guarantee_not_sold_until_legal_confirmation(client):
    body = booking_body(client)
    body["with_guarantee"] = True
    r = client.post("/api/v1/quotes", json={k: body[k] for k in
                                           ("pickup", "dropoff", "vehicle_type_code", "pickup_at",
                                            "passenger_count", "with_guarantee")})
    assert r.json()["error"]["code"] == "guarantee_unavailable"


def test_otp_wrong_code_and_attempt_limit(client, db):
    phone = random_phone()
    client.post("/api/v1/auth/otp/request", json={"phone": phone})
    for _ in range(5):
        r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 401
    challenge = db.scalars(select(OtpChallenge).order_by(OtpChallenge.created_at.desc())).first()
    assert challenge.attempts == 5
    assert challenge.code_hash != "000000"


def test_otp_rate_limit(client):
    phone = random_phone()
    for _ in range(5):
        assert client.post("/api/v1/auth/otp/request", json={"phone": phone}).status_code == 200
    assert client.post("/api/v1/auth/otp/request", json={"phone": phone}).status_code == 429


def test_invalid_phone_rejected(client):
    r = client.post("/api/v1/auth/otp/request", json={"phone": "05321234567"})
    assert r.status_code == 422


def test_refresh_rotates_and_logout_revokes(client):
    phone = random_phone()
    from app.providers.sms import get_sms_sender

    client.post("/api/v1/auth/otp/request", json={"phone": phone})
    code = get_sms_sender().outbox[-1][1].split(": ")[1][:6]
    tokens = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code}).json()
    new = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert new.status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    headers = {"Authorization": f"Bearer {new.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_booking_payment_and_full_refund_flow(client, db):
    headers = otp_login(client, random_phone())
    body = booking_body(client, flights=[{"leg_order": 1, "flight_no": "LH 1234"}])
    r = client.post("/api/v1/me/bookings", json=body, headers=headers)
    assert r.status_code == 201, r.text
    booking = r.json()
    code = booking["booking_code"]
    assert booking["status"] == "odeme_bekliyor"
    assert booking["currency"] == "EUR"
    assert booking["legs"][0]["flight"]["flight_no"] == "LH1234"
    assert booking["legs"][0]["flight"]["direction"] == "gelis"

    pay(client, headers, code)
    detail = client.get(f"/api/v1/me/bookings/{code}", headers=headers).json()
    assert detail["status"] == "onaylandi"

    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert db.scalar(select(Invoice).where(Invoice.booking_id == b.id)) is not None
    assert {c.consent_type.value for c in db.scalars(select(Consent).where(Consent.customer_id == b.customer_id))} \
        >= {"aydinlatma", "mesafeli_satis"}
    assert db.scalar(select(Notification).where(Notification.recipient_id == b.customer_id,
                                                Notification.template_code == "booking_confirmed")).status.value \
        == "gonderildi"
    # Hassas alanlar veritabanında şifreli
    raw = db.execute(text("select passenger_name from bookings where id = :id"), {"id": b.id}).scalar()
    assert "Anna" not in raw

    preview = client.get(f"/api/v1/me/bookings/{code}/cancellation", headers=headers).json()
    assert preview["refund_percent"] == 100
    assert preview["refund_amount"] == booking["quoted_price"]

    r = client.post(f"/api/v1/me/bookings/{code}/cancel", json={"reason": "plan değişti"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "iptal"
    db.expire_all()
    from app.models import Payment

    payment = db.scalar(select(Payment).where(Payment.booking_id == b.id))
    assert payment.status.value == "iade_edildi"
    assert payment.refunds[0].amount == D(booking["quoted_price"])


def test_half_refund_between_24_and_48_hours(client, db):
    headers = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=30), headers=headers)
    code = r.json()["booking_code"]
    pay(client, headers, code)
    preview = client.get(f"/api/v1/me/bookings/{code}/cancellation", headers=headers).json()
    assert preview["refund_percent"] == 50
    assert D(preview["refund_amount"]) == D(r.json()["quoted_price"]) / 2


def test_round_trip_creates_two_legs(client):
    headers = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, round_trip=True), headers=headers)
    assert r.status_code == 201, r.text
    legs = r.json()["legs"]
    assert [leg["leg_order"] for leg in legs] == [1, 2]
    assert legs[1]["pickup_region"]["code"] == "kemer"
    assert legs[0]["flight"] is None


def test_price_change_is_rejected(client):
    headers = otp_login(client, random_phone())
    body = booking_body(client, expected_total="1.00")
    r = client.post("/api/v1/me/bookings", json=body, headers=headers)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "price_changed"


def test_consent_is_required(client):
    headers = otp_login(client, random_phone())
    body = booking_body(client, accept_distance_sales=False)
    assert client.post("/api/v1/me/bookings", json=body, headers=headers).json()["error"]["code"] == "consent_required"


def test_scheduled_lead_time(client):
    headers = otp_login(client, random_phone())
    body = booking_body(client, hours_ahead=1)
    assert client.post("/api/v1/me/bookings", json=body, headers=headers).json()["error"]["code"] \
        == "lead_time_too_short"


def test_turkish_customer_pays_try_with_rate(client, db):
    from datetime import datetime, timezone

    from app.models import ExchangeRate

    db.add(ExchangeRate(rate=D("40.0000"), source="test", valid_from=datetime(2026, 1, 2, tzinfo=timezone.utc)))
    db.commit()
    headers = otp_login(client, random_phone(), country_code="TR")
    r = client.post("/api/v1/me/bookings", json=booking_body(client, country="TR"), headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["currency"] == "TRY"
    assert D(r.json()["total_amount"]) % 10 == 0


def test_customer_cannot_see_other_customers_booking(client):
    a = otp_login(client, random_phone())
    b = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=a).json()["booking_code"]
    assert client.get(f"/api/v1/me/bookings/{code}", headers=b).status_code == 404


def test_failed_payment_keeps_booking_payable(client):
    headers = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers).json()["booking_code"]
    pay(client, headers, code, status="failed")
    assert client.get(f"/api/v1/me/bookings/{code}", headers=headers).json()["status"] == "odeme_bekliyor"
    pay(client, headers, code)
    assert client.get(f"/api/v1/me/bookings/{code}", headers=headers).json()["status"] == "onaylandi"


def test_forged_callback_rejected(client):
    r = client.post("/api/v1/payments/fake/XYZ/complete", data={"status": "success"})
    assert r.status_code == 404


def test_fake_checkout_frameable_only_by_web(client):
    headers = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers).json()["booking_code"]
    url = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers).json()["iframe_url"]
    path = url.split("localhost:8000", 1)[1]
    page = client.get(path)
    assert page.headers["content-security-policy"] == "frame-ancestors http://localhost:3000"
    assert "x-frame-options" not in page.headers
    done = client.post(f"{path}/complete", data={"status": "failed"})
    assert "/booking/payment-result?status=fail" in done.text
    # Diğer uçlar çerçevelenemez.
    assert client.get("/api/v1/regions").headers["x-frame-options"] == "DENY"


def test_profile_consent_and_data_request(client):
    headers = otp_login(client, random_phone())
    r = client.patch("/api/v1/me/profile", json={"full_name": "Anna Schmidt", "email": "Anna@Example.com"},
                     headers=headers)
    assert r.json()["email"] == "anna@example.com"
    assert client.post("/api/v1/me/consents", json={"consent_type": "pazarlama", "accepted": False, "version": "1.0"},
                       headers=headers).status_code == 201
    r = client.post("/api/v1/me/data-requests", json={"request_type": "erisim"}, headers=headers)
    assert r.status_code == 201
    assert client.get("/api/v1/me/data-requests", headers=headers).json()[0]["status"] == "acik"


def test_customer_booking_detail_has_route_polyline(client, route_line_cleanup):
    headers = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    detail = client.get(f"/api/v1/me/bookings/{code}", headers=headers).json()
    line = detail["legs"][0]["route_polyline"]
    assert isinstance(line, str) and line
    assert len(decode(line)) >= 2


def test_customer_booking_list_omits_route_polyline(client, route_line_cleanup):
    headers = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers)
    assert r.status_code == 201, r.text
    assert "route_polyline" in r.json()["legs"][0]
    assert r.json()["legs"][0]["route_polyline"] is None
    rows = client.get("/api/v1/me/bookings", headers=headers).json()
    assert rows and all(leg["route_polyline"] is None for b in rows for leg in b["legs"])


def test_repeated_payment_start_reuses_open_checkout(client, db):
    """Çift ödeme önlemi: açık (beklemede, süresi dolmamış) ödeme varsa yeni kayıt açılmaz, aynı sayfa döner."""
    from app.models import Booking, Payment

    headers = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers).json()["booking_code"]
    first = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers).json()
    second = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers).json()
    assert second["payment_id"] == first["payment_id"]
    assert second["iframe_url"] == first["iframe_url"]
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert len(db.scalars(select(Payment).where(Payment.booking_id == booking.id)).all()) == 1


def test_expired_open_payment_is_not_reused(client, db):
    from datetime import timedelta

    from app.models import Booking, Payment
    from app.services.payments import CHECKOUT_REUSE_WINDOW

    headers = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=headers).json()["booking_code"]
    first = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers).json()
    payment = db.get(Payment, uuid.UUID(first["payment_id"]))
    payment.created_at = payment.created_at - CHECKOUT_REUSE_WINDOW - timedelta(minutes=1)
    db.commit()
    second = client.post(f"/api/v1/me/bookings/{code}/payments", headers=headers).json()
    assert second["payment_id"] != first["payment_id"]
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert len(db.scalars(select(Payment).where(Payment.booking_id == booking.id)).all()) == 2
