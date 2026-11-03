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
