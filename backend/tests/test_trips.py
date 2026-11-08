"""Uber tarzı yolculuk akışı: iş havuzu (K-47), erken bitiş (K-48), bitirme yarıçapı (K-49),
sohbet (K-50), müşteri bildirimleri ve ETA (K-51)."""

from sqlalchemy import select

from app.models import Booking, DriverLedger
from app.services.route_line import trim_ends
from tests.conftest import booking_body, otp_login, pay, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür

API = "/api/v1"


def _region(client, code):
    return next(x for x in client.get(f"{API}/regions").json() if x["code"] == code)


def _paid_booking(client, *, booking_type="planli", hours_ahead=72, vehicle="minivan"):
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=customer,
                    json=booking_body(client, booking_type=booking_type, hours_ahead=hours_ahead, vehicle=vehicle))
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    pay(client, customer, code)
    return customer, code


def _job(client, headers, code, **params):
    jobs = client.get(f"{API}/driver/jobs", headers=headers, params=params).json()
    return next((j for j in jobs if j["booking_code"] == code), None)


def _updates(client, headers, who="me"):
    path = f"{API}/me/updates" if who == "me" else f"{API}/driver/updates"
    return [u["code"] for u in client.get(path, headers=headers).json()]


def test_pool_lists_scheduled_job_masked_and_first_accept_wins(client, db, ops):
    first, _ = onboard_driver(client, ops, online=False)
    second, _ = onboard_driver(client, ops, online=False)
    other_type, _ = onboard_driver(client, ops, vehicle_type="vip_van", online=False)
    customer, code = _paid_booking(client)

    ayt = _region(client, "ayt")
    job = _job(client, first, code, lat=float(ayt["latitude"]), lng=float(ayt["longitude"]))
    assert job is not None, "planlı iş çevrimdışı sürücünün havuzunda da görünür"
    assert job["passenger_initial"] == "A." and "pickup_address" not in job
    assert job["pickup_distance_km"] is not None and float(job["pickup_distance_km"]) < 5
    assert job["preview_polyline"] is None  # listede rota yok
    assert _job(client, other_type, code) is None  # araç tipi uymuyor

    detail = client.get(f"{API}/driver/jobs/{job['leg_id']}", headers=first).json()
    assert isinstance(detail["preview_polyline"], str)

    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=first)
    assert r.status_code == 200, r.text
    assert r.json()["passenger_name"] == "Anna Schmidt"
    assert r.json()["dropoff_lat"] is not None

    r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=second)
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_taken"
    assert _job(client, second, code) is None
    assert client.get(f"{API}/me/bookings/{code}", headers=customer).json()["status"] == "atandi"
    assert "driver_assigned" in _updates(client, customer)


def test_instant_job_only_for_online_driver_and_decline_hides_it(client, db, ops):
    online, _ = onboard_driver(client, ops, online=True)
    offline, _ = onboard_driver(client, ops, online=False)
    _, code = _paid_booking(client, booking_type="anlik", hours_ahead=0)

    job = _job(client, online, code)
    assert job is not None and job["offer_expires_at"] is not None  # anlık teklif geri sayımı
    assert _job(client, offline, code) is None
    assert client.get(f"{API}/driver/jobs/{job['leg_id']}", headers=offline).json()["error"]["code"] == "driver_offline"

    assert client.post(f"{API}/driver/jobs/{job['leg_id']}/decline", headers=online).status_code == 204
    assert _job(client, online, code) is None


def _accepted(client, ops_headers, *, online=False):
    driver, _ = onboard_driver(client, ops_headers, online=online)
    customer, code = _paid_booking(client)
    job = _job(client, driver, code)
    trip = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()
    return driver, customer, code, trip["leg_id"]


def _event(client, driver, leg_id, event, point=None):
    body = {"event": event}
    if point:
        body.update(lat=point[0], lng=point[1])
    return client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver, json=body)


