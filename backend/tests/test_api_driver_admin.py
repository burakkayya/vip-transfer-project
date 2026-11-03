import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pytest
from sqlalchemy import select, text, update
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.exc import DBAPIError

from app.models import AuditLog, Booking, Document, Driver, DriverLedger, FlightInfo
from app.localtime import local_date
from app.services import jobs
from tests.conftest import PDF, booking_body, otp_login, pay, random_phone, staff_headers

DRIVER_DOCS = ["surucu_belgesi", "src_belgesi", "adli_sicil"]
VEHICLE_DOCS = ["arac_ruhsati", "arac_sigortasi", "arac_muayene", "turizm_tasimacilik_yetki"]
NEXT_YEAR = (date.today() + timedelta(days=365)).isoformat()


def upload(client, headers, doc_type, vehicle_id=None):
    data = {"doc_type": doc_type, "valid_until": NEXT_YEAR}
    if vehicle_id:
        data["vehicle_id"] = vehicle_id
    r = client.post("/api/v1/driver/documents", headers=headers, data=data,
                    files={"file": ("belge.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def onboard_driver(client, ops, *, vehicle_type="minivan", online=True):
    """Kayıt, belge yükleme, admin onayı. (sürücü başlıkları, driver_id) döner."""
    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    r = client.post("/api/v1/driver/register", headers=headers, json={"full_name": "Mehmet Yılmaz"})
    assert r.status_code == 201, r.text
    driver_id = r.json()["id"]
    assert set(r.json()["missing_documents"]) == set(DRIVER_DOCS)

    plate = f"07 A {random_phone()[-4:]}"
    r = client.post("/api/v1/driver/vehicles", headers=headers, json={
        "plate": plate, "vehicle_type_code": vehicle_type, "brand": "Mercedes", "model": "Vito", "capacity": 6})
    assert r.status_code == 201, r.text
    vehicle_id = r.json()["id"]

    doc_ids = [upload(client, headers, t) for t in DRIVER_DOCS]
    doc_ids += [upload(client, headers, t, vehicle_id) for t in VEHICLE_DOCS]

    # Belgeler onaylanmadan sürücü onaylanamaz
    r = client.post(f"/api/v1/admin/drivers/{driver_id}/status", headers=ops, json={"status": "onayli"})
    assert r.json()["error"]["code"] == "documents_missing"

    for doc_id in doc_ids:
        r = client.post(f"/api/v1/admin/documents/{doc_id}/review", headers=ops, json={"decision": "onayli"})
        assert r.status_code == 200, r.text
    assert client.post(f"/api/v1/admin/drivers/{driver_id}/status", headers=ops,
                       json={"status": "onayli"}).status_code == 200
    assert client.post(f"/api/v1/admin/vehicles/{vehicle_id}/status", headers=ops,
                       json={"status": "aktif"}).status_code == 200
    if online:
        r = client.post("/api/v1/driver/me/online", headers=headers, json={"is_online": True, "push_token": "tok-1"})
        assert r.status_code == 200, r.text
    return headers, driver_id


@pytest.fixture
def ops(client, db):
    return staff_headers(client, db, ["operasyon"])


def test_staff_login_requires_2fa_and_roles_are_enforced(client, db):
    support = staff_headers(client, db, ["destek"])
    assert client.get("/api/v1/admin/bookings", headers=support).status_code == 200
    assert client.get("/api/v1/admin/payments", headers=support).status_code == 403
    assert client.get("/api/v1/admin/settings", headers=support).status_code == 403
    customer = otp_login(client, random_phone())
    assert client.get("/api/v1/admin/bookings", headers=customer).status_code == 403


def test_staff_wrong_password_and_wrong_totp(client, db):
    from app.services import auth
    from app.models.enums import RoleCode

    auth.create_staff_user(db, email="x-wrong@getawaytransfers.com", password="correct horse battery",
                           roles=[RoleCode.ADMIN], actor_id=None)
    db.commit()
    r = client.post("/api/v1/auth/staff/login", json={"email": "x-wrong@getawaytransfers.com", "password": "nope"})
    assert r.status_code == 401
    r = client.post("/api/v1/auth/staff/login",
                    json={"email": "x-wrong@getawaytransfers.com", "password": "correct horse battery"})
    r = client.post("/api/v1/auth/staff/2fa", json={"mfa_token": r.json()["mfa_token"], "code": "000000"})
    assert r.status_code == 401
    assert db.scalar(select(AuditLog).where(AuditLog.action == "staff.login_failed")) is not None


def test_instant_booking_offer_accept_trip_and_ledger(client, db, ops):
    from app.models import ExchangeRate

    db.add(ExchangeRate(rate=D("40.0000"), source="test", valid_from=datetime(2026, 1, 3, tzinfo=timezone.utc)))
    db.commit()
    driver_headers, driver_id = onboard_driver(client, ops)
    other_headers, _ = onboard_driver(client, ops)

    customer = otp_login(client, random_phone())
    body = booking_body(client, hours_ahead=0, booking_type="anlik",
                        flights=[{"leg_order": 1, "flight_no": "TK2412"}])
    r = client.post("/api/v1/me/bookings", json=body, headers=customer)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    pay(client, customer, code)

    offers = client.get("/api/v1/driver/offers", headers=driver_headers).json()
    offer = next(o for o in offers if o["trip"]["booking_code"] == code)
    # Teklif aşamasında yolcu adı ve adres gizli
    assert offer["trip"]["passenger_name"] == "A***"
    assert offer["trip"]["pickup_address"] is None

    r = client.post(f"/api/v1/driver/offers/{offer['offer_id']}/accept", headers=driver_headers)
    assert r.status_code == 200, r.text
    trip = r.json()
    assert trip["passenger_name"] == "Anna Schmidt"

    # Diğer sürücünün teklifi geri çekildi, listesinde görünmez
    other_offers = client.get("/api/v1/driver/offers", headers=other_headers).json()
    assert code not in {o["trip"]["booking_code"] for o in other_offers}

    booking = client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()
    assert booking["status"] == "atandi"
    assert booking["legs"][0]["driver"]["first_name"] == "Mehmet"

    leg_id = trip["leg_id"]
    # Sıra dışı adım reddedilir
    r = client.post(f"/api/v1/driver/trips/{leg_id}/events", headers=driver_headers, json={"event": "basladi"})
    assert r.json()["error"]["code"] == "invalid_transition"
    for event in ("yola_cikti", "vardi"):
        assert client.post(f"/api/v1/driver/trips/{leg_id}/events", headers=driver_headers,
                           json={"event": event}).status_code == 200

    assert client.post(f"/api/v1/driver/trips/{leg_id}/location", headers=driver_headers,
                       json={"lat": 36.9, "lng": 30.8}).status_code == 204
    loc = client.get(f"/api/v1/me/bookings/{code}/driver-location", headers=customer).json()
    assert loc["lat"] == 36.9

    # Mobil canlı takip: jeton ilk mesajda gönderilir, konum WebSocket ile gelir.
    with client.websocket_connect(f"/api/v1/ws/bookings/{code}/location") as ws:
        ws.send_text(json.dumps({"token": customer["Authorization"].split()[1]}))
        assert ws.receive_json()["location"]["lat"] == 36.9
    with client.websocket_connect(f"/api/v1/ws/bookings/{code}/location") as ws:
        ws.send_text(json.dumps({"token": other_headers["Authorization"].split()[1]}))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401

    for event in ("basladi", "bitti"):
        assert client.post(f"/api/v1/driver/trips/{leg_id}/events", headers=driver_headers,
                           json={"event": event}).status_code == 200
    assert client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()["status"] == "tamamlandi"

    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    entry = db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == b.legs[0].id))
    assert entry.commission_amount == (b.quoted_price * D("0.25")).quantize(D("0.01"))
    assert entry.net_amount == b.quoted_price - entry.commission_amount
    assert entry.net_amount_try == (entry.net_amount * D("40")).quantize(D("0.01"))
    flight = db.scalar(select(FlightInfo).where(FlightInfo.booking_leg_id == b.legs[0].id))
    assert flight.purge_at <= datetime.now(timezone.utc)  # K-31: tamamlanınca silinmeye hazır

    earnings = client.get("/api/v1/driver/earnings", headers=driver_headers).json()
    assert D(earnings["pending_try"]) == entry.net_amount_try


def test_driver_trip_has_route_polyline(client, db, ops, route_line_cleanup):
    from app.providers.polyline import decode

    driver_headers, _ = onboard_driver(client, ops)
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=0, booking_type="anlik"),
                    headers=customer)
    code = r.json()["booking_code"]
    pay(client, customer, code)
    offers = client.get("/api/v1/driver/offers", headers=driver_headers).json()
    offer = next(o for o in offers if o["trip"]["booking_code"] == code)
    assert offer["trip"]["route_polyline"] is None

    trip = client.post(f"/api/v1/driver/offers/{offer['offer_id']}/accept", headers=driver_headers).json()
    assert isinstance(trip["route_polyline"], str) and len(decode(trip["route_polyline"])) >= 2

    listed = client.get("/api/v1/driver/trips", headers=driver_headers).json()
    assert next(t for t in listed if t["booking_code"] == code)["route_polyline"] is None

    r = client.post(f"/api/v1/driver/trips/{trip['leg_id']}/events", headers=driver_headers,
                    json={"event": "yola_cikti"})
    assert isinstance(r.json()["route_polyline"], str)


