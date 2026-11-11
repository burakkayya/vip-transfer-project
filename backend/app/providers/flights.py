"""Uçuş durumu (K-60). Sağlayıcı AeroDataBox (RapidAPI); dışarıya yalnızca uçuş numarası ve tarih gider.

Anahtar yoksa (`flight_provider=off`) uçuş takibi kapalıdır: rezervasyon ve yolculuk akışı etkilenmez,
yalnızca tahmini iniş saati gösterilmez. AeroDataBox verisi en fazla 7 gün saklanabilir; uçuş verisi
yolculuk tamamlanınca zaten silinir (K-31).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable

# AeroDataBox `status` alanından bizim kullandığımız sade durumlar.
SCHEDULED, DELAYED, DEPARTED, LANDED, CANCELLED, DIVERTED, UNKNOWN, NOT_FOUND = (
    "planlandi", "rotarli", "havada", "indi", "iptal", "yonlendirildi", "bilinmiyor", "bulunamadi",
)
_STATUS_MAP = {
    "Expected": SCHEDULED, "CheckIn": SCHEDULED, "Boarding": SCHEDULED, "GateClosed": SCHEDULED,
    "Delayed": DELAYED,
    "Departed": DEPARTED, "EnRoute": DEPARTED, "Approaching": DEPARTED,
    "Arrived": LANDED,
    "Canceled": CANCELLED,
    # Kesinleşmemiş iptal takibi durdurmaz ve bildirim göndermez.
    "CanceledUncertain": UNKNOWN,
    "Diverted": DIVERTED,
}
# Bu durumlardan sonra uçuş bir daha sorgulanmaz.
FINAL_STATUSES = frozenset({LANDED, CANCELLED, DIVERTED, NOT_FOUND})


@dataclass(frozen=True)
class FlightStatus:
    status: str
    scheduled_at: datetime | None  # planlanan iniş, UTC
    estimated_at: datetime | None  # pist / kapı / tahmini zaman, yoksa planlanan


class FlightProvider(Protocol):
    def arrivals(self, flight_no: str, day: date, airport_iata: str | None) -> list[FlightStatus]: ...


def _utc(node: object) -> datetime | None:
    if not isinstance(node, dict) or not node.get("utc"):
        return None
    raw = str(node["utc"]).strip().replace(" ", "T")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _arrival_iata(flight: dict) -> str:
    airport = flight["arrival"].get("airport")
    return str(airport.get("iata") or "").upper() if isinstance(airport, dict) else ""


def parse_arrivals(payload: object, airport_iata: str | None) -> list[FlightStatus]:
    """AeroDataBox yanıtındaki geliş seferleri. Varış havalimanı verildiyse yalnızca ona inenler döner
    (yanlış numara başka havalimanına inen bir uçuşun saatini sürücüye göstermesin)."""
    if not isinstance(payload, list):
        return []
    flights = [f for f in payload if isinstance(f, dict) and isinstance(f.get("arrival"), dict)]
    if airport_iata:
        flights = [f for f in flights if _arrival_iata(f) == airport_iata.upper()]
    out = []
    for flight in flights:
        arr = flight["arrival"]
        scheduled = _utc(arr.get("scheduledTime"))
        estimated = (_utc(arr.get("runwayTime")) or _utc(arr.get("revisedTime"))
                     or _utc(arr.get("predictedTime")) or scheduled)
        status = _STATUS_MAP.get(str(flight.get("status") or ""), UNKNOWN)
        # Kalkmamış uçuşta 15 dk ve üzeri kayma rötar sayılır (havadaki uçuş "havada" kalır, saat yine görünür).
        if status in (SCHEDULED, UNKNOWN) and scheduled and estimated and (estimated - scheduled).total_seconds() >= 15 * 60:
            status = DELAYED
        out.append(FlightStatus(status=status, scheduled_at=scheduled, estimated_at=estimated))
    return out


@dataclass
class AeroDataBox:
    api_key: str
    url: str = "https://aerodatabox.p.rapidapi.com/flights/number/{number}/{day}"
    host: str = "aerodatabox.p.rapidapi.com"

    def arrivals(self, flight_no: str, day: date, airport_iata: str | None) -> list[FlightStatus]:
        headers = {"X-RapidAPI-Key": self.api_key, "X-RapidAPI-Host": self.host}
        params = {"dateLocalRole": "Arrival", "withAircraftImage": "false", "withLocation": "false"}
        try:
            resp = httpx.get(self.url.format(number=flight_no, day=day.isoformat()),
                             headers=headers, params=params, timeout=10)
            if resp.status_code in (204, 404):
                return []  # uçuş bulunamadı
            resp.raise_for_status()
            return parse_arrivals(resp.json(), airport_iata)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise ServiceUnavailable("uçuş durumu alınamadı") from exc


@dataclass
class FakeFlights:
    """Yalnızca otomatik testler: sonuçlar uçuş numarası ve tarihe göre elle konur."""

    results: dict[str, list[FlightStatus]]
    calls: list[tuple[str, date]] = field(default_factory=list)
    fail: bool = False

    def arrivals(self, flight_no: str, day: date, airport_iata: str | None) -> list[FlightStatus]:
        self.calls.append((flight_no, day))
        if self.fail:
            raise RuntimeError("beklenmeyen hata")
        return list(self.results.get(f"{flight_no}@{day.isoformat()}", self.results.get(flight_no, [])))


@lru_cache
def get_flights() -> FlightProvider | None:
    s = get_settings()
    if s.flight_provider == "aerodatabox":
        if not s.aerodatabox_api_key:
            raise RuntimeError("GETAWAY_AERODATABOX_API_KEY tanımlı değil")
        return AeroDataBox(s.aerodatabox_api_key)
    return None