def test_eta_notifications_and_approach_route(client, db, ops):
    driver, customer, code, leg_id = _accepted(client, ops)
    ayt = _region(client, "ayt")
    pickup = (float(ayt["latitude"]), float(ayt["longitude"]))
    far = (pickup[0] + 0.25, pickup[1] + 0.25)  # ~35 km kuzeydoğu

    r = client.get(f"{API}/driver/trips/{leg_id}/approach", headers=driver, params={"lat": far[0], "lng": far[1]})
    assert r.json()["target"] == "pickup" and r.json()["polyline"]

    assert _event(client, driver, leg_id, "yola_cikti", far).status_code == 200
    assert "driver_en_route" in _updates(client, customer)
    eta = client.get(f"{API}/me/bookings/{code}/eta", headers=customer).json()
    assert eta["status"] == "yolda" and eta["eta_minutes"] > 12

    # Yaklaştı: bir kez bildirilir.
    near = (pickup[0] + 0.002, pickup[1])
    for _ in range(2):
        assert client.post(f"{API}/driver/trips/{leg_id}/location", headers=driver,
                           json={"lat": near[0], "lng": near[1]}).status_code == 204
    codes = _updates(client, customer)
    assert codes.count("driver_approaching") == 1

    assert _event(client, driver, leg_id, "vardi").status_code == 200
    assert _event(client, driver, leg_id, "basladi").status_code == 200
    assert {"driver_arrived", "trip_started"} <= set(_updates(client, customer))

    r = client.get(f"{API}/driver/trips/{leg_id}/approach", headers=driver, params={"lat": pickup[0], "lng": pickup[1]})
    body = r.json()
    assert body["target"] == "dropoff"
    assert body["finish_distance_m"] > body["finish_radius_m"]


def test_customer_can_finish_trip_any_time_after_pickup(client, db, ops):
    driver, customer, code, leg_id = _accepted(client, ops)
    r = client.post(f"{API}/me/bookings/{code}/finish", headers=customer)
    assert r.json()["error"]["code"] == "no_active_trip"  # yolcu araçta değil

    for event in ("yola_cikti", "vardi", "basladi"):
        assert _event(client, driver, leg_id, event).status_code == 200
    r = client.post(f"{API}/me/bookings/{code}/finish", headers=customer)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"
    assert "customer_finished" in _updates(client, driver, who="driver")

    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == booking.legs[0].id)) is not None


def test_chat_between_customer_and_driver(client, db, ops):
    customer, code = _paid_booking(client)
    r = client.get(f"{API}/me/bookings/{code}/messages", headers=customer)
    assert r.json()["error"]["code"] == "chat_unavailable"

    driver, _ = onboard_driver(client, ops, online=False)
    stranger, _ = onboard_driver(client, ops, online=False)
    job = _job(client, driver, code)
    leg_id = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()["leg_id"]

    assert client.post(f"{API}/driver/trips/{leg_id}/messages", headers=driver,
                       json={"body": "Merhaba, girişteyim."}).status_code == 201
    assert client.post(f"{API}/me/bookings/{code}/messages", headers=customer,
                       json={"body": "Geliyorum!"}).status_code == 201
    assert client.post(f"{API}/me/bookings/{code}/messages", headers=customer,
                       json={"body": "   "}).json()["error"]["code"] == "message_empty"

    assert client.get(f"{API}/me/bookings/{code}/messages/unread", headers=customer).json()["unread"] == 1
    chat = client.get(f"{API}/me/bookings/{code}/messages", headers=customer).json()
    assert chat["open"] and chat["unread"] == 1 and chat["other_name"] == "Mehmet"
    assert [m["sender"] for m in chat["messages"]] == ["driver", "customer"]
    assert client.get(f"{API}/me/bookings/{code}/messages/unread", headers=customer).json()["unread"] == 0
    assert "new_message" in _updates(client, customer)
    assert "new_message" in _updates(client, driver, who="driver")

    assert client.get(f"{API}/driver/trips/{leg_id}/messages", headers=stranger).status_code == 404

    # Yolculuk bitince yazışma kapanır, geçmiş okunur.
    kemer = _region(client, "kemer")
    for event in ("yola_cikti", "vardi", "basladi"):
        _event(client, driver, leg_id, event)
    assert _event(client, driver, leg_id, "bitti",
                  (float(kemer["latitude"]), float(kemer["longitude"]))).status_code == 200
    r = client.post(f"{API}/driver/trips/{leg_id}/messages", headers=driver, json={"body": "Teşekkürler"})
    assert r.json()["error"]["code"] == "chat_closed"
    assert client.get(f"{API}/driver/trips/{leg_id}/messages", headers=driver).json()["open"] is False


def test_customer_cancel_notifies_assigned_driver(client, db, ops):
    driver, customer, code, _ = _accepted(client, ops)
    r = client.post(f"{API}/me/bookings/{code}/cancel", headers=customer, json={})
    assert r.status_code == 200, r.text
    assert "trip_cancelled" in _updates(client, driver, who="driver")


