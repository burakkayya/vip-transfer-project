"""Ücretli API önbelleği, popüler yerler ve uçuş sorgusu paylaşımı (K-61)."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

import pytest
import redis

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.localtime import local_date
from app.models import FlightInfo, PopularPlace
from app.providers import flights as fl
from app.providers import places as pl
from app.providers.routing import CachedRouting, Point, Route
from app.services import api_cache, flight_tracking
from tests.conftest import future, region_id
from tests.test_api_driver_admin import ops  # noqa: F401 - fikstür
from tests.test_flights import _booking, _calls

API = "/api/v1"
_PATTERNS = ("route:v1:*", "places_ac:*", "places_det:*", "place_pick*", "api_stats:*", "flight_arr:*",
             "flight_calls:*")


@pytest.fixture(autouse=True)
def _clean(db):
    r = redis.Redis.from_url(get_settings().redis_url)

    def wipe():
        for pattern in _PATTERNS:
            for key in r.scan_iter(pattern):
                r.delete(key)
        db.query(PopularPlace).delete()
        db.commit()

    wipe()
    yield
    wipe()


class _CountingRouter:
    def __init__(self):
        self.calls = 0

    def route(self, origin, destination):
        self.calls += 1
        return Route(distance_km=D("12.34"), duration_minutes=21, polyline="abc")


def test_route_cache_is_shared_and_exact():
    a, b = Point(D("36.898700"), D("30.800500")), Point(D("36.601800"), D("30.559400"))
    first_inner, second_inner = _CountingRouter(), _CountingRouter()
    first = CachedRouting(first_inner, 3600).route(a, b)
    # Başka bir süreç (ayrı sarmalayıcı) aynı çifti sağlayıcıya sormadan alır.
    second = CachedRouting(second_inner, 3600).route(a, b)
    assert first == second == Route(distance_km=D("12.34"), duration_minutes=21, polyline="abc")
    assert (first_inner.calls, second_inner.calls) == (1, 0)
    # Ters yön ve farklı nokta ayrı rotadır.
    CachedRouting(second_inner, 3600).route(b, a)
    CachedRouting(second_inner, 3600).route(a, Point(D("36.601900"), D("30.559400")))
    assert second_inner.calls == 2
    usage = api_cache.stats(local_date(datetime.now(timezone.utc)).isoformat())
    assert usage["routes_call"] == 3 and usage["routes_hit"] == 1


class _CountingPlaces(pl.FakePlaces):
    def __init__(self):
        self.ac = self.det = 0

    def autocomplete(self, query, session, language):
        self.ac += 1
        return super().autocomplete(query, session, language)

    def details(self, place_id, session, language):
        self.det += 1
        return super().details(place_id, session, language)


def test_places_cache_by_query_language_and_place():
    inner = _CountingPlaces()
    cached = pl.CachedPlaces(inner, 3600, 3600)
    first = cached.autocomplete("Kaleiçi", "s1", "tr")
    assert cached.autocomplete(" kaleici ", "s2", "tr") == first and inner.ac == 1  # yazım farkı aynı sorgu
    cached.autocomplete("Kaleiçi", "s3", "en")
    assert inner.ac == 2  # dil ayrı önbellek
    detail = cached.details("fake-kaleici", "s1", "tr")
    again = cached.details("fake-kaleici", "s9", "tr")
    assert again == detail and isinstance(again.lat, D) and inner.det == 1
    # Sağlayıcı hatası önbelleğe yazılmaz.
    with pytest.raises(Exception):
        cached.details("yok", "s1", "tr")
    with pytest.raises(Exception):
        cached.details("yok", "s1", "tr")
    assert inner.det == 3


def _add(client, ops, name, subtitle="Konyaaltı, Antalya", **extra):
    body = {"name": name, "subtitle": subtitle, "region_id": region_id(client, "konyaalti"),
            "latitude": "36.884000", "longitude": "30.668000", **extra}
    r = client.post(f"{API}/admin/popular-places", headers=ops, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_popular_places_answer_short_queries_without_paid_search(client, ops, monkeypatch):
    tag = "qz" + uuid.uuid4().hex[:5]
    rows = [_add(client, ops, f"{tag.capitalize()} Resort {i}") for i in range(3)]

    class Boom:
        def autocomplete(self, *a):
            raise AssertionError("ücretli aramaya gidilmemeliydi")

        details = autocomplete

    monkeypatch.setattr("app.api.public.get_places", lambda: Boom())
    short = tag[:4]
    hits = client.get(f"{API}/places/autocomplete", params={"q": short}).json()
    assert [h["place_id"] for h in hits] == [f"pp-{r['id']}" for r in rows]
    # Seçim de ücretli servise gitmez; jeton fiyat teklifinde kullanılır.
    r = client.get(f"{API}/places/{hits[0]['place_id']}")
    assert r.status_code == 200, r.text
    picked = r.json()
    assert picked["region"]["code"] == "konyaalti" and picked["address"].startswith(tag.capitalize())
    monkeypatch.undo()
    airport = client.get(f"{API}/places/fake-ayt").json()
    q = client.post(f"{API}/quotes", json={
        "pickup": {"place_token": airport["place_token"]}, "dropoff": {"place_token": picked["place_token"]},
        "vehicle_type_code": "minivan", "pickup_at": future(72), "passenger_count": 2, "luggage_count": 1})
    assert q.status_code == 200 and D(q.json()["total"]) > 0, q.text

    # Pasif yer önerilmez ve seçilemez.
    off = rows[0]
    r = client.put(f"{API}/admin/popular-places/{off['id']}", headers=ops, json={
        "name": off["name"], "subtitle": off["subtitle"], "region_id": off["region_id"],
        "latitude": off["latitude"], "longitude": off["longitude"], "is_active": False})
    assert r.status_code == 200, r.text
    ids = [h["place_id"] for h in client.get(f"{API}/places/autocomplete", params={"q": short}).json()]
    assert f"pp-{off['id']}" not in ids and len(ids) == 2
    assert client.get(f"{API}/places/pp-{off['id']}").status_code == 404
    assert client.get(f"{API}/places/pp-abc").status_code == 404


def test_long_query_merges_paid_results_and_survives_outage(client, ops, monkeypatch):
    for i in range(3):
        _add(client, ops, f"Kemer Otel {i}", subtitle="Kemer, Antalya")
    local_first = client.get(f"{API}/places/autocomplete", params={"q": "kemer"}).json()
    assert [h["place_id"].startswith("pp-") for h in local_first[:3]] == [True] * 3
    assert "fake-kemer" in [h["place_id"] for h in local_first]  # uzun sorguda tam arama da yapılır

    class Down:
        def autocomplete(self, *a):
            raise ServiceUnavailable("kapalı")

    monkeypatch.setattr("app.api.public.get_places", lambda: Down())
    hits = client.get(f"{API}/places/autocomplete", params={"q": "kemer otel"})
    assert hits.status_code == 200 and len(hits.json()) == 3
    assert client.get(f"{API}/places/autocomplete", params={"q": "side antik"}).status_code == 503


def test_frequent_picks_become_candidates_and_can_be_promoted(client, ops):
    for _ in range(2):
        assert client.get(f"{API}/places/fake-kemer").status_code == 200
    assert client.get(f"{API}/places/fake-side").status_code == 200
    cands = client.get(f"{API}/admin/popular-places/candidates", headers=ops).json()
    assert [(c["place_id"], c["picks"]) for c in cands] == [("fake-kemer", 2), ("fake-side", 1)]
    assert "Kemer Marina" in cands[0]["label"]

    r = client.post(f"{API}/admin/popular-places/promote", headers=ops,
                    json={"place_id": "fake-kemer", "name": "Kemer Marina", "subtitle": "Kemer, Antalya"})
    assert r.status_code == 201, r.text
    assert r.json()["region_name"] == "Kemer" and r.json()["google_place_id"] == "fake-kemer"
    again = client.post(f"{API}/admin/popular-places/promote", headers=ops,
                        json={"place_id": "fake-kemer", "name": "Kemer Marina"})
    assert again.status_code == 400 and again.json()["error"]["code"] == "popular_place_exists"
    # Listeye alınan yer aramada bir kez görünür (ücretli sonuçla çiftlenmez).
    hits = client.get(f"{API}/places/autocomplete", params={"q": "kemer marina"}).json()
    assert [h["place_id"] for h in hits] == [f"pp-{r.json()['id']}"]

    r = client.post(f"{API}/admin/popular-places/candidates/dismiss", headers=ops, json={"place_id": "fake-side"})
    assert r.status_code == 204
    assert client.get(f"{API}/admin/popular-places/candidates", headers=ops).json() == []

    usage = client.get(f"{API}/admin/api-usage", headers=ops, params={"days": 2}).json()
    assert len(usage) == 2 and usage[0]["places_details"]["local"] == 0
    assert set(usage[0]) == {"day", "routes", "places_autocomplete", "places_details", "flights"}
    assert client.get(f"{API}/admin/popular-places", headers={}).status_code in (401, 403)


def test_same_flight_on_two_bookings_is_queried_once(client, db, ops):
    now = datetime.now(timezone.utc)
    first, second = _booking(client, ops, "SU2130"), _booking(client, ops, "SU2130")
    sched = first.pickup - timedelta(minutes=30)
    fake = fl.FakeFlights({"SU2130": [fl.FlightStatus(fl.DELAYED, sched, sched + timedelta(minutes=40))]})
    assert flight_tracking.refresh_flights(db, now, fake) == 2
    # Gece yarısından hemen sonraki alışta iki gün sorulur; her (uçuş, gün) yalnızca bir kez sorulur.
    once = len(fake.calls)
    assert once in (1, 2) and len(set(fake.calls)) == once
    r = redis.Redis.from_url(get_settings().redis_url)
    assert int(r.get(f"flight_calls:{local_date(now).isoformat()}")) == once  # sınırdan yalnızca gerçek sorgu düşer
    db.expire_all()
    rows = db.query(FlightInfo).filter_by(flight_no="SU2130").all()
    assert {x.status for x in rows} == {fl.DELAYED} and len({x.checked_at for x in rows}) == 1
    for b in (first, second):
        trip = client.get(f"{API}/driver/trips/{b.leg_id}", headers=b.driver).json()
        assert trip["flight_status"] == fl.DELAYED

    # Süre dolunca ikisi birlikte vadesi gelir: yine tek sorgu, ikisi de güncel veriyi görür.
    fake.results["SU2130"] = [fl.FlightStatus(fl.LANDED, sched, sched + timedelta(minutes=38))]
    assert flight_tracking.refresh_flights(db, now + timedelta(minutes=50), fake) == 2
    assert _calls(fake, "SU2130") == once + 1
    db.expire_all()
    assert {x.status for x in db.query(FlightInfo).filter_by(flight_no="SU2130").all()} == {fl.LANDED}
