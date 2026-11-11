"""Uçuş takibi (K-60): AeroDataBox yanıtının okunması ve zamanlanmış sorgu/bildirim."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import redis

from app.config import get_settings
from app.localtime import LOCAL_TZ, local_date
from app.models import FlightInfo
from app.providers import flights as fl
from app.services import flight_tracking
from tests.conftest import booking_body, otp_login, pay, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür

API = "/api/v1"


def _dt(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


@pytest.fixture(autouse=True)
def _fresh_budget():
    # Testler ayrı Redis veritabanını (15) kullanır; günlük sayaç her testte sıfırlanır.
    r = redis.Redis.from_url(get_settings().redis_url)
    for key in r.scan_iter("flight_calls:*"):
        r.delete(key)
    yield


def _payload(status="Expected", arr_iata="AYT", sched="2026-11-12 10:00Z", revised=None, runway=None):
    arrival = {"airport": {"iata": arr_iata}, "scheduledTime": {"utc": sched, "local": "x"}}
    if revised:
        arrival["revisedTime"] = {"utc": revised, "local": "x"}
    if runway:
        arrival["runwayTime"] = {"utc": runway, "local": "x"}
    return {"number": "TK 1980", "status": status, "departure": {"airport": {"iata": "IST"}}, "arrival": arrival}


def test_parse_arrivals_filters_airport_and_picks_best_time():
    other = _payload(arr_iata="ESB", sched="2026-11-12 08:00Z")
    ours = _payload(status="EnRoute", revised="2026-11-12 10:40Z")
    [got] = fl.parse_arrivals([other, ours], "AYT")
    assert got.status == fl.DEPARTED
    assert got.scheduled_at == datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    assert got.estimated_at == datetime(2026, 11, 12, 10, 40, tzinfo=timezone.utc)

    [landed] = fl.parse_arrivals([_payload(status="Arrived", revised="2026-11-12 10:20Z", runway="2026-11-12 10:12Z")], "AYT")
    assert landed.status == fl.LANDED and landed.estimated_at.minute == 12
    assert fl.parse_arrivals([_payload(status="Expected", revised="2026-11-12 10:30Z")], "AYT")[0].status == fl.DELAYED
    # Başka havalimanına inen sefer, yanlış numarada sürücüye gösterilmez.
    assert fl.parse_arrivals([other], "AYT") == []
    assert fl.parse_arrivals([], "AYT") == [] and fl.parse_arrivals({"error": 1}, "AYT") == []
    assert fl.parse_arrivals([_payload(status="Canceled")], None)[0].status == fl.CANCELLED
    # Kesinleşmemiş iptal takibi durdurmaz.
    assert fl.parse_arrivals([_payload(status="CanceledUncertain")], None)[0].status == fl.UNKNOWN
    bad = {"number": "X", "status": "Expected", "arrival": {"airport": "AYT"}}
    assert fl.parse_arrivals([bad], "AYT") == []


def test_query_days_cover_midnight_pickup():
    pickup = datetime(2026, 11, 13, 0, 15, tzinfo=LOCAL_TZ)
    fi = SimpleNamespace(provider_scheduled_at=None)
    leg = SimpleNamespace(pickup_at=pickup)
    assert flight_tracking._days(fi, leg) == [date(2026, 11, 12), date(2026, 11, 13)]
    fi.provider_scheduled_at = datetime(2026, 11, 12, 23, 40, tzinfo=LOCAL_TZ)
    assert flight_tracking._days(fi, leg) == [date(2026, 11, 12)]
    # Aynı numaralı ertesi gün seferi alışa en yakın olan değil.
    near = fl.FlightStatus(fl.SCHEDULED, datetime(2026, 11, 12, 23, 40, tzinfo=LOCAL_TZ), None)
    far = fl.FlightStatus(fl.SCHEDULED, datetime(2026, 11, 13, 23, 40, tzinfo=LOCAL_TZ), None)
    assert flight_tracking._closest([far, near], pickup) is near
    assert flight_tracking._closest([far], pickup) is None


def _booking(client, ops_headers, flight_no, *, accept=True, hours_ahead=3):
    driver, _ = onboard_driver(client, ops_headers)
    customer = otp_login(client, random_phone())
    body = booking_body(client, hours_ahead=hours_ahead, flights=[{"leg_order": 1, "flight_no": flight_no}])
    r = client.post(f"{API}/me/bookings", headers=customer, json=body)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    pay(client, customer, code)
    job = next(j for j in client.get(f"{API}/driver/jobs", headers=driver).json() if j["booking_code"] == code)
    if accept:
        r = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver)
        assert r.status_code == 200, r.text
    pickup = _dt(client.get(f"{API}/me/bookings/{code}", headers=customer).json()["legs"][0]["pickup_at"])
    return SimpleNamespace(driver=driver, customer=customer, code=code, leg_id=job["leg_id"], pickup=pickup)


def _driver_codes(client, driver):
    return sorted(u["code"] for u in client.get(f"{API}/driver/updates", headers=driver).json()
                  if u["code"].startswith("flight_"))


def _calls(fake, no):
    return sum(1 for n, _ in fake.calls if n == no)


def test_tracks_delay_and_landing(client, db, ops):
    now = datetime.now(timezone.utc)
    b = _booking(client, ops, "tk 1980")
    sched = b.pickup - timedelta(minutes=30)
    fake = fl.FakeFlights({"TK1980": [fl.FlightStatus(fl.DELAYED, sched, sched + timedelta(minutes=40))]})
    flight_tracking.refresh_flights(db, now, fake)
    trip = client.get(f"{API}/driver/trips/{b.leg_id}", headers=b.driver).json()
    assert trip["flight_no"] == "TK1980" and trip["flight_status"] == fl.DELAYED
    assert _dt(trip["flight_estimated_at"]) == sched + timedelta(minutes=40)
    assert _driver_codes(client, b.driver) == ["flight_delayed"]

    # Aralık dolmadan tekrar sorgulanmaz; aynı kayma için tekrar bildirim gitmez.
    calls = _calls(fake, "TK1980")
    flight_tracking.refresh_flights(db, now + timedelta(minutes=5), fake)
    assert _calls(fake, "TK1980") == calls

    fake.results["TK1980"] = [fl.FlightStatus(fl.LANDED, sched, sched + timedelta(minutes=38))]
    flight_tracking.refresh_flights(db, now + timedelta(hours=1), fake)
    assert _driver_codes(client, b.driver) == ["flight_delayed", "flight_landed"]
    body = client.get(f"{API}/me/bookings/{b.code}", headers=b.customer).json()
    assert body["legs"][0]["flight"]["status"] == fl.LANDED

    # İnen uçuş bir daha sorgulanmaz.
    calls = _calls(fake, "TK1980")
    flight_tracking.refresh_flights(db, now + timedelta(hours=2), fake)
    assert _calls(fake, "TK1980") == calls


def test_delay_notified_after_driver_assigned_and_cancel_stops(client, db, ops):
    now = datetime.now(timezone.utc)
    b = _booking(client, ops, "PC2001", accept=False)
    sched = b.pickup - timedelta(minutes=20)
    fake = fl.FakeFlights({"PC2001": [fl.FlightStatus(fl.DELAYED, sched, sched + timedelta(minutes=50))]})
    flight_tracking.refresh_flights(db, now, fake)
    assert db.query(FlightInfo).filter_by(flight_no="PC2001").one().notified_at is None

    r = client.post(f"{API}/driver/jobs/{b.leg_id}/accept", headers=b.driver)
    assert r.status_code == 200, r.text
    flight_tracking.refresh_flights(db, now + timedelta(minutes=50), fake)
    assert _driver_codes(client, b.driver) == ["flight_delayed"]

    fake.results["PC2001"] = [fl.FlightStatus(fl.CANCELLED, sched, sched)]
    flight_tracking.refresh_flights(db, now + timedelta(minutes=100), fake)
    assert _driver_codes(client, b.driver) == ["flight_cancelled", "flight_delayed"]
    calls = _calls(fake, "PC2001")
    flight_tracking.refresh_flights(db, now + timedelta(minutes=160), fake)
    assert _calls(fake, "PC2001") == calls


def test_not_found_stops_after_misses_and_big_delay_keeps_tracking(client, db, ops):
    now = datetime.now(timezone.utc)
    wrong = _booking(client, ops, "XQ999")
    late = _booking(client, ops, "LH1300")
    sched = late.pickup - timedelta(minutes=10)
    fake = fl.FakeFlights({"LH1300": [fl.FlightStatus(fl.DELAYED, sched, late.pickup + timedelta(hours=5))]})
    for minutes in (0, 50, 100, 150):
        flight_tracking.refresh_flights(db, now + timedelta(minutes=minutes), fake)
    db.expire_all()
    assert db.query(FlightInfo).filter_by(flight_no="XQ999").one().status == fl.NOT_FOUND
    assert _calls(fake, "XQ999") == get_settings().flight_max_misses

    # Alıştan 3 saatten fazla geçse de tahmini iniş henüz gelmediği için takip sürer.
    calls = _calls(fake, "LH1300")
    flight_tracking.refresh_flights(db, late.pickup + timedelta(hours=4), fake)
    assert _calls(fake, "LH1300") == calls + 1
    assert wrong.code != late.code


def test_daily_limit_and_unexpected_error(client, db, ops, monkeypatch):
    now = datetime.now(timezone.utc)
    _booking(client, ops, "FH3001")
    fake = fl.FakeFlights({}, fail=True)
    monkeypatch.setattr(get_settings(), "flight_daily_call_limit", 0)
    flight_tracking.refresh_flights(db, now, fake)
    assert _calls(fake, "FH3001") == 0

    monkeypatch.setattr(get_settings(), "flight_daily_call_limit", 100)
    flight_tracking.refresh_flights(db, now, fake)  # beklenmeyen hata görevi düşürmez
    assert _calls(fake, "FH3001") == 1
    db.expire_all()
    fi = db.query(FlightInfo).filter_by(flight_no="FH3001").one()
    assert fi.checked_at is not None and fi.check_count == 1
    flight_tracking.refresh_flights(db, now + timedelta(minutes=1), fake)
    assert _calls(fake, "FH3001") == 1  # sorgu kaydı kaldı, hemen tekrar denenmez
    assert local_date(now)


def test_refresh_flights_off_without_provider(db):
    assert flight_tracking.refresh_flights(db, datetime.now(timezone.utc)) == 0
