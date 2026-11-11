"""Admin: popüler yerler ve ücretli API kullanım özeti (K-61).

Popüler yer listesi bize aittir: admin adı, açıklamayı ve konumu girer ya da müşterilerin sık seçtiği
bir adresi tek tıkla listeye alır. Listedeki yerler adres aramasında ücretli servise gidilmeden önerilir.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import ClientIp, DbSession, Now, OpsStaff
from app.config import get_settings
from app.errors import DomainError, NotFound
from app.localtime import local_date
from app.models import PopularPlace, Region
from app.models.enums import RegionType
from app.providers.places import get_places
from app.providers.routing import Point, haversine_km
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
    # Admin konumu kendisi girerse o kullanılır; boşsa adres servisinden bir kez alınır.
    latitude: Decimal | None = Field(default=None, ge=35, le=39)
    longitude: Decimal | None = Field(default=None, ge=26, le=34)


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


_EXISTS = DomainError("bu yer listede zaten var", code="popular_place_exists")
# Seçilen bölgenin merkezi, konuma en yakın ilçe merkezinden belirgin biçimde uzaksa bölge yanlıştır.
_REGION_SLACK_KM = Decimal("10")


def _check_region(db, region_id: int, lat: Decimal, lng: Decimal) -> None:
    """Fiyat ilçeye göre hesaplanır (K-28): yer yanlış ilçeye bağlanırsa müşteri yanlış fiyat görür."""
    region = db.get(Region, region_id)
    if region is None:
        raise NotFound("bölge bulunamadı")
    if not region.is_active or region.type is not RegionType.DISTRICT:
        raise DomainError("popüler yer yalnızca aktif bir ilçeye bağlanabilir", code="popular_place_region_invalid")
    point = Point(lat, lng)
    districts = db.scalars(select(Region).where(Region.is_active.is_(True), Region.type == RegionType.DISTRICT))
    nearest = min(districts, key=lambda r: haversine_km(point, Point(r.latitude, r.longitude)))
    own = haversine_km(point, Point(region.latitude, region.longitude))
    best = haversine_km(point, Point(nearest.latitude, nearest.longitude))
    if own > get_settings().region_max_radius_km or own > best * 2 + _REGION_SLACK_KM:
        raise DomainError(
            f"konum seçilen bölgeyle uyuşmuyor: {region.name} merkezine {own} km, en yakın ilçe {nearest.name}",
            code="popular_place_region_mismatch",
        )


def _flush(db) -> None:
    """Aynı yer eşzamanlı iki kez eklenirse benzersizlik kısıtı 500 yerine anlaşılır hataya çevrilir."""
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _EXISTS from None


def _check(db, data: dict, own_id: int | None = None) -> None:
    _check_region(db, data["region_id"], data["latitude"], data["longitude"])
    if data["google_place_id"]:
        other = db.scalar(select(PopularPlace).where(PopularPlace.google_place_id == data["google_place_id"]))
        if other is not None and other.id != own_id:
            raise _EXISTS


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
    _flush(db)
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
    _flush(db)
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
            for pid, picks, label in api_cache.top_picks(40, get_settings().popular_candidate_min_picks)
            if pid not in known][:25]


@router.post("/popular-places/promote", status_code=201)
def promote_candidate(body: PromoteIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    """Adayı listeye alır: ad ve açıklamayı admin yazar. Konumu admin girerse o kullanılır ve bölge konuma
    göre belirlenir; girmezse konum ve bölge adres servisinden bir kez çözülür."""
    data = {"google_place_id": body.place_id}
    if db.scalar(select(PopularPlace).where(PopularPlace.google_place_id == body.place_id)) is not None:
        raise _EXISTS
    detail = get_places().details(body.place_id, valid_session(None), "tr")
    if body.latitude is not None and body.longitude is not None:
        detail = replace(detail, lat=body.latitude, lng=body.longitude)
    region = places.resolve_region(db, detail)
    if region.type is not RegionType.DISTRICT:
        raise DomainError("havalimanı popüler yer olarak eklenemez", code="popular_place_region_invalid")
    name, subtitle = body.name.strip(), body.subtitle.strip()
    p = PopularPlace(name=name, subtitle=subtitle, search_text=popular_places.search_text(name, subtitle),
                     region_id=region.id, latitude=detail.lat, longitude=detail.lng, **data)
    db.add(p)
    _flush(db)
    audit.record(db, actor_id=staff.id, action="popular_place.promote", entity_type="popular_place", entity_id=p.id,
                 changes=body.model_dump(mode="json"), ip=ip)
    db.commit()
    api_cache.drop_pick(body.place_id)
    return _out(p)


@router.post("/popular-places/candidates/dismiss", status_code=204)
def dismiss_candidate(body: DismissIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    api_cache.drop_pick(body.place_id)
    audit.record(db, actor_id=staff.id, action="popular_place.dismiss_candidate", entity_type="popular_place",
                 entity_id=None, changes=body.model_dump(), ip=ip)
    db.commit()


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