def test_trim_ends_hides_exact_endpoints():
    line = [(36.0 + i * 0.001, 30.0) for i in range(30)]  # ~111 m aralık, ~3.2 km
    trimmed = trim_ends(line, 400)
    assert trimmed[0][0] > line[0][0] + 0.003 and trimmed[-1][0] < line[-1][0] - 0.003
    short = [(36.0, 30.0), (36.001, 30.0), (36.002, 30.0)]
    assert len(trim_ends(short, 400)) >= 2


def test_admin_reviews_chat_with_reason_and_customer_finished_list(client, db, ops):
    """K-55: personel sohbeti gerekçeyle açar (denetim kaydı, okundu değişmez), müşterinin bitirdiği yolculukları
    listeler; sürücünün bitirdiği listede yer almaz."""
    from datetime import date

    from app.models import AuditLog, TripMessage
    from tests.conftest import staff_headers

    driver, customer, code, leg_id = _accepted(client, ops)
    client.post(f"{API}/driver/trips/{leg_id}/messages", headers=driver, json={"body": "Girişteyim."})
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Geliyorum"})
    for event in ("yola_cikti", "vardi", "basladi"):
        assert _event(client, driver, leg_id, event).status_code == 200
    assert client.post(f"{API}/me/bookings/{code}/finish", headers=customer).status_code == 200
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))

    support = staff_headers(client, db, ["destek"])
    finance = staff_headers(client, db, ["muhasebe"])
    url = f"{API}/admin/bookings/{booking.id}/messages"
    assert client.post(url, headers=support, json={"reason": "     "}).status_code == 422  # yalnızca boşluk
    assert client.post(url, headers=finance, json={"reason": "Şikâyet #12"}).status_code == 403
    r = client.post(url, headers=support, json={"reason": "  Şikâyet #12: erken bitirme  "})
    assert r.status_code == 200, r.text
    chat = r.json()
    assert [m["sender"] for m in chat["messages"]] == ["driver", "customer"]
    assert chat["messages"][0]["driver_name"] == chat["legs"][0]["driver_name"] and chat["retention_days"] == 30
    log = db.scalar(select(AuditLog).where(AuditLog.entity_id == str(booking.id), AuditLog.action == "booking.chat_view"))
    assert log is not None and log.changes["reason"] == "Şikâyet #12: erken bitirme"
    # Personel okuması "okundu" işaretlemez: iki taraf da sohbeti açmadığı için ikisi de okunmamış kalır.
    db.expire_all()
    assert [m.read_at for m in db.scalars(select(TripMessage).where(TripMessage.booking_leg_id == booking.legs[0].id))]         == [None, None]

    rows = client.get(f"{API}/admin/trips/customer-finished", headers=support).json()
    row = next(x for x in rows if x["booking_code"] == code)
    assert row["leg_id"] == leg_id and row["actual_minutes"] == 0 and row["early"] is True
    assert row["started_at"] and row["finished_at"]
    assert any(x["booking_code"] == code for x in
               client.get(f"{API}/admin/trips/customer-finished", headers=support, params={"early": True}).json())
    yesterday = date.today().replace(day=1).isoformat() if date.today().day > 1 else "2000-01-01"
    assert all(x["booking_code"] != code for x in client.get(
        f"{API}/admin/trips/customer-finished", headers=support,
        params={"date_from": "2000-01-01", "date_to": "2000-01-02"}).json())
    assert any(x["booking_code"] == code for x in client.get(
        f"{API}/admin/trips/customer-finished", headers=support, params={"date_from": yesterday}).json())

    # Sürücünün kendisinin bitirdiği yolculuk listede yer almaz.
    driver2, _, code2, leg2 = _accepted(client, ops)
    kemer = _region(client, "kemer")
    for event in ("yola_cikti", "vardi", "basladi"):
        assert _event(client, driver2, leg2, event).status_code == 200
    assert _event(client, driver2, leg2, "bitti", (float(kemer["latitude"]), float(kemer["longitude"]))).status_code == 200
    assert all(x["booking_code"] != code2 for x in
               client.get(f"{API}/admin/trips/customer-finished", headers=support).json())

    assert client.get(f"{API}/admin/trips/customer-finished", headers=finance).status_code == 403