def _accepted_trip(client, ops, driver_headers):
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=0, booking_type="anlik"),
                    headers=customer)
    code = r.json()["booking_code"]
    pay(client, customer, code)
    offers = client.get("/api/v1/driver/offers", headers=driver_headers).json()
    offer = next(o for o in offers if o["trip"]["booking_code"] == code)
    return client.post(f"/api/v1/driver/offers/{offer['offer_id']}/accept", headers=driver_headers).json()


def test_driver_trip_detail_has_route_polyline(client, db, ops, route_line_cleanup):
    from app.providers.polyline import decode

    driver_headers, _ = onboard_driver(client, ops)
    trip = _accepted_trip(client, ops, driver_headers)
    r = client.get(f"/api/v1/driver/trips/{trip['leg_id']}", headers=driver_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["leg_id"] == trip["leg_id"] and body["passenger_name"] == "Anna Schmidt"
    assert len(decode(body["route_polyline"])) >= 2


def test_driver_trip_detail_other_driver_404(client, db, ops, route_line_cleanup):
    owner, _ = onboard_driver(client, ops)
    other, _ = onboard_driver(client, ops)
    trip = _accepted_trip(client, ops, owner)
    assert client.get(f"/api/v1/driver/trips/{trip['leg_id']}", headers=other).status_code == 404
    assert client.get(f"/api/v1/driver/trips/{uuid.uuid4()}", headers=owner).status_code == 404


def test_second_driver_cannot_take_assigned_leg(client, db, ops):
    first, _ = onboard_driver(client, ops, vehicle_type="vip_van")
    second, _ = onboard_driver(client, ops, vehicle_type="vip_van")
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=0, booking_type="anlik",
                                                            vehicle="vip_van"), headers=customer)
    code = r.json()["booking_code"]
    pay(client, customer, code)

    def offer_for(h):
        return next(o for o in client.get("/api/v1/driver/offers", headers=h).json()
                    if o["trip"]["booking_code"] == code)

    first_offer, second_offer = offer_for(first), offer_for(second)
    assert client.post(f"/api/v1/driver/offers/{first_offer['offer_id']}/accept", headers=first).status_code == 200
    r = client.post(f"/api/v1/driver/offers/{second_offer['offer_id']}/accept", headers=second)
    assert r.status_code == 409


