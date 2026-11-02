"""Karayolu mesafesi. Google Routes API'ye yalnızca koordinat gönderilir (fiyatlandirma.md)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.providers.polyline import encode


@dataclass(frozen=True)
class Point:
    lat: Decimal
    lng: Decimal


@dataclass(frozen=True)
class Route:
    distance_km: Decimal
    duration_minutes: int
    polyline: str | None = None


class RoutingProvider(Protocol):
    def route(self, origin: Point, destination: Point) -> Route: ...


def haversine_km(a: Point, b: Point) -> Decimal:
    r = 6371.0088
    lat1, lng1, lat2, lng2 = map(math.radians, map(float, (a.lat, a.lng, b.lat, b.lng)))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return Decimal(str(round(2 * r * math.asin(math.sqrt(h)), 2)))


@dataclass
class HaversineRouting:
    """Geliştirme yedeği: kuş uçuşu x yol katsayısı, ortalama 60 km/sa."""

    road_factor: Decimal

    def route(self, origin: Point, destination: Point) -> Route:
        km = (haversine_km(origin, destination) * self.road_factor).quantize(Decimal("0.01"))
        line = encode(
            [(float(origin.lat), float(origin.lng)), (float(destination.lat), float(destination.lng))]
        )
        return Route(distance_km=km, duration_minutes=max(1, int(km)), polyline=line)


@dataclass
class GoogleRouting:
    api_key: str
    url: str = "https://routes.googleapis.com/directions/v2:computeRoutes"

    def route(self, origin: Point, destination: Point) -> Route:
        def waypoint(p: Point) -> dict:
            return {"location": {"latLng": {"latitude": float(p.lat), "longitude": float(p.lng)}}}

        body = {
            "origin": waypoint(origin),
            "destination": waypoint(destination),
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_UNAWARE",
        }
        headers = {
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        }
        try:
            resp = httpx.post(self.url, json=body, headers=headers, timeout=10)
            resp.raise_for_status()
            routes = resp.json().get("routes") or []
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailable("mesafe hesaplanamadı") from exc
        if not routes:
            raise ServiceUnavailable("bu iki nokta arasında karayolu bulunamadı")
        meters = routes[0]["distanceMeters"]
        seconds = int(routes[0]["duration"].rstrip("s"))
        return Route(
            distance_km=(Decimal(meters) / 1000).quantize(Decimal("0.01")),
            duration_minutes=max(1, round(seconds / 60)),
            polyline=routes[0].get("polyline", {}).get("encodedPolyline"),
        )


@lru_cache
def get_routing() -> RoutingProvider:
    s = get_settings()
    if s.routing_provider == "google":
        return GoogleRouting(s.google_routes_api_key or s.google_maps_api_key)
    if s.routing_provider == "haversine":
        return HaversineRouting(s.haversine_road_factor)
    raise RuntimeError(f"desteklenmeyen rota sağlayıcısı: {s.routing_provider}")
