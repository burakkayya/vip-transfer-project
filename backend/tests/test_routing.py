from decimal import Decimal

import httpx

from app.providers.polyline import decode
from app.providers.routing import GoogleRouting, HaversineRouting, Point

A = Point(Decimal("36.8987"), Decimal("30.8005"))
B = Point(Decimal("36.6018"), Decimal("30.5594"))


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _patch_post(monkeypatch, payload, captured=None):
    def fake_post(url, json=None, headers=None, timeout=None):
        if captured is not None:
            captured["headers"] = headers
        return _Resp(payload)

    monkeypatch.setattr(httpx, "post", fake_post)


def test_haversine_route_has_two_point_polyline():
    r = HaversineRouting(Decimal("1.3")).route(A, B)
    pts = decode(r.polyline)
    assert len(pts) == 2
    assert pts[0] == (float(A.lat), float(A.lng))
    assert pts[1] == (float(B.lat), float(B.lng))


def test_google_route_parses_polyline(monkeypatch):
    captured = {}
    _patch_post(
        monkeypatch,
        {"routes": [{"distanceMeters": 12000, "duration": "900s", "polyline": {"encodedPolyline": "abc"}}]},
        captured,
    )
    r = GoogleRouting("key").route(A, B)
    assert r.polyline == "abc"
    assert "routes.polyline.encodedPolyline" in captured["headers"]["X-Goog-FieldMask"]


def test_google_route_without_polyline_is_none(monkeypatch):
    _patch_post(monkeypatch, {"routes": [{"distanceMeters": 12000, "duration": "900s"}]})
    r = GoogleRouting("key").route(A, B)
    assert r.polyline is None
    assert r.distance_km == Decimal("12.00")


def test_dev_and_prod_require_google_providers(monkeypatch):
    """Haritayla ilgili her şey Google: sahte adres ve kuş uçuşu rota yalnızca otomatik testlerde."""
    import pytest
    from pydantic import ValidationError

    from app.config import Settings

    monkeypatch.setenv("GETAWAY_ENV", "dev")
    with pytest.raises(ValidationError, match="Google olmalı"):
        Settings(places_provider="fake", routing_provider="haversine", google_maps_api_key="k")
    with pytest.raises(ValidationError, match="GOOGLE_MAPS_API_KEY"):
        Settings(places_provider="google", routing_provider="google", google_maps_api_key="")
    ok = Settings(places_provider="google", routing_provider="google", google_maps_api_key="k")
    assert ok.routing_provider == "google"


def test_google_route_is_cached_for_same_points(monkeypatch):
    calls = {"n": 0}

    def fake_post(url, json=None, headers=None, timeout=None):
        calls["n"] += 1
        return _Resp({"routes": [{"distanceMeters": 12000, "duration": "900s", "polyline": {"encodedPolyline": "abc"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    g = GoogleRouting("key")
    assert g.route(A, B).polyline == "abc"
    assert g.route(A, B).polyline == "abc"
    assert calls["n"] == 1
    g.route(B, A)
    assert calls["n"] == 2
