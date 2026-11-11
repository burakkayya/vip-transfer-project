"""Admin: popüler yerler ve ücretli API kullanım özeti (K-61).

Popüler yer listesi bize aittir: admin adı, açıklamayı ve konumu girer ya da müşterilerin sık seçtiği
bir adresi tek tıkla listeye alır. Listedeki yerler adres aramasında ücretli servise gidilmeden önerilir.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import ClientIp, DbSession, Now, OpsStaff
from app.errors import DomainError, NotFound
from app.localtime import local_date
from app.models import PopularPlace, Region
from app.providers.places import get_places
from app.services import api_cache, audit, places, popular_places
from app.services.places import valid_session

router = APIRouter(tags=["admin:popular-places"])


class PopularPlaceIn(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    subtitle: str = Field(default="", max_length=200)
    region_id: int
    latitude: Decimal = Field(ge=35, le=39)
    longitude: Decimal = Field(ge=26, le=34)
    google_place_id: str | None = Field(default=None, max_length=300)
    is_active: bool = True


class PromoteIn(BaseModel):
    place_id: str = Field(min_length=3, max_length=300)
    name: str = Field(min_length=2, max_length=150)
    subtitle: str = Field(default="", max_length=200)


class DismissIn(BaseModel):
    place_id: str = Field(min_length=3, max_length=300)


def _out(p: PopularPlace) -> dict:
    return {
        "id": p.id, "name": p.name, "subtitle": p.subtitle, "region_id": p.region_id,
        "region_name": p.region.name, "latitude": str(p.latitude), "longitude": str(p.longitude),
        "google_place_id": p.google_place_id, "is_active": p.is_active,
    }


def _clean(body: PopularPlaceIn) -> dict:
    data = body.model_dump()
    data["name"] = data["name"].strip()
    data["subtitle"] = data["subtitle"].strip()
    data["google_place_id"] = (data["google_place_id"] or "").strip() or None
    return data


def _check(db, data: dict, own_id: int | None = None) -> None:
    if db.get(Region, data["region_id"]) is None:
        raise NotFound("bölge bulunamadı")
    if data["google_place_id"]:
        other = db.scalar(select(PopularPlace).where(PopularPlace.google_place_id == data["google_place_id"]))
        if other is not None and other.id != own_id:
            raise DomainError("bu yer listede zaten var", code="popular_place_exists")


@router.get("/popular-places")
def list_popular_places(staff: OpsStaff, db: DbSession):
    rows = db.scalars(select(PopularPlace).order_by(PopularPlace.is_active.desc(), PopularPlace.name))
    return [_out(p) for p in rows]


@router.post("/popular-places", status_code=201)
def create_popular_place(body: PopularPlaceIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    data = _clean(body)
    _check(db, data)
    p = PopularPlace(**data, search_text=popular_places.search_text(data["name"], data["subtitle"]))
    db.add(p)
    db.flush()
    audit.record(db, actor_id=staff.id, action="popular_place.create", entity_type="popular_place", entity_id=p.id,
                 changes=body.model_dump(mode="json"), ip=ip)
    db.commit()
    if p.google_place_id:
        api_cache.drop_pick(p.google_place_id)
    return _out(p)


@router.put("/popular-places/{place_id}")
def update_popular_place(place_id: int, body: PopularPlaceIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    p = db.get(PopularPlace, place_id)
    if p is None:
        raise NotFound("yer bulunamadı")
    data = _clean(body)
    _check(db, data, own_id=p.id)
    old = _out(p)
    for k, v in data.items():
        setattr(p, k, v)
    p.search_text = popular_places.search_text(p.name, p.subtitle)
    audit.record(db, actor_id=staff.id, action="popular_place.update", entity_type="popular_place", entity_id=p.id,
                 changes={"old": old, "new": body.model_dump(mode="json")}, ip=ip)
    db.commit()
    db.refresh(p)
    return _out(p)


@router.get("/popular-places/candidates")
def list_candidates(staff: OpsStaff, db: DbSession):
    """Müşterilerin ücretli aramadan en çok seçtiği adresler (listeye alınmamış olanlar)."""
    known = set(db.scalars(select(PopularPlace.google_place_id).where(PopularPlace.google_place_id.is_not(None))))
    return [{"place_id": pid, "picks": picks, "label": label}
            for pid, picks, label in api_cache.top_picks(40) if pid not in known][:25]


@router.post("/popular-places/promote", status_code=201)
def promote_candidate(body: PromoteIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    """Adayı listeye alır: konum ve bölge adres servisinden bir kez çözülür, ad ve açıklamayı admin yazar."""
    data = {"google_place_id": body.place_id}
    if db.scalar(select(PopularPlace).where(PopularPlace.google_place_id == body.place_id)) is not None:
        raise DomainError("bu yer listede zaten var", code="popular_place_exists")
    detail = get_places().details(body.place_id, valid_session(None), "tr")
    region = places.resolve_region(db, detail)
    name, subtitle = body.name.strip(), body.subtitle.strip()
    p = PopularPlace(name=name, subtitle=subtitle, search_text=popular_places.search_text(name, subtitle),
                     region_id=region.id, latitude=detail.lat, longitude=detail.lng, **data)
    db.add(p)
    db.flush()
    audit.record(db, actor_id=staff.id, action="popular_place.promote", entity_type="popular_place", entity_id=p.id,
                 changes=body.model_dump(), ip=ip)
    db.commit()
    api_cache.drop_pick(body.place_id)
    return _out(p)


@router.post("/popular-places/candidates/dismiss", status_code=204)
def dismiss_candidate(body: DismissIn, staff: OpsStaff):
    api_cache.drop_pick(body.place_id)


_USAGE_GROUPS = {
    "routes": ("routes_call", "routes_hit", None),
    "places_autocomplete": ("places_ac_call", "places_ac_hit", "places_ac_local"),
    "places_details": ("places_det_call", "places_det_hit", "places_det_local"),
    "flights": ("flights_call", "flights_hit", None),
}


@router.get("/api-usage")
def api_usage(staff: OpsStaff, now: Now, days: Annotated[int, Query(ge=1, le=31)] = 7):
    """Günlük ücretli çağrı sayısı ile önbellekten ve kendi listemizden karşılanan istek sayısı."""
    today = local_date(now)
    out = []
    for back in range(days):
        day = today - timedelta(days=back)
        raw = api_cache.stats(day.isoformat())
        row: dict = {"day": day.isoformat()}
        for group, (call, hit, local) in _USAGE_GROUPS.items():
            row[group] = {"paid": raw.get(call, 0), "cached": raw.get(hit, 0),
                          "local": raw.get(local, 0) if local else 0}
        out.append(row)
    return out
