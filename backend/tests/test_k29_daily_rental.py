"""K-29 şoförlü günlük kiralama: teklif, rezervasyon, ödeme, sürücü akışı, admin fiyat sürümleri."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Booking, DailyRate, VehicleType
from tests.conftest import future, otp_login, pay, random_phone, region_id
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _job
from tests.trip_clock import make_due

API = "/api/v1"


def _quote_body(client, *, days=3, package="tam", vehicle="minivan", hours_ahead=72, country=None, **extra):
    body = {
        "pickup": {"region_id": region_id(client, "kemer"), "address": "Otel Örnek, Kemer"},
        "vehicle_type_code": vehicle,
        "start_at": future(hours_ahead),
        "days": days,
        "package": package,
        "passenger_count": 3,
        "luggage_count": 2,
    }
    if country:
        body["country_code"] = country
    body.update(extra)
    return body


def _rate(db, code="minivan") -> DailyRate:
    vt = db.scalar(select(VehicleType).where(VehicleType.code == code))
    return db.scalars(select(DailyRate).where(DailyRate.vehicle_type_id == vt.id, DailyRate.is_active.is_(True))
                      .order_by(DailyRate.valid_from.desc(), DailyRate.id.desc())).first()


def _book(client, headers, **kw):
    body = _quote_body(client, **kw)
    q = client.post(f"{API}/daily-quotes", json=body)
    assert q.status_code == 200, q.text
    body.update(expected_total=q.json()["total"], passenger_name="Anna Schmidt", accept_disclosure=True,
                accept_distance_sales=True, locale="de", note="Gün 1: Olimpos, Gün 2: Phaselis")
    return client.post(f"{API}/me/daily-bookings", headers=headers, json=body)


def test_daily_quote_full_day_eur(client, db):
    rate = _rate(db)
    r = client.post(f"{API}/daily-quotes", json=_quote_body(client, days=3))
    assert r.status_code == 200, r.text
    q = r.json()
    assert q["currency"] == "EUR" and q["package"] == "tam" and q["days"] == 3
    assert q["hours_per_day"] == rate.full_day_hours and q["km_per_day"] == rate.full_day_km
    assert Decimal(q["day_price"]) == rate.full_day_price
    assert Decimal(q["total"]) == rate.full_day_price * 3 == Decimal(q["price"])
    assert len(q["schedule"]) == 3
    starts = [datetime.fromisoformat(d["start_at"]) for d in q["schedule"]]
    assert starts[1] - starts[0] == timedelta(days=1) and starts[2] - starts[1] == timedelta(days=1)
    assert Decimal(q["extra_hour_price"]) == rate.extra_hour_price


def test_daily_quote_half_day_and_try(client, db):
    rate = _rate(db, "vip_van")
    half = client.post(f"{API}/daily-quotes", json=_quote_body(client, days=1, package="yarim", vehicle="vip_van")).json()
    assert half["hours_per_day"] == rate.half_day_hours and Decimal(half["day_price"]) == rate.half_day_price
    from app.models import ExchangeRate

    db.add(ExchangeRate(rate=Decimal("40.0000"), source="test", valid_from=datetime(2026, 1, 2, tzinfo=timezone.utc)))
    db.commit()
    tr = client.post(f"{API}/daily-quotes", json=_quote_body(client, days=2, country="TR")).json()
    assert tr["currency"] == "TRY"
    assert Decimal(tr["day_price"]) % 5 == 0 and Decimal(tr["total"]) == Decimal(tr["day_price"]) * 2


@pytest.mark.parametrize("days", [0, 15])
def test_daily_quote_rejects_day_count(client, days):
    assert client.post(f"{API}/daily-quotes", json=_quote_body(client, days=days)).status_code == 422


def test_daily_quote_capacity(client):
    r = client.post(f"{API}/daily-quotes", json=_quote_body(client, passenger_count=20))
    assert r.status_code == 400 and r.json()["error"]["code"] == "capacity_exceeded"


def test_daily_booking_requires_lead_time(client):
    customer = otp_login(client, random_phone())
    r = _book(client, customer, hours_ahead=6)
    assert r.status_code == 400 and r.json()["error"]["code"] == "daily_lead_time_too_short"


def test_daily_booking_created_with_one_leg_per_day(client, db):
    customer = otp_login(client, random_phone())
    r = _book(client, customer, days=3)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["service_type"] == "gunluk" and b["status"] == "odeme_bekliyor" and not b["is_round_trip"]
    assert b["daily"]["package"] == "tam" and b["daily"]["days"] == 3 and b["daily"]["hours_per_day"] == 10
    assert len(b["legs"]) == 3 and all(leg["duration_minutes"] == 600 for leg in b["legs"])
    assert all(leg["pickup_region"]["code"] == leg["dropoff_region"]["code"] == "kemer" for leg in b["legs"])
    assert b["payment_due_at"] is not None

    booking = db.scalar(select(Booking).where(Booking.booking_code == b["booking_code"]))
    assert booking.daily_rate_id is not None and booking.is_daily
    assert sum(leg.leg_price for leg in booking.legs) == booking.total_amount


def test_daily_booking_price_changed(client):
    customer = otp_login(client, random_phone())
    body = _quote_body(client)
    body.update(expected_total="1.00", passenger_name="Anna Schmidt", accept_disclosure=True,
                accept_distance_sales=True)
    r = client.post(f"{API}/me/daily-bookings", headers=customer, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "price_changed"


def test_daily_driver_flow_finish_anywhere_and_busy_window(client, db, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    b = _book(client, customer, days=2).json()
    pay(client, customer, b["booking_code"])
    driver, _ = onboard_driver(client, ops, online=False)

    job = _job(client, driver, b["booking_code"])
    assert job is not None and job["service_type"] == "gunluk" and job["duration_minutes"] == 600
    detail = client.get(f"{API}/driver/jobs/{job['leg_id']}", headers=driver).json()
    assert isinstance(detail["preview_polyline"], str)  # bölge merkezi, kesin adres yok

    trip = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver).json()
    assert trip["service_type"] == "gunluk" and trip["route_polyline"] is None
    leg_id = trip["leg_id"]

    # Aynı sürücü 10 saatlik gün içinde başlayan bir transferi alamaz (aralık kesişimi).
    from tests.test_trips import _paid_booking

    other_customer, other_code = _paid_booking(client, hours_ahead=72 + 4)
    other = client.get(f"{API}/driver/jobs", headers=driver).json()
    assert all(j["booking_code"] != other_code for j in other)

    # Gün hemen bitirilebilir (asgari süre yok) ve bitiş yeri serbesttir.
    make_due(db, leg_id)
    kemer = next(x for x in client.get(f"{API}/regions").json() if x["code"] == "kemer")
    point = {"lat": float(kemer["latitude"]), "lng": float(kemer["longitude"])}
    for event in ("yola_cikti", "vardi", "basladi"):
        r = client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver, json={"event": event, **point})
        assert r.status_code == 200, r.text
    updates = client.get(f"{API}/me/updates", headers=customer).json()
    started = next(u for u in updates if u["code"] == "trip_started")
    assert "10" in started["body"] and "Stunden" in started["body"]  # locale de, günlük metin
    # Sürücü günü hemen bitiremez (asgari süre günlükte de geçerli); müşteri dilediği an bitirebilir (K-48).
    r = client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver,
                    json={"event": "bitti", "lat": point["lat"] + 0.002, "lng": point["lng"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_too_short", r.text
    r = client.post(f"{API}/me/bookings/{b['booking_code']}/finish", headers=customer)
    assert r.status_code == 200, r.text
    detail = client.get(f"{API}/me/bookings/{b['booking_code']}", headers=customer).json()
    assert [leg["status"] for leg in detail["legs"]] == ["bitti", "beklemede"]


def test_admin_daily_rates_versioned(client, db, ops):  # noqa: F811
    from tests.conftest import staff_headers

    admin = staff_headers(client, db, ["admin"])
    assert client.post(f"{API}/admin/daily-rates", headers=ops, json={}).status_code == 403  # yalnızca admin
    vt = db.scalar(select(VehicleType).where(VehicleType.code == "minibus"))
    bad = {"vehicle_type_id": vt.id, "full_day_price": "100", "half_day_price": "150",
           "extra_hour_price": "30", "extra_km_price": "1.2"}
    assert client.post(f"{API}/admin/daily-rates", headers=admin, json=bad).status_code == 422
    r = client.post(f"{API}/admin/daily-rates", headers=admin, json={**bad, "full_day_price": "275"})
    assert r.status_code == 201, r.text
    rows = client.get(f"{API}/admin/daily-rates", headers=ops).json()
    assert any(x["id"] == r.json()["id"] for x in rows)
    q = client.post(f"{API}/daily-quotes", json=_quote_body(client, days=1, vehicle="minibus")).json()
    assert Decimal(q["day_price"]) == Decimal("275")
    assert client.post(f"{API}/admin/daily-rates/{r.json()['id']}/deactivate", headers=admin).status_code == 200
    q = client.post(f"{API}/daily-quotes", json=_quote_body(client, days=1, vehicle="minibus")).json()
    assert Decimal(q["day_price"]) != Decimal("275")


def test_admin_booking_list_filters_daily(client, ops):  # noqa: F811
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=2).json()["booking_code"]
    rows = client.get(f"{API}/admin/bookings", headers=ops, params={"service_type": "gunluk", "code": code}).json()
    assert len(rows) == 1 and rows[0]["service_type"] == "gunluk" and rows[0]["days"] == 2
    assert client.get(f"{API}/admin/bookings", headers=ops,
                      params={"service_type": "transfer", "code": code}).json() == []


def test_transfer_unchanged(client):
    from tests.conftest import booking_body

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client, round_trip=True))
    assert r.status_code == 201
    assert r.json()["service_type"] == "transfer" and r.json()["daily"] is None and r.json()["is_round_trip"]


def test_daily_lead_time_setting(client, db):
    from app.services import system_settings

    assert system_settings.get(db, "daily_min_lead_hours") == 24
    assert datetime.now(timezone.utc)  # yalnızca ayarın varsayılanı


def test_daily_cancel_refunds_each_day_by_its_own_start(client, db):
    """K-29: iade gün bazında; 1. gün 24 saatten yakınsa %0, sonraki günler kendi kademesiyle."""
    from app.services import bookings as svc

    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=3, hours_ahead=30).json()["booking_code"]
    pay(client, customer, code)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    now = datetime.now(timezone.utc) + timedelta(hours=10)  # günler 20, 44 ve 68 saat sonra
    q = svc.refund_quote(db, booking, now)
    day = booking.legs[0].leg_price
    assert q.refund_amount == day * Decimal("0.5") + day  # %0 + %50 + %100
    assert 0 < q.refund_percent < 100


def test_daily_price_eur_matches_rounded_day_price(client, db, ops):  # noqa: F811
    from tests.conftest import staff_headers

    admin = staff_headers(client, db, ["admin"])
    vt = db.scalar(select(VehicleType).where(VehicleType.code == "vip_minibus"))
    r = client.post(f"{API}/admin/daily-rates", headers=admin, json={
        "vehicle_type_id": vt.id, "full_day_price": "321.50", "half_day_price": "180",
        "extra_hour_price": "35", "extra_km_price": "1.4"})
    assert r.status_code == 201
    customer = otp_login(client, random_phone())
    code = _book(client, customer, days=2, vehicle="vip_minibus").json()["booking_code"]
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert booking.total_amount == Decimal("650.00") and booking.price_eur == Decimal("650.00")
    client.post(f"{API}/admin/daily-rates/{r.json()['id']}/deactivate", headers=admin)
