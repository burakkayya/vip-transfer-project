"""Sürücü araçları (K-63): kanıtlı bekleme ve "yolcu gelmedi", çıkış önerisi, günlük plan, not kartı."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.api.deps import utcnow
from app.localtime import local_date
from app.models import Booking, DriverLedger, TripEvent
from app.models.enums import TripEventType
from app.services import driver_tools
from tests.conftest import future, otp_login, pay, random_phone, region_id
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_meeting import _codes, _event, _setup

API = "/api/v1"


def _dt(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


@pytest.fixture
def clock(client):
    """İstek saatini ileri almak için: clock(t) sonraki istekleri t anında çalıştırır."""
    def set_now(t: datetime):
        client.app.dependency_overrides[utcnow] = lambda: t
    yield set_now
    client.app.dependency_overrides.pop(utcnow, None)


def _ayt(client):
    r = next(x for x in client.get(f"{API}/regions").json() if x["code"] == "ayt")
    return float(r["latitude"]), float(r["longitude"])


def test_no_show_needs_arrival_wait_and_presence(client, db, ops, clock):
    driver, customer, code, _, trip = _setup(client, ops, note="Lobi girişinde bekliyoruz")
    leg_id = trip["leg_id"]
    assert trip["customer_note"] == "Lobi girişinde bekliyoruz" and trip["no_show_after"] is None
    at = _ayt(client)

    r = client.post(f"{API}/driver/trips/{leg_id}/no-show", headers=driver, json={"lat": at[0], "lng": at[1]})
    assert r.json()["error"]["code"] == "invalid_transition"
    _event(client, driver, leg_id, "yola_cikti", (at[0] + 0.1, at[1]))
    _event(client, driver, leg_id, "vardi", at)
    t = client.get(f"{API}/driver/trips/{leg_id}", headers=driver).json()
    pickup, unlock = _dt(t["pickup_at"]), _dt(t["no_show_after"])
    assert t["arrived_at"] and unlock == pickup + timedelta(minutes=60)  # havalimanı: alıştan 60 dk

    r = client.post(f"{API}/driver/trips/{leg_id}/no-show", headers=driver, json={"lat": at[0], "lng": at[1]})
    assert r.json()["error"]["code"] == "wait_not_over" and r.json()["error"]["details"]["no_show_after"]

    clock(unlock + timedelta(minutes=1))
    r = client.post(f"{API}/driver/trips/{leg_id}/no-show", headers=driver, json={"lat": at[0] + 0.1, "lng": at[1]})
    assert r.json()["error"]["code"] == "too_far_from_pickup"
    r = client.post(f"{API}/driver/trips/{leg_id}/no-show", headers=driver, json={"lat": at[0], "lng": at[1]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "bitti" and r.json()["no_show"] is True
    client.app.dependency_overrides.pop(utcnow, None)  # bildirim akışı gerçek saate göre okunur

    assert "no_show" in _codes(client, customer)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert booking.status.value == "tamamlandi"
    assert db.scalar(select(DriverLedger).where(DriverLedger.booking_leg_id == leg_id)) is not None
    ev = db.scalar(select(TripEvent).where(TripEvent.booking_leg_id == leg_id, TripEvent.event_type == TripEventType.NO_SHOW))
    assert ev is not None and ev.latitude is not None
    arrived = db.scalar(select(TripEvent).where(TripEvent.booking_leg_id == leg_id, TripEvent.event_type == TripEventType.ARRIVED))
    assert arrived.latitude is not None  # "Vardım" konumu kanıt olarak saklanır
    # Gerçekleşmeyen yolculuk puanlanmaz.
    assert client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()["leg_id"] is None


def test_no_show_waits_for_late_flight(db, client, ops):
    from app.models import BookingLeg, FlightInfo

    _, _, _, _, trip = _setup(client, ops)
    leg = db.get(BookingLeg, trip["leg_id"])
    leg.arrived_at = leg.pickup_at
    leg.flight = FlightInfo(flight_no="TK1", direction="gelis", estimated_at=leg.pickup_at + timedelta(minutes=50),
                            purge_at=leg.pickup_at + timedelta(days=1))
    # Uçuş 50 dk rötarlı: yolcu iniş + 30 dk çıkışta beklenir, ücretsiz bekleme oradan 60 dk.
    assert driver_tools.no_show_after(leg) == leg.pickup_at + timedelta(minutes=50 + 30 + 60)
    db.rollback()


def test_departure_suggestion(client, ops):
    driver, _, _, _, trip = _setup(client, ops)
    at = _ayt(client)
    r = client.get(f"{API}/driver/trips/{trip['leg_id']}/departure", headers=driver,
                   params={"lat": at[0] + 0.3, "lng": at[1]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["drive_minutes"] > 20 and d["based_on_flight"] is False
    assert _dt(d["leave_at"]) == _dt(d["target_at"]) - timedelta(minutes=d["drive_minutes"] + 10)


def _kemer_to_ayt_body(client, hours_ahead):
    body = {
        "pickup": {"region_id": region_id(client, "kemer"), "address": "Otel Kemer"},
        "dropoff": {"region_id": region_id(client, "ayt")},
        "vehicle_type_code": "minivan",
        "pickup_at": future(hours_ahead),
        "passenger_count": 2,
        "luggage_count": 1,
    }
    quote = client.post(f"{API}/quotes", json=body).json()
    body.update(booking_type="planli", expected_total=quote["total"], passenger_name="Max Muster",
                accept_disclosure=True, accept_distance_sales=True, locale="en")
    return body


def test_plan_lists_day_earnings_and_return_jobs(client, db, ops):
    driver, _, _, _, trip = _setup(client, ops, hours_ahead=30)
    pickup = _dt(trip["pickup_at"])
    # Kemer'den dönüş işi: ilk işin bitişinden ~2 saat sonra (meşgul tamponunun dışında).
    other = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=other, json=_kemer_to_ayt_body(client, 30 + 3))
    assert r.status_code == 201, r.text
    pay(client, other, r.json()["booking_code"])

    day = local_date(pickup).isoformat()
    plan = client.get(f"{API}/driver/plan", headers=driver, params={"day": day}).json()
    assert plan["day"] == day and [t["leg_id"] for t in plan["trips"]] == [trip["leg_id"]]
    assert plan["earnings"] == {"EUR": trip["driver_amount"]}
    assert any(j["booking_code"] == r.json()["booking_code"] for j in plan["return_jobs"])
    # Başka günün planı boş.
    empty = client.get(f"{API}/driver/plan", headers=driver,
                       params={"day": (local_date(pickup) + timedelta(days=3)).isoformat()}).json()
    assert empty["trips"] == [] and empty["return_jobs"] == []

    # Akşam özeti: ertesi gün işi olan sürücüye bir kez.
    evening = pickup - timedelta(days=1)
    assert driver_tools.send_daily_plans(db, evening) >= 1
    db.commit()
    assert driver_tools.send_daily_plans(db, evening) == 0
    db.commit()
    assert "daily_plan" in _codes(client, driver, "driver")


def test_offer_hides_customer_note(client, ops):
    driver, _ = onboard_driver(client, ops, online=True)
    customer = otp_login(client, random_phone())
    from tests.conftest import booking_body

    body = booking_body(client, booking_type="anlik", hours_ahead=0, note="Oda 214")
    r = client.post(f"{API}/me/bookings", headers=customer, json=body)
    assert r.status_code == 201, r.text
    pay(client, customer, r.json()["booking_code"])
    offers = client.get(f"{API}/driver/offers", headers=driver).json()
    mine = [o for o in offers if o["trip"]["booking_code"] == r.json()["booking_code"]]
    assert all(o["trip"]["customer_note"] is None for o in mine)


def test_now_fixture_cleanup(client):
    assert utcnow not in client.app.dependency_overrides
    assert abs((utcnow() - datetime.now(timezone.utc)).total_seconds()) < 5
