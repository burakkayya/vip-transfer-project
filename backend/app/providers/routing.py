"""Karayolu mesafesi. Google Routes API'ye yalnızca koordinat gönderilir (fiyatlandirma.md)."""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.providers.polyline import encode

log = logging.getLogger(__name__)


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


@dataclass
class OsrmRouting:
    """OpenStreetMap karayolu rotası (OSRM). Anahtar gerekmez; yalnızca koordinat gönderilir.
    Sunucuya ulaşılamazsa veya yol bulunamazsa haversine yedeğine düşer (rezervasyon akışı durmaz)."""

    base_url: str
    fallback: HaversineRouting
    # Teklif ekranı aynı rotayı araç tipi başına tekrar sorar: kısa süreli bellek önbelleği.
    _cache: dict = field(default_factory=dict)

    def route(self, origin: Point, destination: Point) -> Route:
        key = tuple(round(float(v), 5) for v in (origin.lat, origin.lng, destination.lat, destination.lng))
        hit = self._cache.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return hit[1]
        route = self._fetch(origin, destination)
        if route is None:
            return self.fallback.route(origin, destination)  # yedek önbelleğe alınmaz
        if len(self._cache) > 2000:
            self._cache.clear()
        self._cache[key] = (time.monotonic() + 600, route)
        return route

    def _fetch(self, origin: Point, destination: Point) -> Route | None:
        coords = f"{float(origin.lng):.6f},{float(origin.lat):.6f};{float(destination.lng):.6f},{float(destination.lat):.6f}"
        try:
            resp = httpx.get(f"{self.base_url.rstrip('/')}/route/v1/driving/{coords}",
                             params={"overview": "full", "geometries": "polyline"}, timeout=8,
                             headers={"User-Agent": "GetawayTransfers/1.0"})
            resp.raise_for_status()
            data = resp.json()
            best = (data.get("routes") or [None])[0]
            if data.get("code") != "Ok" or not best:
                raise ValueError(data.get("code"))
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("OSRM rotası alınamadı (%s), kuş uçuşu yedeği kullanılıyor", exc)
            return None
        km = (Decimal(str(best["distance"])) / 1000).quantize(Decimal("0.01"))
        return Route(distance_km=km, duration_minutes=max(1, round(float(best["duration"]) / 60)),
                     polyline=best.get("geometry"))


@lru_cache
def get_routing() -> RoutingProvider:
    s = get_settings()
    if s.routing_provider == "osrm":
        return OsrmRouting(s.osrm_url, HaversineRouting(s.haversine_road_factor))
    if s.routing_provider == "google":
        return GoogleRouting(s.google_routes_api_key or s.google_maps_api_key)
    if s.routing_provider == "haversine":
        return HaversineRouting(s.haversine_road_factor)
    raise RuntimeError(f"desteklenmeyen rota sağlayıcısı: {s.routing_provider}")
