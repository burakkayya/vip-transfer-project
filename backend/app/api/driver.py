"""Sürücü mobil uygulaması uçları (ekranlar.md, "Sürücü mobil uygulaması")."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

import redis
from PIL import Image
from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.localtime import local_date
from app.api.deps import ClientIp, CurrentDriver, DbSession, Now, current_driver_user
from app.api.schemas import SUPPORTED_LOCALES, DocumentOut, MoneyStr
from app.provinces import PROVINCE_PATTERN
from app.security.crypto import normalize_phone
from app.errors import Conflict, DomainError, Forbidden, NotFound, ServiceUnavailable, TooManyRequests
from app.models import (
    BookingLeg,
    DispatchOffer,
    Document,
    Driver,
    DriverLedger,
    DriverVehicleAssignment,
    User,
    Vehicle,
    VehicleType,
)
from app.models.enums import (
    DocumentOwner,
    DocumentType,
    DriverStatus,
    LedgerStatus,
    LegStatus,
    OfferStatus,
    TripEventType,
    VehicleStatus,
)
from app.config import get_settings
from app.providers import routing
from app.providers.storage import get_storage
from app.providers.routing import Point
from app.services import (
    audit,
    daily_rental,
    dispatch,
    documents,
    driver_tools,
    eta,
    live_location,
    meeting,
    notifications,
    quotes,
    ratings,
    route_line,
    system_settings,
)

router = APIRouter(prefix="/driver", tags=["driver"])


def _whatsapp(v: str | None) -> str | None:
    """K-78: WhatsApp boşsa None; Türkiye içi yazımı (0532..., 532...) +90 ile tamamlanır."""
    if not v or not v.strip():
        return None
    digits = "".join(ch for ch in v if ch.isdigit())
    if not v.strip().startswith("+") and len(digits) in (10, 11) and digits.lstrip("0").startswith("5"):
        v = "+90" + digits.lstrip("0")
    return normalize_phone(v)


class DriverRegisterIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    tursab_or_agency_no: str | None = Field(default=None, max_length=50)
    iban: str | None = Field(default=None, pattern=r"^TR\d{24}$")
    # K-78 sürücü detayları
    whatsapp_phone: str | None = Field(default=None, max_length=40)
    operating_province: str | None = Field(default=None, pattern=PROVINCE_PATTERN)

    @field_validator("whatsapp_phone")
    @classmethod
    def _wa(cls, v: str | None) -> str | None:
        return _whatsapp(v)


class ContactIn(BaseModel):
    """K-78: sürücü detayları (WhatsApp isteğe bağlı, çalıştığı il)."""

    whatsapp_phone: str | None = Field(default=None, max_length=40)
    operating_province: str | None = Field(default=None, pattern=PROVINCE_PATTERN)

    @field_validator("whatsapp_phone")
    @classmethod
    def _wa(cls, v: str | None) -> str | None:
        return _whatsapp(v)


class DriverOut(BaseModel):
    id: uuid.UUID
    full_name: str
    status: DriverStatus
    is_online: bool
    missing_documents: list[str]
    # K-62 sürücü kartı ve puan
    languages: list[str] = []
    has_photo: bool = False
    rating_avg: Decimal | None = None
    rating_count: int = 0
    # K-78 sürücü detayları
    phone: str | None = None
    whatsapp_phone: str | None = None
    operating_province: str | None = None


def _driver_out(db, driver: Driver, today: date) -> DriverOut:
    avg, count = ratings.driver_summary(db, driver.id)
    return DriverOut(
        id=driver.id,
        full_name=driver.full_name,
        status=driver.status,
        is_online=driver.is_online,
        missing_documents=dispatch.missing_documents(db, DocumentOwner.DRIVER, driver.id, today),
        languages=driver.language_list,
        has_photo=bool(driver.photo_key),
        rating_avg=avg,
        rating_count=count,
        phone=driver.user.phone,
        whatsapp_phone=driver.whatsapp_phone,
        operating_province=driver.operating_province,
    )


@router.post("/register", response_model=DriverOut, status_code=201)
def register(
    body: DriverRegisterIn,
    user: Annotated[User, Depends(current_driver_user)],
    db: DbSession,
    ip: ClientIp,
    now: Now,
):
    if db.scalar(select(Driver).where(Driver.user_id == user.id)):
        raise Conflict("sürücü kaydı zaten var")
    driver = Driver(user_id=user.id, full_name=body.full_name,
                    tursab_or_agency_no=body.tursab_or_agency_no, iban=body.iban,
                    whatsapp_phone=body.whatsapp_phone, operating_province=body.operating_province)
    db.add(driver)
    db.flush()
    audit.record(db, actor_id=user.id, action="driver.register", entity_type="driver", entity_id=driver.id, ip=ip)
    db.commit()
    return _driver_out(db, driver, local_date(now))


@router.get("/me", response_model=DriverOut)
def me(driver: CurrentDriver, db: DbSession, now: Now):
    return _driver_out(db, driver, local_date(now))


class OnlineIn(BaseModel):
    is_online: bool
    push_token: str | None = Field(default=None, max_length=255)


@router.post("/me/online", response_model=DriverOut)
def set_online(body: OnlineIn, driver: CurrentDriver, db: DbSession, now: Now):
    if body.is_online and driver.status is not DriverStatus.APPROVED:
        raise Forbidden("onaylı olmayan sürücü çevrimiçi olamaz", code="driver_not_approved")
    driver.is_online = body.is_online
    if body.push_token:
        notifications.bind_push_token(db, driver, body.push_token)
    db.commit()
    return _driver_out(db, driver, local_date(now))


# --- Belgeler ve araçlar -----------------------------------------------------


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    driver: CurrentDriver,
    db: DbSession,
    doc_type: Annotated[DocumentType, Form()],
    file: Annotated[UploadFile, File()],
    now: Now,
    valid_until: Annotated[date | None, Form()] = None,
    vehicle_id: Annotated[uuid.UUID | None, Form()] = None,
):
    owner_type, owner_id = DocumentOwner.DRIVER, driver.id
    vehicle_ids = _vehicle_ids(db, driver)
    if vehicle_id is not None:
        _own_vehicle(db, driver, vehicle_id)
        owner_type, owner_id = DocumentOwner.VEHICLE, vehicle_id
    # API-07: gövde sınırı akış sırasında `app.body_limit`'te; burada adet kotası ve tek bekleyen belge.
    documents.check_upload_quota(db, driver=driver, vehicle_ids=vehicle_ids, owner_type=owner_type,
                                 owner_id=owner_id, doc_type=doc_type, now=now)
    data = await file.read(documents.MAX_DOCUMENT_BYTES + 1)
    doc = documents.upload(
        db,
        get_storage(),
        owner_type=owner_type,
        owner_id=owner_id,
        doc_type=doc_type,
        content_type=file.content_type or "",
        data=data,
        valid_until=valid_until,
        actor_id=driver.user_id,
    )
    db.commit()
    return doc


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(driver: CurrentDriver, db: DbSession):
    vehicle_ids = _vehicle_ids(db, driver)
    rows = db.scalars(
        select(Document)
        .where(
            ((Document.owner_type == DocumentOwner.DRIVER) & (Document.owner_id == driver.id))
            | ((Document.owner_type == DocumentOwner.VEHICLE) & (Document.owner_id.in_(vehicle_ids)))
        )
        .order_by(Document.created_at.desc())
    )
    return list(rows)


@router.delete("/documents/{doc_id}", status_code=204)
def withdraw_document(doc_id: uuid.UUID, driver: CurrentDriver, db: DbSession, ip: ClientIp):
    """REV-B-7: incelemede bekleyen kendi belgesini (sürücü veya aktif aracı) geri çeker. Başkasının belgesi 404,
    incelenmiş belge 409 `document_not_pending`."""
    doc = db.get(Document, doc_id, with_for_update={"of": Document})
    own = doc is not None and (
        (doc.owner_type is DocumentOwner.DRIVER and doc.owner_id == driver.id)
        or (doc.owner_type is DocumentOwner.VEHICLE and doc.owner_id in _vehicle_ids(db, driver))
    )
    if not own:
        raise NotFound("belge bulunamadı")
    documents.withdraw(db, get_storage(), doc, actor_id=driver.user_id, ip=ip)
    db.commit()


@router.get("/documents/{doc_id}/file")
def own_vehicle_photo(doc_id: uuid.UUID, driver: CurrentDriver, db: DbSession):
    """K-78: sürücünün kendi araç fotoğrafının küçük resmi (640 px JPEG). Yalnızca araç fotoğrafları; kimlik, ehliyet gibi
    kişisel belgeler yüklendikten sonra uygulamaya geri verilmez (KVKK, gereksiz kopya yok)."""
    doc = db.get(Document, doc_id)
    own = (doc is not None and doc.owner_type is DocumentOwner.VEHICLE
           and doc.owner_id in _vehicle_ids(db, driver) and doc.doc_type in documents.PHOTO_TYPES)
    if not own:
        raise NotFound("belge bulunamadı")
    try:
        data = documents.thumbnail(get_storage().get(doc.storage_key))
    except (OSError, ValueError, Image.DecompressionBombError):
        raise NotFound("fotoğraf okunamadı") from None
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})


class VehicleIn(BaseModel):
    plate: str = Field(pattern=r"^\d{2}\s?[A-Z]{1,3}\s?\d{2,4}$")
    vehicle_type_code: str
    brand: str = Field(max_length=50)
    model: str = Field(max_length=50)
    year: int | None = Field(default=None, ge=1990, le=2100)
    capacity: int = Field(ge=1, le=50)
    color: str | None = Field(default=None, max_length=30)


class VehicleColorIn(BaseModel):
    color: str | None = Field(default=None, max_length=30)


class VehicleOut(BaseModel):
    id: uuid.UUID
    plate: str
    vehicle_type_code: str
    brand: str
    model: str
    capacity: int
    status: VehicleStatus
    missing_documents: list[str]
    color: str | None = None


def _vehicle_ids(db, driver: Driver) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(DriverVehicleAssignment.vehicle_id).where(
                DriverVehicleAssignment.driver_id == driver.id, DriverVehicleAssignment.valid_to.is_(None)
            )
        )
    )


def _own_vehicle(db, driver: Driver, vehicle_id: uuid.UUID) -> Vehicle:
    if vehicle_id not in _vehicle_ids(db, driver):
        raise NotFound("araç bulunamadı")
    return db.get(Vehicle, vehicle_id)


def _vehicle_out(db, v: Vehicle, today: date) -> VehicleOut:
    return VehicleOut(
        id=v.id, plate=v.plate, vehicle_type_code=v.vehicle_type.code, brand=v.brand, model=v.model,
        capacity=v.capacity, status=v.status, color=v.color,
        missing_documents=dispatch.missing_documents(db, DocumentOwner.VEHICLE, v.id, today),
    )


@router.post("/vehicles", response_model=VehicleOut, status_code=201)
def add_vehicle(body: VehicleIn, driver: CurrentDriver, db: DbSession, now: Now):
    vt = db.scalar(select(VehicleType).where(VehicleType.code == body.vehicle_type_code))
    if vt is None:
        raise NotFound("araç tipi bulunamadı")
    plate = body.plate.replace(" ", "").upper()
    if db.scalar(select(Vehicle.id).where(Vehicle.plate == plate)):
        raise Conflict("bu plaka kayıtlı")
    vehicle = Vehicle(plate=plate, vehicle_type_id=vt.id, vehicle_type=vt, brand=body.brand, model=body.model,
                      year=body.year, capacity=body.capacity, color=(body.color or "").strip() or None)
    db.add(vehicle)
    db.flush()
    db.add(DriverVehicleAssignment(driver_id=driver.id, vehicle_id=vehicle.id, valid_from=now))
    audit.record(db, actor_id=driver.user_id, action="vehicle.create", entity_type="vehicle", entity_id=vehicle.id)
    db.commit()
    return _vehicle_out(db, vehicle, local_date(now))


@router.get("/vehicles", response_model=list[VehicleOut])
def list_vehicles(driver: CurrentDriver, db: DbSession, now: Now):
    ids = _vehicle_ids(db, driver)
    return [_vehicle_out(db, v, local_date(now)) for v in db.scalars(select(Vehicle).where(Vehicle.id.in_(ids)))]


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
def update_vehicle_color(vehicle_id: uuid.UUID, body: VehicleColorIn, driver: CurrentDriver, db: DbSession, now: Now):
    """K-62: araç rengi müşterinin aracı tanıması için sürücü kartında görünür."""
    vehicle = _own_vehicle(db, driver, vehicle_id)
    vehicle.color = (body.color or "").strip() or None
    db.commit()
    return _vehicle_out(db, vehicle, local_date(now))


# --- Sürücü kartı (K-62) -------------------------------------------------------


class ProfileIn(BaseModel):
    languages: list[str] = Field(min_length=1, max_length=12)  # K-77: on iki dil


@router.put("/me/profile", response_model=DriverOut)
def update_profile(body: ProfileIn, driver: CurrentDriver, db: DbSession, now: Now):
    langs = list(dict.fromkeys(x.lower()[:2] for x in body.languages))
    if any(x not in SUPPORTED_LOCALES for x in langs):
        raise DomainError("desteklenmeyen dil", code="invalid_language")
    driver.languages = ",".join(langs)
    db.commit()
    return _driver_out(db, driver, local_date(now))


@router.put("/me/contact", response_model=DriverOut)
def update_contact(body: ContactIn, driver: CurrentDriver, db: DbSession, now: Now, ip: ClientIp):
    """K-78: sürücü detaylarındaki WhatsApp ve çalışılan il."""
    driver.whatsapp_phone = body.whatsapp_phone
    driver.operating_province = body.operating_province
    audit.record(db, actor_id=driver.user_id, action="driver.contact", entity_type="driver", entity_id=driver.id, ip=ip)
    db.commit()
    return _driver_out(db, driver, local_date(now))


@router.post("/me/photo", response_model=DriverOut)
async def upload_photo(driver: CurrentDriver, db: DbSession, now: Now, file: Annotated[UploadFile, File()]):
    """Müşteriye sürücü kartında gösterilen profil fotoğrafı (JPEG/PNG, en çok 5 MB, şifreli saklanır)."""
    data = await file.read(meeting.MAX_PHOTO_BYTES + 1)
    clean = meeting.clean_photo(file.content_type or "", data)
    storage = get_storage()
    old = driver.photo_key
    driver.photo_key = storage.put(f"driver_photo/{driver.id}", clean)
    driver.photo_content_type = meeting.PHOTO_CONTENT_TYPE
    audit.record(db, actor_id=driver.user_id, action="driver.photo", entity_type="driver", entity_id=driver.id)
    db.commit()
    if old:
        storage.delete(old)
    return _driver_out(db, driver, local_date(now))


@router.get("/me/photo")
def my_photo(driver: CurrentDriver):
    key, content_type = meeting.driver_photo(driver)
    return Response(get_storage().get(key), media_type=content_type, headers={"Cache-Control": "private, max-age=300"})


# --- Teklifler ve yolculuklar ------------------------------------------------


class TripOut(BaseModel):
    """Sürücüye yalnızca karşılama için gerekli bilgiler gösterilir (is_modeli.md)."""

    leg_id: uuid.UUID
    booking_code: str
    status: LegStatus
    pickup_at: datetime
    pickup_region: str
    dropoff_region: str
    pickup_address: str | None
    dropoff_address: str | None
    pickup_lat: Decimal | None
    pickup_lng: Decimal | None
    passenger_name: str
    passenger_count: int
    luggage_count: int
    # K-62: ekstralar, yolcunun bildirdiği durum ve dili (sürücü sohbette çeviri görür).
    child_seat_count: int = 0
    market_stop: bool = False
    passenger_status: str | None = None
    passenger_status_at: datetime | None = None
    customer_locale: str | None = None
    # K-63: müşteri notu (kabul sonrası), kanıtlı bekleme.
    customer_note: str | None = None
    arrived_at: datetime | None = None
    no_show_after: datetime | None = None
    no_show: bool = False
    flight_no: str | None
    driver_amount: MoneyStr
    # K-60: uçuş takibi (geliş uçuşunda tahmini iniş; takip kapalıysa None)
    flight_status: str | None = None
    flight_scheduled_at: datetime | None = None
    flight_estimated_at: datetime | None = None
    currency: str
    route_polyline: str | None = None
    booking_type: str | None = None
    dropoff_lat: Decimal | None = None
    dropoff_lng: Decimal | None = None
    distance_km: Decimal | None = None
    duration_minutes: int | None = None
    # K-29: transfer | gunluk (günlük kiralamada süre paket saati, mesafe km sınırı; bitiş yeri serbest).
    service_type: str = "transfer"
    # K-79: gün sonu km (sürücünün girdiği).
    day_km_used: int | None = None


def _trip_out(leg: BookingLeg, *, with_route: bool = False) -> TripOut:
    """`with_route` yalnızca tekil yolculuk yanıtlarında (kabul, durum adımı) doldurulur; listelerde None kalır."""
    b = leg.booking
    return TripOut(
        leg_id=leg.id,
        booking_code=b.booking_code,
        status=leg.status,
        pickup_at=leg.pickup_at,
        pickup_region=leg.pickup_region.name,
        dropoff_region=leg.dropoff_region.name,
        pickup_address=leg.pickup_address,
        dropoff_address=leg.dropoff_address,
        pickup_lat=leg.pickup_lat if leg.pickup_lat is not None else leg.pickup_region.latitude,
        pickup_lng=leg.pickup_lng if leg.pickup_lng is not None else leg.pickup_region.longitude,
        passenger_name=b.passenger_name,
        passenger_count=b.passenger_count,
        luggage_count=b.luggage_count,
        child_seat_count=b.child_seat_count,
        market_stop=b.market_stop,
        passenger_status=leg.passenger_status,
        passenger_status_at=leg.passenger_status_at,
        customer_locale=b.locale,
        customer_note=b.note,
        arrived_at=leg.arrived_at,
        no_show_after=driver_tools.no_show_after(leg),
        no_show=leg.no_show_at is not None,
        flight_no=leg.flight.flight_no if leg.flight else None,
        flight_status=leg.flight.status if leg.flight else None,
        flight_scheduled_at=(leg.flight.provider_scheduled_at or leg.flight.scheduled_at) if leg.flight else None,
        flight_estimated_at=leg.flight.estimated_at if leg.flight else None,
        driver_amount=leg.leg_price - (leg.leg_price * b.commission_rate).quantize(Decimal("0.01")),
        currency=b.currency.value,
        route_polyline=route_line.route_polyline(leg) if with_route else None,
        booking_type=b.booking_type.value,
        dropoff_lat=leg.dropoff_lat if leg.dropoff_lat is not None else leg.dropoff_region.latitude,
        dropoff_lng=leg.dropoff_lng if leg.dropoff_lng is not None else leg.dropoff_region.longitude,
        distance_km=leg.distance_km,
        duration_minutes=leg.duration_minutes,
        service_type=b.service_type.value,
        day_km_used=leg.day_km_used,
    )


class OfferOut(BaseModel):
    offer_id: uuid.UUID
    expires_at: datetime
    trip: TripOut


@router.get("/offers", response_model=list[OfferOut])
def list_offers(driver: CurrentDriver, db: DbSession, now: Now):
    rows = db.scalars(
        select(DispatchOffer).where(
            DispatchOffer.driver_id == driver.id,
            DispatchOffer.status == OfferStatus.SENT,
            DispatchOffer.expires_at > now,
        )
    )
    # Teklif aşamasında yolcu adı gösterilmez; kabul sonrası görünür.
    result = []
    for o in rows:
        trip = _trip_out(o.leg)
        trip.passenger_name = trip.passenger_name.split()[0][:1] + "***"
        trip.pickup_address = None
        trip.dropoff_address = None
        trip.customer_note = None
        # PRIV-03: kabul öncesi kesin nokta verilmez; iş havuzundaki gibi yalnızca bölge düzeyi
        # (ilçe / havalimanı merkezi, herkese açık). Kesin koordinat kabul yanıtında gelir.
        leg = o.leg
        trip.pickup_lat, trip.pickup_lng = leg.pickup_region.latitude, leg.pickup_region.longitude
        trip.dropoff_lat, trip.dropoff_lng = leg.dropoff_region.latitude, leg.dropoff_region.longitude
        result.append(OfferOut(offer_id=o.id, expires_at=o.expires_at, trip=trip))
    return result


@router.post("/offers/{offer_id}/accept", response_model=TripOut)
def accept_offer(offer_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now):
    try:
        leg = dispatch.accept_offer(db, driver, offer_id, now=now)
    except Conflict:
        db.commit()  # teklif durumu (süresi doldu/geri çekildi) kaydedilsin
        raise
    db.commit()
    return _trip_out(leg, with_route=True)


@router.post("/offers/{offer_id}/reject", status_code=204)
def reject_offer(offer_id: uuid.UUID, driver: CurrentDriver, db: DbSession, now: Now):
    dispatch.reject_offer(db, driver, offer_id, now=now)
    db.commit()


@router.get("/trips", response_model=list[TripOut])
def list_trips(driver: CurrentDriver, db: DbSession, include_past: bool = False):
    q = select(BookingLeg).where(BookingLeg.driver_id == driver.id)
    if not include_past:
        q = q.where(BookingLeg.status.in_(dispatch.ACTIVE_LEG_STATUSES))
    return [_trip_out(leg) for leg in db.scalars(q.order_by(BookingLeg.pickup_at).limit(200))]


@router.get("/trips/{leg_id}", response_model=TripOut)
def get_trip(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession):
    leg = db.get(BookingLeg, leg_id)
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    return _trip_out(leg, with_route=True)


class TripEventIn(BaseModel):
    event: TripEventType
    # Sürücünün o anki konumu: yola çıkışta ilk tahmini süre, bitirişte varış yarıçapı (K-49) için.
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


@router.post("/trips/{leg_id}/events", response_model=TripOut)
def trip_event(leg_id: uuid.UUID, body: TripEventIn, driver: CurrentDriver, db: DbSession, now: Now):
    leg = db.get(BookingLeg, leg_id, with_for_update={"of": BookingLeg})
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    at = None
    if body.lat is not None and body.lng is not None:
        at = Point(Decimal(str(body.lat)), Decimal(str(body.lng)))
    elif body.event is TripEventType.FINISHED and (last := live_location.for_leg(leg)):
        at = Point(Decimal(str(last["lat"])), Decimal(str(last["lng"])))
    dispatch.advance_trip(db, driver, leg, body.event, now=now, at=at)
    db.commit()
    if leg.status is LegStatus.COMPLETED:
        live_location.clear(leg)
    elif at is not None and leg.status in live_location.TRACKABLE:
        live_location.store(leg, float(at.lat), float(at.lng), None, now)
    return _trip_out(leg, with_route=True)


class DayReportIn(BaseModel):
    km_used: int = Field(ge=0, le=3000)


@router.post("/trips/{leg_id}/day-report", response_model=TripOut)
def day_report(leg_id: uuid.UUID, body: DayReportIn, driver: CurrentDriver, db: DbSession, now: Now):
    """K-79: günlük kiralamada gün sonu km (gün içinde ya da bitişten sonra 24 saat içinde)."""
    leg = db.get(BookingLeg, leg_id, with_for_update={"of": BookingLeg})
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    daily_rental.report_day(db, driver, leg, body.km_used, now)
    db.commit()
    return _trip_out(leg, with_route=True)


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    heading: float | None = Field(default=None, ge=0, le=360)


@router.post("/trips/{leg_id}/location", status_code=204)
def post_location(leg_id: uuid.UUID, body: LocationIn, driver: CurrentDriver, db: DbSession, now: Now):
    leg = db.get(BookingLeg, leg_id)
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    if leg.status not in live_location.TRACKABLE:
        raise DomainError("konum yalnızca aktif yolculukta paylaşılır", code="trip_not_active")
    live_location.store(leg, body.lat, body.lng, body.heading, now)
    # Tahmini süre ve müşteri bildirim eşikleri (yaklaşıyor, 10 dk) (K-51).
    eta.on_location(db, leg, Point(Decimal(str(body.lat)), Decimal(str(body.lng))))
    db.commit()


# --- Yaklaşma rotası (MON-12) ------------------------------------------------

# Rota başlangıcı ~100 m'ye yuvarlanır: yakın konumlar aynı önbellek kaydını ve sağlayıcı önbelleğini kullanır,
# keyfi koordinatla paylaşılan rota önbelleği taşırılamaz.
APPROACH_ROUND = Decimal("0.001")


def _approach_cache_get(key: str) -> tuple[str | None, Decimal | None, int | None] | None:
    try:
        raw = quotes._redis().get(key)
    except redis.RedisError:
        return None  # önbellek yardımcıdır; Redis arızasında doğrudan hesaplanır (sınır da fail-open)
    if raw is None:
        return None
    data = json.loads(raw)
    return data["p"], (Decimal(data["km"]) if data["km"] is not None else None), data["min"]


def _approach_cache_set(key: str, value: tuple[str | None, Decimal | None, int | None], seconds: int) -> None:
    line, km, minutes = value
    try:
        quotes._redis().set(key, json.dumps({"p": line, "km": str(km) if km is not None else None, "min": minutes}),
                            ex=seconds)
    except redis.RedisError:
        pass


def approach_route(driver: Driver, leg: BookingLeg, at: Point, target: Point) -> tuple[str | None, Decimal | None, int | None]:
    """MON-12: sürücü konumundan hedefe rota (polyline, km, dakika). Ücretli Routes API'ye gider; bu yüzden
    yalnızca aktif bacakta, yuvarlanmış başlangıçla, kısa süreli Redis önbelleğinden ve sürücü başına dakikalık
    sınırla çağrılır. Sınır yalnızca sağlayıcıya giden (önbellekte olmayan) isteklerde sayılır; Redis yoksa
    teklif sınırındaki gibi fail-open."""
    if leg.status not in dispatch.ACTIVE_LEG_STATUSES:
        raise Conflict("rota yalnızca aktif yolculukta alınır", code="trip_not_active")
    s = get_settings()
    origin = Point(at.lat.quantize(APPROACH_ROUND), at.lng.quantize(APPROACH_ROUND))
    kind = "dropoff" if leg.status is LegStatus.STARTED else "pickup"
    key = f"approach:{leg.id}:{kind}:{origin.lat}:{origin.lng}"
    cached = _approach_cache_get(key)
    if cached is not None:
        return cached
    if quotes._bump(f"approach_rl:driver:{driver.id}:{quotes._minute()}") > s.approach_rate_limit_per_minute:
        raise TooManyRequests("rota çok sık istendi, lütfen biraz bekleyin")
    try:
        # K-61: canlı konumdan başlayan rota paylaşılan 24 saatlik önbelleğe girmez; kısa önbellek yukarıda.
        route = routing.get_live_routing().route(origin, target)
    except ServiceUnavailable:
        return None, None, eta.estimate_minutes(at, target)  # yedek tahmin önbelleğe yazılmaz
    result = (route.polyline, route.distance_km, route.duration_minutes)
    _approach_cache_set(key, result, s.approach_cache_seconds)
    return result


# --- Kazanç ------------------------------------------------------------------


class EarningsOut(BaseModel):
    pending_try: MoneyStr
    paid_try: MoneyStr
    entries: list[dict]


@router.get("/earnings", response_model=EarningsOut)
def earnings(driver: CurrentDriver, db: DbSession):
    rows = list(
        db.scalars(select(DriverLedger).where(DriverLedger.driver_id == driver.id)
                   .order_by(DriverLedger.created_at.desc()).limit(200))
    )
    totals = dict(
        db.execute(
            select(DriverLedger.status, func.coalesce(func.sum(DriverLedger.net_amount_try), 0))
            .where(DriverLedger.driver_id == driver.id)
            .group_by(DriverLedger.status)
        ).all()
    )
    return EarningsOut(
        pending_try=Decimal(totals.get(LedgerStatus.PENDING, 0)),
        paid_try=Decimal(totals.get(LedgerStatus.PAID, 0)),
        entries=[
            {"id": str(r.id), "leg_id": str(r.booking_leg_id), "net_amount": f"{r.net_amount:.2f}",
             "currency": r.currency.value,
             "net_amount_try": f"{r.net_amount_try:.2f}" if r.net_amount_try is not None else None,
             "status": r.status.value, "created_at": r.created_at.isoformat(), "kind": r.kind}
            for r in rows
        ],
    )


@router.get("/document-alerts")
def document_alerts(driver: CurrentDriver, db: DbSession, now: Now):
    """Süresi yaklaşan veya dolmuş belgeler (ekran 8)."""
    days = int(system_settings.get(db, "document_expiry_warning_days"))
    ids = [driver.id, *_vehicle_ids(db, driver)]
    docs = db.scalars(select(Document).where(Document.owner_id.in_(ids)))
    today = local_date(now)
    return [
        {"id": str(d.id), "doc_type": d.doc_type.value, "valid_until": d.valid_until.isoformat(),
         "status": d.status.value, "days_left": (d.valid_until - today).days}
        for d in docs
        if d.valid_until is not None and (documents.is_expiring(d, today, days) or d.valid_until < today)
    ]