def test_scheduled_booking_manual_assignment(client, db, ops):
    _, driver_id = onboard_driver(client, ops, vehicle_type="minivan", online=False)
    customer = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client, vehicle="minivan"),
                       headers=customer).json()["booking_code"]
    pay(client, customer, code)

    pending = client.get("/api/v1/admin/dispatch/pending", headers=ops).json()
    leg = next(p for p in pending if p["booking_code"] == code)
    candidates = client.get(f"/api/v1/admin/dispatch/legs/{leg['leg_id']}/candidates", headers=ops).json()
    assert driver_id in {c["driver_id"] for c in candidates}
    r = client.post(f"/api/v1/admin/dispatch/legs/{leg['leg_id']}/assign", headers=ops, json={"driver_id": driver_id})
    assert r.status_code == 204, r.text
    assert client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()["status"] == "atandi"


def test_admin_cancel_with_override_refund(client, db, ops):
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, hours_ahead=10), headers=customer)
    code, booking_id = r.json()["booking_code"], r.json()["id"]
    pay(client, customer, code)
    assert client.get(f"/api/v1/me/bookings/{code}/cancellation", headers=customer).json()["refund_percent"] == 0
    r = client.post(f"/api/v1/admin/bookings/{booking_id}/cancel", headers=ops,
                    json={"reason": "araç arızası", "refund_percent": 100})
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/v1/admin/bookings/{booking_id}", headers=ops).json()
    assert detail["payments"][0]["status"] == "iade_edildi"
    assert detail["customer_phone"].count("*") == 3


