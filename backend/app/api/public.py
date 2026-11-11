"""Girişsiz uçlar: bölge ve araç tipi listesi, fiyat hesaplama (ekran 2)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ClientIp, DbSession, Now
from app.api.schemas import (
    PlaceIn,
    PlaceOut,
    PlaceSuggestionOut,
    QuoteIn,
    QuoteLegOut,
    QuoteOut,
    RegionOut,
    RoutePreviewIn,
    RoutePreviewOut,
    VehicleTypeOut,
    _locale,
)
from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models import Region, VehicleType
from app.providers.places import get_places
from app.providers.routing import get_routing
from app.services import api_cache, places, popular_places, quotes

router = APIRouter(tags=["public"])


@router.get("/regions", response_model=list[RegionOut])
def list_regions(db: DbSession):
    return db.scalars(
        select(Region).where(Region.is_active.is_(True)).order_by(Region.province, Region.type, Region.name)
    ).all()


@router.get("/vehicle-types", response_model=list[VehicleTypeOut])
def list_vehicle_types(db: DbSession):
    return db.scalars(
        select(VehicleType).where(VehicleType.is_active.is_(True)).order_by(VehicleType.capacity)
    ).all()


def to_place(db: Session, p: PlaceIn) -> quotes.Place:
    if p.place_token:
        resolved = places.read_token(db, p.place_token)
        # Koordinat ve bölge jetondan gelir; kullanıcının notu (otel, oda no) adrese eklenir.
        address = resolved.address if not p.address else f"{resolved.address} ({p.address})"[:300]
        return quotes.Place(region_id=resolved.region.id, lat=resolved.lat, lng=resolved.lng, address=address)
    # K-58: fiyat gerçek noktalardan hesaplandığı için istemcinin gönderdiği ham koordinata güvenilmez;
    # jeton yoksa yalnızca bölge (ilçe/havalimanı merkezi) kullanılır.
    return quotes.Place(region_id=p.region_id, lat=None, lng=None, address=p.address)


def to_quote_input(db: Session, body: QuoteIn) -> quotes.QuoteInput:
    return quotes.QuoteInput(
        pickup=to_place(db, body.pickup),
        dropoff=to_place(db, body.dropoff),
        vehicle_type_code=body.vehicle_type_code,
        pickup_at=body.pickup_at,
        return_pickup_at=body.return_pickup_at,
        passenger_count=body.passenger_count,
        luggage_count=body.luggage_count,
        country_code=body.country_code,
        with_guarantee=body.with_guarantee,
    )


def quote_out(q: quotes.Quote) -> QuoteOut:
    return QuoteOut(
        vehicle_type_code=q.vehicle_type.code,
        is_round_trip=q.is_round_trip,
        legs=[
            QuoteLegOut(
                pickup_region_id=leg.pickup_region.id,
                dropoff_region_id=leg.dropoff_region.id,
                pickup_at=leg.pickup_at,
                distance_km=leg.distance_km,
                duration_minutes=leg.duration_minutes,
                price=leg.price,
                route_polyline=leg.route_polyline,
            )
            for leg in q.legs
        ],
        price=q.price,
        guarantee_fee=q.guarantee_fee,
        total=q.total,
        currency=q.currency,
        guarantee_available=get_settings().guarantee_enabled,
    )


@router.post("/quotes", response_model=QuoteOut)
def create_quote(body: QuoteIn, db: DbSession, now: Now):
    q = quotes.build_quote(db, to_quote_input(db, body), router=get_routing(), now=now)
    return quote_out(q)


@router.post("/routes/preview", response_model=RoutePreviewOut)
def route_preview(body: RoutePreviewIn, db: DbSession, ip: ClientIp):
    """Rota adımında, fiyat istenmeden önce iki nokta arasındaki karayolu çizgisi (K-58: düz çizgi değil).
    Noktalar teklifle aynı kuralla çözülür (imzalı adres jetonu ya da bölge merkezi); ücretli Routes API'ye
    gittiği için IP başına adres aramasıyla aynı dakikalık sınır uygulanır. Sonuç 10 dk önbellekte kalır,
    hemen ardından gelen fiyat teklifi aynı rotayı yeniden istemez."""
    places.check_rate_limit(ip)
    route = quotes.preview_route(db, to_place(db, body.pickup), to_place(db, body.dropoff), router=get_routing())
    return RoutePreviewOut(distance_km=route.distance_km, duration_minutes=route.duration_minutes,
                           route_polyline=route.polyline)


# --- Adres arama (ekran 3) -----------------------------------------------------


@router.get("/places/autocomplete", response_model=list[PlaceSuggestionOut])
def autocomplete(
    ip: ClientIp,
    db: DbSession,
    q: Annotated[str, Query(min_length=2, max_length=120)],
    session: str | None = None,
    lang: str = "tr",
):
    """Önce kendi popüler yer listemiz (K-61), sonra ücretli arama. Kısa sorguda liste yeterince sonuç
    verdiyse ücretli aramaya gidilmez; müşteri yazmaya devam ederse tam arama yapılır."""
    places.check_rate_limit(ip)
    s = get_settings()
    local = popular_places.search(db, q)
    out = [popular_places.suggestion(p).__dict__ for p in local]
    if len(local) >= s.popular_places_enough and len(q.strip()) < s.popular_places_short_query:
        api_cache.count("places_ac_local")
        return out
    try:
        remote = get_places().autocomplete(q, places.valid_session(session), _locale(lang))
    except ServiceUnavailable:
        if not out:
            raise
        remote = []  # arama servisi yanıt vermedi; kendi listemiz yine önerilir
    known = {p.google_place_id for p in local if p.google_place_id}
    out += [r.__dict__ for r in remote if r.place_id not in known]
    return out[:8]


@router.get("/places/{place_id}", response_model=PlaceOut)
def place_details(place_id: str, db: DbSession, ip: ClientIp, session: str | None = None, lang: str = "tr"):
    """Seçilen adresin ilçesini (veya havalimanını) çözer ve fiyat teklifinde kullanılacak jetonu döner."""
    places.check_rate_limit(ip)
    if popular_places.is_local(place_id):
        region, detail = popular_places.details(db, place_id[:40])
        api_cache.count("places_det_local")
    else:
        detail = get_places().details(place_id[:300], places.valid_session(session), _locale(lang))
        region = places.resolve_region(db, detail)
        # Sık seçilen oteller ve mekânlar admin panelinde popüler listeye aday olarak görünür.
        # Konut ya da sokak adresi sayılmaz (kişisel veri: kimin nerede kaldığı tutulmaz).
        if detail.is_venue and not detail.is_airport:
            api_cache.bump_pick(detail.place_id, detail.address, ip)
    return PlaceOut(place_token=places.issue_token(region, detail), address=detail.address,
                    lat=detail.lat, lng=detail.lng, region=RegionOut.model_validate(region))
