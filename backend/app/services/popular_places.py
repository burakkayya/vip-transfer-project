"""Popüler yerler (K-61): adres aramasında önce kendi listemiz, sonra ücretli arama.

Kimlik `pp-{id}` biçimindedir; bu kimlikle gelen ayrıntı isteği veritabanından yanıtlanır ve fiyat
jetonu Google'a gidilmeden üretilir. Bölge listede kayıtlıdır, yeniden çözülmez.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import NotFound
from app.models import PopularPlace, Region
from app.providers.places import PlaceDetails, Suggestion, normalize

PREFIX = "pp-"
MAX_LOCAL = 5


def search_text(name: str, subtitle: str) -> str:
    return normalize(f"{name} {subtitle}")[:400]


def search(db: Session, query: str) -> list[PopularPlace]:
    tokens = [t for t in normalize(query).split() if t]
    if not tokens:
        return []
    stmt = (select(PopularPlace).join(Region, PopularPlace.region_id == Region.id)
            .where(PopularPlace.is_active.is_(True), Region.is_active.is_(True)))
    for token in tokens[:6]:
        stmt = stmt.where(PopularPlace.search_text.contains(token, autoescape=True))
    rows = list(db.scalars(stmt.order_by(PopularPlace.name).limit(40)))
    # Adı sorguyla başlayanlar öne gelir ("rix" → "Rixos ..." önce, açıklamasında geçenler sonra).
    first = tokens[0]
    rows.sort(key=lambda p: (not normalize(p.name).startswith(first), p.name))
    return rows[:MAX_LOCAL]


def suggestion(place: PopularPlace) -> Suggestion:
    return Suggestion(place_id=f"{PREFIX}{place.id}", title=place.name, subtitle=place.subtitle)


def is_local(place_id: str) -> bool:
    return place_id.startswith(PREFIX)


def details(db: Session, place_id: str) -> tuple[Region, PlaceDetails]:
    try:
        place = db.get(PopularPlace, int(place_id[len(PREFIX):]))
    except ValueError:
        place = None
    if place is None or not place.is_active or not place.region.is_active:
        raise NotFound("adres bulunamadı", code="place_not_found")
    address = f"{place.name}, {place.subtitle}" if place.subtitle else place.name
    return place.region, PlaceDetails(place_id=place_id, address=address, lat=place.latitude, lng=place.longitude,
                                      district=None, province=None, is_airport=False)
