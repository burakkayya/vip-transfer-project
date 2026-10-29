"""Adresten hizmet bölgesine (ilçe veya havalimanı) geçiş ve imzalı adres jetonu.

Fiyat, adresin bağlı olduğu ilçeye göre hesaplanır (fiyatlandirma.md). İstemci ilçe
seçimini değiştirip fiyatı düşüremesin diye backend, çözümlediği bölge ve koordinatı
imzalı bir jetonla döner; fiyat teklifinde bu jeton kullanılır.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from functools import lru_cache

import jwt
import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import DomainError, NotFound, TooManyRequests
from app.models import Region
from app.models.enums import RegionType
from app.providers.places import PlaceDetails, normalize
from app.providers.routing import Point, haversine_km

PROVINCES = {"antalya": "antalya", "mugla": "mugla"}
# Havalimanı olarak işaretlenen yerin havalimanı bölgesine en fazla uzaklığı.
AIRPORT_MATCH_KM = Decimal("8")
TOKEN_TYPE = "place"


@dataclass(frozen=True)
class ResolvedPlace:
    region: Region
    lat: Decimal
    lng: Decimal
    address: str


def resolve_region(db: Session, place: PlaceDetails) -> Region:
    """Önce havalimanı, sonra ilçe adı eşleşmesi, en son en yakın ilçe merkezi."""
    province = PROVINCES.get(normalize(place.province or ""))
    if place.province and province is None:
        raise NotFound("bu adres hizmet alanımızın dışında", code="region_not_served")
    regions = list(db.scalars(select(Region).where(Region.is_active.is_(True))))
    point = Point(place.lat, place.lng)

    def dist(r: Region) -> Decimal:
        return haversine_km(point, Point(r.latitude, r.longitude))

    if place.is_airport:
        airports = sorted((r for r in regions if r.type is RegionType.AIRPORT), key=dist)
        if airports and dist(airports[0]) <= AIRPORT_MATCH_KM:
            return airports[0]

    districts = [r for r in regions if r.type is RegionType.DISTRICT and (province is None or r.province == province)]
    if place.district:
        wanted = normalize(place.district).removesuffix(" merkez")
        match = next((r for r in districts if normalize(r.name) == wanted), None)
        if match:
            return match

    nearest = min(districts, key=dist, default=None)
    if nearest is None or dist(nearest) > get_settings().region_max_radius_km:
        raise NotFound("bu adres hizmet alanımızın dışında", code="region_not_served")
    return nearest


def issue_token(region: Region, place: PlaceDetails) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "typ": TOKEN_TYPE,
        "rid": region.id,
        "lat": str(place.lat),
        "lng": str(place.lng),
        "adr": place.address[:300],
        "iat": now,
        "exp": now + timedelta(hours=s.place_token_hours),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def read_token(db: Session, token: str) -> ResolvedPlace:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise DomainError("adres seçimi geçersiz veya süresi dolmuş, adresi yeniden seçin",
                          code="place_token_invalid") from exc
    if payload.get("typ") != TOKEN_TYPE:
        raise DomainError("adres seçimi geçersiz", code="place_token_invalid")
    region = db.get(Region, int(payload["rid"]))
    if region is None or not region.is_active:
        raise NotFound("bölge hizmet alanında değil", code="region_not_served")
    return ResolvedPlace(region=region, lat=Decimal(payload["lat"]), lng=Decimal(payload["lng"]),
                         address=payload["adr"])


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url)


def check_rate_limit(ip: str) -> None:
    """Adres araması ücretli API'ye gider; IP başına dakikalık sınır."""
    key = f"places_rl:{ip}:{datetime.now(timezone.utc):%Y%m%d%H%M}"
    count = _redis().incr(key)
    if count == 1:
        _redis().expire(key, 70)
    if count > get_settings().places_rate_limit_per_minute:
        raise TooManyRequests("çok fazla adres araması, lütfen biraz bekleyin")


def valid_session(session: str | None) -> str:
    """Google oturum jetonu (autocomplete + details tek oturum ücretlendirilir)."""
    try:
        return str(uuid.UUID(session)) if session else str(uuid.uuid4())
    except ValueError:
        return str(uuid.uuid4())
