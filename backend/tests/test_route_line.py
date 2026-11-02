import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.errors import ServiceUnavailable
from app.providers.polyline import decode
from app.providers.routing import Route
from app.services import route_line


def _region(lat, lng):
    return SimpleNamespace(latitude=Decimal(lat), longitude=Decimal(lng))


def _leg(**kw):
    base = dict(
        id=uuid.uuid4(),
        pickup_lat=Decimal("36.898700"),
        pickup_lng=Decimal("30.800500"),
        dropoff_lat=Decimal("36.601800"),
        dropoff_lng=Decimal("30.559400"),
        pickup_region=_region("36.9000", "30.8000"),
        dropoff_region=_region("36.6000", "30.5600"),
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def redis_cleanup():
    leg_ids = []
    yield leg_ids
    r = route_line._redis()
    for leg_id in leg_ids:
        r.delete(route_line._key(leg_id))


class _CountingProvider:
    def __init__(self, error=False):
        self.calls = []
        self.error = error

    def route(self, origin, destination):
        self.calls.append((origin, destination))
        if self.error:
            raise ServiceUnavailable("yok")
        return Route(distance_km=Decimal("1"), duration_minutes=1, polyline="abc_poly")


def test_route_polyline_cached(monkeypatch, redis_cleanup):
    provider = _CountingProvider()
    monkeypatch.setattr(route_line, "get_routing", lambda: provider)
    leg = _leg()
    redis_cleanup.append(leg.id)
    assert route_line.route_polyline(leg) == "abc_poly"
    assert route_line.route_polyline(leg) == "abc_poly"
    assert len(provider.calls) == 1
    ttl = route_line._redis().ttl(f"route_line:{leg.id}")
    assert 0 < ttl <= 86400


def test_route_polyline_falls_back_to_region_centers(monkeypatch, redis_cleanup):
    provider = _CountingProvider()
    monkeypatch.setattr(route_line, "get_routing", lambda: provider)
    leg = _leg(pickup_lat=None, pickup_lng=None, dropoff_lat=None, dropoff_lng=None)
    redis_cleanup.append(leg.id)
    assert route_line.route_polyline(leg) == "abc_poly"
    origin, destination = provider.calls[0]
    assert (origin.lat, origin.lng) == (Decimal("36.9000"), Decimal("30.8000"))
    assert (destination.lat, destination.lng) == (Decimal("36.6000"), Decimal("30.5600"))


def test_route_polyline_uses_haversine_provider_and_decodes(redis_cleanup):
    leg = _leg()
    redis_cleanup.append(leg.id)
    pts = decode(route_line.route_polyline(leg))
    assert len(pts) == 2


def test_route_polyline_provider_error_returns_none(monkeypatch, redis_cleanup):
    provider = _CountingProvider(error=True)
    monkeypatch.setattr(route_line, "get_routing", lambda: provider)
    leg = _leg()
    redis_cleanup.append(leg.id)
    assert route_line.route_polyline(leg) is None
    assert route_line._redis().get(f"route_line:{leg.id}") is None