def test_pricing_rule_versioning_does_not_change_existing_booking(client, db):
    admin = staff_headers(client, db, ["admin"])
    customer = otp_login(client, random_phone())
    body = booking_body(client, vehicle="minibus")
    r = client.post("/api/v1/me/bookings", json=body, headers=customer)
    code, old_total = r.json()["booking_code"], r.json()["total_amount"]
    vt_id = next(v["id"] for v in client.get("/api/v1/vehicle-types").json() if v["code"] == "minibus")
    r = client.post("/api/v1/admin/pricing-rules", headers=admin, json={
        "vehicle_type_id": vt_id, "base_price_per_km": "2.00", "minimum_price": "50", "rounding_step": "5"})
    assert r.status_code == 201, r.text
    new_quote = client.post("/api/v1/quotes", json={k: body[k] for k in (
        "pickup", "dropoff", "vehicle_type_code", "pickup_at", "passenger_count")}).json()
    assert D(new_quote["total"]) > D(old_total)
    assert client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()["total_amount"] == old_total


def test_settings_validation(client, db):
    admin = staff_headers(client, db, ["admin"])
    assert client.put("/api/v1/admin/settings/try_rounding_step", headers=admin, json={"value": "x"}).status_code == 400
    assert client.put("/api/v1/admin/settings/try_rounding_step", headers=admin, json={"value": 5}).status_code == 200
    assert client.put("/api/v1/admin/settings/try_rounding_step", headers=admin, json={"value": 10}).status_code == 200


def test_document_upload_rejects_wrong_content(client, db, ops):
    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    client.post("/api/v1/driver/register", headers=headers, json={"full_name": "Ali Veli"})
    r = client.post("/api/v1/driver/documents", headers=headers, data={"doc_type": "src_belgesi"},
                    files={"file": ("x.pdf", b"MZ not a pdf", "application/pdf")})
    assert r.json()["error"]["code"] == "invalid_file_type"


def test_audit_log_is_append_only(db):
    db.add(AuditLog(action="test.immutable", entity_type="test"))
    db.commit()
    with pytest.raises(DBAPIError):
        db.execute(update(AuditLog).where(AuditLog.action == "test.immutable").values(action="x"))
    db.rollback()
    with pytest.raises(DBAPIError):
        db.execute(text("delete from audit_logs"))
    db.rollback()


def test_jobs_expire_documents_and_cancel_unpaid(client, db, ops):
    driver_headers, driver_id = onboard_driver(client, ops)
    doc = db.scalar(select(Document).where(Document.owner_id == db.get(Driver, driver_id).id,
                                           Document.doc_type == "src_belgesi"))
    later = datetime.now(timezone.utc) + timedelta(hours=1)
    # Geçerlilik Türkiye takvimine göredir; sunucunun saat diliminden bağımsız.
    doc.valid_until = local_date(later) - timedelta(days=1)
    db.commit()

    customer = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=customer).json()["booking_code"]

    assert jobs.expire_documents(db, later) >= 1
    assert jobs.cancel_unpaid_bookings(db, later) >= 1
    db.commit()
    db.expire_all()
    driver = db.get(Driver, driver_id)
    assert driver.status.value == "pasif"
    assert driver.is_online is False
    assert client.get(f"/api/v1/me/bookings/{code}", headers=customer).json()["status"] == "iptal"


def test_late_payment_after_cancellation_is_refunded(client, db):
    customer = otp_login(client, random_phone())
    code = client.post("/api/v1/me/bookings", json=booking_body(client), headers=customer).json()["booking_code"]
    r = client.post(f"/api/v1/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    client.post(f"/api/v1/me/bookings/{code}/cancel", json={"reason": "vazgeçtim"}, headers=customer)
    client.post(f"/api/v1/payments/fake/{oid}/complete", data={"status": "success"})
    from app.models import Payment

    db.expire_all()
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    assert payment.status.value == "iade_edildi"


def test_flight_data_purge(client, db):
    customer = otp_login(client, random_phone())
    r = client.post("/api/v1/me/bookings", json=booking_body(client, flights=[{"leg_order": 1, "flight_no": "PC123"}]),
                    headers=customer)
    leg_id = r.json()["legs"][0]["id"]
    assert jobs.purge_flight_data(db, datetime.now(timezone.utc) + timedelta(days=10)) >= 1
    db.commit()
    assert db.scalar(select(FlightInfo).where(FlightInfo.booking_leg_id == leg_id)) is None


def test_payout_flow(client, db):
    finance = staff_headers(client, db, ["muhasebe"])
    r = client.post("/api/v1/admin/payouts", headers=finance)
    assert r.status_code == 201, r.text
    assert client.get("/api/v1/admin/payouts/export.csv", headers=finance).text.startswith("odeme_id;")
