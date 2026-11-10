"""Adres arama ve adres ayrıntısı (Google Places API New).

Arama istekleri backend üzerinden gider: API anahtarı istemciye verilmez, sorgu
yalnızca Antalya ve Muğla ile sınırlanır, IP başına hız sınırı uygulanır.
Google'a yalnızca kullanıcının yazdığı adres metni gider; kimlik bilgisi gönderilmez.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import NotFound, ServiceUnavailable

# Antalya ve Muğla'yı kapsayan dikdörtgen (aramayı hizmet alanıyla sınırlar).
SERVICE_BOUNDS = {"low": {"latitude": 36.0, "longitude": 27.2}, "high": {"latitude": 37.65, "longitude": 32.75}}


@dataclass(frozen=True)
class Suggestion:
    place_id: str
    title: str
    subtitle: str


@dataclass(frozen=True)
class PlaceDetails:
    place_id: str
    address: str
    lat: Decimal
    lng: Decimal
    district: str | None  # ilçe (administrative_area_level_2)
    province: str | None  # il (administrative_area_level_1)
    is_airport: bool


class PlacesProvider(Protocol):
    def autocomplete(self, query: str, session: str, language: str) -> list[Suggestion]: ...
    def details(self, place_id: str, session: str, language: str) -> PlaceDetails: ...


def normalize(text: str) -> str:
    """Türkçe karakterleri sadeleştirir: "Muğla" → "mugla", "Kaş" → "kas"."""
    text = text.replace("ı", "i").replace("İ", "i")
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c)).casefold().strip()


@dataclass
class GooglePlaces:
    api_key: str
    base_url: str = "https://places.googleapis.com/v1"

    def _headers(self, field_mask: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": field_mask}

    def autocomplete(self, query: str, session: str, language: str) -> list[Suggestion]:
        body = {
            "input": query,
            "sessionToken": session,
            "languageCode": language,
            "includedRegionCodes": ["tr"],
            "locationRestriction": {"rectangle": SERVICE_BOUNDS},
        }
        try:
            resp = httpx.post(f"{self.base_url}/places:autocomplete", json=body, timeout=8,
                              headers=self._headers("suggestions.placePrediction.placeId,"
                                                    "suggestions.placePrediction.structuredFormat"))
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceUnavailable("adres araması şu an yapılamıyor") from exc
        out = []
        for s in resp.json().get("suggestions", []):
            p = s.get("placePrediction")
            if not p:
                continue
            fmt = p.get("structuredFormat", {})
            out.append(Suggestion(place_id=p["placeId"], title=fmt.get("mainText", {}).get("text", ""),
                                  subtitle=fmt.get("secondaryText", {}).get("text", "")))
        return out

    def details(self, place_id: str, session: str, language: str) -> PlaceDetails:
        try:
            resp = httpx.get(f"{self.base_url}/places/{place_id}", timeout=8,
                             params={"sessionToken": session, "languageCode": language},
                             headers=self._headers("id,formattedAddress,location,addressComponents,types"))
        except httpx.HTTPError as exc:
            raise ServiceUnavailable("adres ayrıntısı alınamadı") from exc
        if resp.status_code in (400, 404):
            raise NotFound("adres bulunamadı", code="place_not_found")
        if resp.status_code >= 300:
            raise ServiceUnavailable("adres ayrıntısı alınamadı")
        data = resp.json()
        comps = data.get("addressComponents", [])

        def component(kind: str) -> str | None:
            return next((c.get("longText") for c in comps if kind in c.get("types", [])), None)

        loc = data.get("location") or {}
        if "latitude" not in loc:
            raise NotFound("adresin konumu yok", code="place_not_found")
        return PlaceDetails(
            place_id=data.get("id", place_id),
            address=data.get("formattedAddress", ""),
            lat=Decimal(str(loc["latitude"])),
            lng=Decimal(str(loc["longitude"])),
            district=component("administrative_area_level_2"),
            province=component("administrative_area_level_1"),
            is_airport="airport" in data.get("types", []),
        )


# Geliştirme: Google anahtarı olmadan adres akışını denemek için örnek yerler.
# (kimlik, başlık, açıklama, enlem, boylam, ilçe, il, havalimanı mı)
_FAKE_PLACES: list[tuple[str, str, str, str, str, str, str, bool]] = [
    ("fake-ayt", "Antalya Havalimanı (AYT)", "Muratpaşa, Antalya", "36.8987", "30.8005", "Muratpaşa", "Antalya", True),
    ("fake-gzp", "Gazipaşa-Alanya Havalimanı (GZP)", "Gazipaşa, Antalya", "36.2992", "32.3006", "Gazipaşa", "Antalya", True),
    ("fake-dlm", "Dalaman Havalimanı (DLM)", "Dalaman, Muğla", "36.7131", "28.7925", "Dalaman", "Muğla", True),
    ("fake-bjv", "Milas-Bodrum Havalimanı (BJV)", "Milas, Muğla", "37.2506", "27.6643", "Milas", "Muğla", True),
    ("fake-rixos-dt", "Rixos Downtown Antalya", "Sakıp Sabancı Blv., Konyaaltı, Antalya", "36.8840", "30.6680", "Konyaaltı", "Antalya", False),
    ("fake-kaleici", "Kaleiçi", "Muratpaşa, Antalya", "36.8841", "30.7056", "Muratpaşa", "Antalya", False),
    ("fake-lara", "Lara Plajı Otelleri", "Güzeloba, Muratpaşa, Antalya", "36.8515", "30.8530", "Muratpaşa", "Antalya", False),
    ("fake-belek", "Belek Turizm Merkezi", "Belek, Serik, Antalya", "36.8627", "31.0556", "Serik", "Antalya", False),
    ("fake-side", "Side Antik Kenti", "Side, Manavgat, Antalya", "36.7675", "31.3890", "Manavgat", "Antalya", False),
    ("fake-alanya", "Kleopatra Plajı", "Saray, Alanya, Antalya", "36.5470", "31.9800", "Alanya", "Antalya", False),
    ("fake-kemer", "Kemer Marina", "Kemer, Antalya", "36.6020", "30.5660", "Kemer", "Antalya", False),
    ("fake-kas", "Kaş Merkez", "Kaş, Antalya", "36.2020", "29.6380", "Kaş", "Antalya", False),
    ("fake-kalkan", "Kalkan", "Kaş, Antalya", "36.2660", "29.4140", "Kaş", "Antalya", False),
    ("fake-bodrum", "Bodrum Marina", "Bodrum, Muğla", "37.0340", "27.4260", "Bodrum", "Muğla", False),
    ("fake-turgutreis", "Turgutreis", "Bodrum, Muğla", "37.0050", "27.2580", "Bodrum", "Muğla", False),
    ("fake-oludeniz", "Ölüdeniz", "Fethiye, Muğla", "36.5490", "29.1150", "Fethiye", "Muğla", False),
    ("fake-fethiye", "Fethiye Marina", "Fethiye, Muğla", "36.6230", "29.1050", "Fethiye", "Muğla", False),
    ("fake-marmaris", "Marmaris Netsel Marina", "Marmaris, Muğla", "36.8530", "28.2740", "Marmaris", "Muğla", False),
    ("fake-dalyan", "Dalyan", "Ortaca, Muğla", "36.8340", "28.6420", "Ortaca", "Muğla", False),
    ("fake-gocek", "Göcek", "Fethiye, Muğla", "36.7530", "28.9400", "Fethiye", "Muğla", False),
    ("fake-istanbul", "Taksim Meydanı", "Beyoğlu, İstanbul", "41.0370", "28.9850", "Beyoğlu", "İstanbul", False),
]


@dataclass
class FakePlaces:
    def autocomplete(self, query: str, session: str, language: str) -> list[Suggestion]:
        q = normalize(query)
        return [
            Suggestion(place_id=p[0], title=p[1], subtitle=p[2])
            for p in _FAKE_PLACES
            if q in normalize(p[1]) or q in normalize(p[2])
        ][:8]

    def details(self, place_id: str, session: str, language: str) -> PlaceDetails:
        p = next((p for p in _FAKE_PLACES if p[0] == place_id), None)
        if p is None:
            raise NotFound("adres bulunamadı", code="place_not_found")
        return PlaceDetails(place_id=p[0], address=f"{p[1]}, {p[2]}", lat=Decimal(p[3]), lng=Decimal(p[4]),
                            district=p[5], province=p[6], is_airport=p[7])


# Photon'un "osm_key/osm_value" çiftlerinden havalimanı sayılanlar.
_AIRPORT_TAGS = {("aeroway", "aerodrome"), ("aeroway", "terminal")}
_PHOTON_TTL_S = 6 * 3600


@dataclass
class PhotonPlaces:
    """OpenStreetMap adres araması (Photon, K-58). Anahtar gerekmez; yalnızca yazılan metin gider.

    Otel, cadde, mahalle, kapı numarası ve yer adları aranabilir; sonuçlar hizmet alanıyla (Antalya,
    Muğla) sınırlanır. Photon'da kimlikle ayrıntı sorgusu olmadığından arama sonucu Redis'te
    6 saat saklanır; ayrıntı oradan okunur (istemcinin gönderdiği koordinata güvenilmez).
    """

    base_url: str
    redis_url: str

    def _redis(self):
        import redis

        return redis.Redis.from_url(self.redis_url)

    @staticmethod
    def _parse(feature: dict) -> tuple[Suggestion, PlaceDetails] | None:
        p = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) != 2 or p.get("countrycode", "").upper() != "TR" or not p.get("osm_id"):
            return None
        street = " ".join(x for x in (p.get("street"), p.get("housenumber")) if x)
        title = p.get("name") or street
        if not title:
            return None
        district = p.get("county") or p.get("city")
        province = p.get("state")
        locality = p.get("district") or p.get("locality") or p.get("city")
        parts = [x for x in (street if p.get("name") else None, locality, district, province) if x]
        subtitle = ", ".join(dict.fromkeys(parts))  # tekrarları at, sırayı koru
        place_id = f"osm:{p.get('osm_type', 'N')}{p['osm_id']}"
        details = PlaceDetails(
            place_id=place_id,
            address=", ".join(x for x in (title, subtitle) if x),
            lat=Decimal(str(coords[1])),
            lng=Decimal(str(coords[0])),
            district=district,
            province=province,
            is_airport=(p.get("osm_key"), p.get("osm_value")) in _AIRPORT_TAGS,
        )
        return Suggestion(place_id=place_id, title=title, subtitle=subtitle), details

    def autocomplete(self, query: str, session: str, language: str) -> list[Suggestion]:
        b = SERVICE_BOUNDS
        params = {
            "q": query, "limit": 10, "lang": "default",
            "bbox": f"{b['low']['longitude']},{b['low']['latitude']},{b['high']['longitude']},{b['high']['latitude']}",
            # Antalya merkezine yakın sonuçlar öne çıkar.
            "lat": 36.9, "lon": 30.7,
        }
        try:
            resp = httpx.get(f"{self.base_url.rstrip('/')}/api/", params=params, timeout=8,
                             headers={"User-Agent": "GetawayTransfers/1.0"})
            resp.raise_for_status()
            features = resp.json().get("features") or []
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailable("adres araması şu an yapılamıyor") from exc
        out: list[Suggestion] = []
        seen: set[tuple[str, str]] = set()
        cache = self._redis()
        for f in features:
            parsed = self._parse(f)
            if parsed is None:
                continue
            sug, det = parsed
            if (sug.title, sug.subtitle) in seen:
                continue
            seen.add((sug.title, sug.subtitle))
            cache.setex(f"places:osm:{sug.place_id}", _PHOTON_TTL_S, json.dumps({
                "address": det.address, "lat": str(det.lat), "lng": str(det.lng), "district": det.district,
                "province": det.province, "is_airport": det.is_airport}))
            out.append(sug)
        return out[:8]

    def details(self, place_id: str, session: str, language: str) -> PlaceDetails:
        raw = self._redis().get(f"places:osm:{place_id}")
        if raw is None:
            raise NotFound("adres seçimi zaman aşımına uğradı, adresi yeniden arayın", code="place_not_found")
        d = json.loads(raw)
        return PlaceDetails(place_id=place_id, address=d["address"], lat=Decimal(d["lat"]), lng=Decimal(d["lng"]),
                            district=d["district"], province=d["province"], is_airport=bool(d["is_airport"]))


@lru_cache
def get_places() -> PlacesProvider:
    s = get_settings()
    if s.places_provider == "photon":
        return PhotonPlaces(s.photon_url, s.redis_url)
    if s.places_provider == "google":
        if not s.google_maps_api_key:
            raise RuntimeError("GETAWAY_GOOGLE_MAPS_API_KEY tanımlı değil")
        return GooglePlaces(s.google_maps_api_key)
    if s.places_provider == "fake":
        return FakePlaces()
    raise RuntimeError(f"desteklenmeyen adres sağlayıcısı: {s.places_provider}")
