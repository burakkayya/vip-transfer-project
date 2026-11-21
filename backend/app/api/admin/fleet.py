"""Admin: sürücüler, araçlar, araç tipleri, belgeler (ekran 5-7)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.localtime import local_date
from app.api.admin import common
from app.api.admin.common import Page, page
from app.api.deps import AdminOnly, ClientIp, DbSession, Now, OpsStaff
from app.api.schemas import DocumentOut
from app.errors import Conflict, DomainError, NotFound
from app.models import Document, Driver, DriverVehicleAssignment, Vehicle, VehicleType
from app.models.fleet import PHOTO_APPROVED, PHOTO_PENDING, PHOTO_REJECTED
from app.models.enums import DocumentOwner, DocumentStatus, DriverStatus, ReviewDecision, VehicleStatus
from app.providers.storage import get_storage
from app.security.crypto import mask_phone
from app.services import audit, dispatch, documents, system_settings

router = APIRouter(tags=["admin:fleet"])


def _driver_row(db, d: Driver, today: date) -> dict:
    return {
        "id": str(d.id),
        "full_name": d.full_name,
        "phone": mask_phone(d.user.phone or ""),
        "tursab_or_agency_no": d.tursab_or_agency_no,
        # K-78 sürücü detayları (WhatsApp listede maskeli, operasyon detayda tam görür)
        "whatsapp_phone": mask_phone(d.whatsapp_phone) if d.whatsapp_phone else None,
        "operating_province": d.operating_province,
        "status": d.status.value,
        "is_online": d.is_online,
        "missing_documents": dispatch.missing_documents(db, DocumentOwner.DRIVER, d.id, today),
        # K-81: profil fotoğrafı onayı (fotoğraf yoksa boş).
        "photo_status": d.photo_status if d.photo_key else None,
        "photo_reject_reason": d.photo_reject_reason,
        "photo_version": photo_version(d),
        "created_at": d.created_at,
    }


@router.get("/drivers")
def list_drivers(staff: OpsStaff, db: DbSession, now: Now, p: Annotated[Page, Depends(page)],
                 status: DriverStatus | None = None, photo_pending: bool = False):
    q = select(Driver)
    if status:
        q = q.where(Driver.status == status)
    if photo_pending:
        q = q.where(Driver.photo_key.is_not(None), Driver.photo_status == PHOTO_PENDING)
    rows = db.scalars(q.order_by(Driver.created_at.desc()).limit(p.limit).offset(p.offset))
    return [_driver_row(db, d, local_date(now)) for d in rows]


def _get_driver(db, driver_id: uuid.UUID) -> Driver:
    d = db.get(Driver, driver_id)
    if d is None:
        raise NotFound("sürücü bulunamadı")
    return d


@router.get("/drivers/{driver_id}")
def driver_detail(driver_id: uuid.UUID, staff: OpsStaff, db: DbSession, now: Now):
    d = _get_driver(db, driver_id)
    assignments = db.scalars(select(DriverVehicleAssignment).where(DriverVehicleAssignment.driver_id == d.id))
    vehicle_ids = [a.vehicle_id for a in assignments]
    docs = db.scalars(select(Document).where(Document.owner_id.in_([d.id, *vehicle_ids])))
    vehicles = db.scalars(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))
    return {
        **_driver_row(db, d, local_date(now)),
        # K-78: operasyon sürücüye ulaşabilsin diye detayda WhatsApp açık (görüntüleme OpsStaff ile sınırlı).
        "vehicles": [_vehicle_row(db, v, local_date(now)) for v in vehicles],
        "documents": [DocumentOut.model_validate(x) for x in docs],
    }


@router.get("/drivers/{driver_id}/photo")
def driver_photo(driver_id: uuid.UUID, staff: OpsStaff, db: DbSession):
    """K-81: onay için sürücünün yüklediği fotoğraf (onay durumundan bağımsız)."""
    d = _get_driver(db, driver_id)
    if not d.photo_key:
        raise NotFound("fotoğraf yok", code="photo_missing")
    return Response(get_storage().get(d.photo_key), media_type=d.photo_content_type or "image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Photo-Version": photo_version(d)})


class PhotoReviewIn(BaseModel):
    approve: bool
    reason: str | None = Field(default=None, max_length=255)
    # Adminin incelediği fotoğrafın sürümü (detaydaki `photo_version`); arada yeni fotoğraf yüklendiyse 409.
    photo_version: str = Field(min_length=8, max_length=64)


def photo_version(d: Driver) -> str | None:
    """Fotoğraf sürümü: depo anahtarının özeti (anahtar her yüklemede değişir, kendisi dışarı verilmez)."""
    import hashlib

    return hashlib.sha256(d.photo_key.encode()).hexdigest()[:16] if d.photo_key else None


@router.post("/drivers/{driver_id}/photo/review")
def review_driver_photo(driver_id: uuid.UUID, body: PhotoReviewIn, staff: OpsStaff, db: DbSession, ip: ClientIp,
                        now: Now):
    """K-81: fotoğraf onayı. Onaylanan fotoğraf müşteri kartında ve takip bağlantısında görünür; reddedilen
    görünmez, sürücü gerekçeyi uygulamada görüp yeni fotoğraf yükler."""
    d = db.get(Driver, driver_id, with_for_update={"of": Driver})
    if d is None:
        raise NotFound("sürücü bulunamadı")
    if not d.photo_key:
        raise NotFound("fotoğraf yok", code="photo_missing")
    if body.photo_version != photo_version(d):
        raise Conflict("sürücü bu arada yeni fotoğraf yükledi; sayfayı yenileyip yeni fotoğrafı inceleyin",
                       code="photo_changed")
    reason = (body.reason or "").strip()
    if not body.approve and len(reason) < 3:
        raise DomainError("ret gerekçesi yazılmalı (sürücüye gösterilir)", code="reason_required")
    d.photo_status = PHOTO_APPROVED if body.approve else PHOTO_REJECTED
    d.photo_reject_reason = None if body.approve else reason
    d.photo_reviewed_at = now
    d.photo_reviewed_by = staff.id
    audit.record(db, actor_id=staff.id, action="driver.photo_review", entity_type="driver", entity_id=d.id,
                 changes={"approve": body.approve, "reason": d.photo_reject_reason}, ip=ip)
    db.commit()
    return _driver_row(db, d, local_date(now))


class StatusIn(BaseModel):
    status: DriverStatus
    reason: str | None = Field(default=None, max_length=500)


@router.post("/drivers/{driver_id}/status")
def set_driver_status(driver_id: uuid.UUID, body: StatusIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    d = _get_driver(db, driver_id)
    documents.set_driver_status(db, d, body.status, actor_id=staff.id, reason=body.reason, ip=ip, today=local_date(now))
    released = 0
    if body.status is not DriverStatus.APPROVED:
        # AUTH-06: yolcu alınmamış işler havuza döner, sürücünün oturumları iptal edilir.
        released = dispatch.release_driver(db, d, actor_id=staff.id, ip=ip, now=now)
    db.commit()
    return {**_driver_row(db, d, local_date(now)), "released_legs": released}


def _vehicle_row(db, v: Vehicle, today: date) -> dict:
    return {
        "id": str(v.id), "plate": v.plate, "vehicle_type": v.vehicle_type.code, "brand": v.brand,
        "model": v.model, "year": v.year, "capacity": v.capacity, "status": v.status.value,
        "missing_documents": dispatch.missing_documents(db, DocumentOwner.VEHICLE, v.id, today),
    }


@router.get("/vehicles")
def list_vehicles(staff: OpsStaff, db: DbSession, now: Now, p: Annotated[Page, Depends(page)],
                  status: VehicleStatus | None = None):
    q = select(Vehicle)
    if status:
        q = q.where(Vehicle.status == status)
    return [_vehicle_row(db, v, local_date(now)) for v in db.scalars(q.order_by(Vehicle.plate).limit(p.limit).offset(p.offset))]


class VehicleStatusIn(BaseModel):
    status: VehicleStatus


@router.post("/vehicles/{vehicle_id}/status")
def set_vehicle_status(vehicle_id: uuid.UUID, body: VehicleStatusIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    v = db.get(Vehicle, vehicle_id)
    if v is None:
        raise NotFound("araç bulunamadı")
    documents.set_vehicle_status(db, v, body.status, actor_id=staff.id, ip=ip, today=local_date(now))
    db.commit()
    return _vehicle_row(db, v, local_date(now))


# --- Araç tipleri ------------------------------------------------------------


class VehicleTypeIn(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9_]{2,30}$")
    name: str = Field(max_length=100)
    capacity: int = Field(ge=1, le=50)
    luggage_capacity: int = Field(ge=0, le=50)
    price_multiplier: Decimal = Field(gt=0, le=10)
    is_active: bool = True


def _vt_row(vt: VehicleType) -> dict:
    return {"id": vt.id, "code": vt.code, "name": vt.name, "capacity": vt.capacity,
            "luggage_capacity": vt.luggage_capacity, "price_multiplier": str(vt.price_multiplier),
            "is_active": vt.is_active}


@router.get("/vehicle-types")
def list_vehicle_types(staff: OpsStaff, db: DbSession):
    return [_vt_row(vt) for vt in db.scalars(select(VehicleType).order_by(VehicleType.id))]


@router.post("/vehicle-types", status_code=201)
def create_vehicle_type(body: VehicleTypeIn, staff: AdminOnly, db: DbSession, ip: ClientIp):
    vt = VehicleType(**body.model_dump())
    db.add(vt)
    db.flush()
    audit.record(db, actor_id=staff.id, action="vehicle_type.create", entity_type="vehicle_type",
                 entity_id=vt.id, changes=body.model_dump(), ip=ip)
    db.commit()
    return _vt_row(vt)


@router.put("/vehicle-types/{vt_id}")
def update_vehicle_type(vt_id: int, body: VehicleTypeIn, staff: AdminOnly, db: DbSession, ip: ClientIp):
    """Çarpan değişikliği yalnızca yeni tekliflere etki eder; rezervasyonlar fiyatı dondurur."""
    vt = db.get(VehicleType, vt_id)
    if vt is None:
        raise NotFound("araç tipi bulunamadı")
    old = _vt_row(vt)
    for k, v in body.model_dump().items():
        setattr(vt, k, v)
    audit.record(db, actor_id=staff.id, action="vehicle_type.update", entity_type="vehicle_type",
                 entity_id=vt.id, changes={"old": old, "new": body.model_dump()}, ip=ip)
    db.commit()
    return _vt_row(vt)


# --- Belgeler ----------------------------------------------------------------


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(staff: OpsStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                   status: DocumentStatus | None = DocumentStatus.PENDING):
    q = select(Document)
    if status:
        q = q.where(Document.status == status)
    return list(db.scalars(q.order_by(Document.created_at).limit(p.limit).offset(p.offset)))


@router.get("/documents/expiring", response_model=list[DocumentOut])
def expiring_documents(staff: OpsStaff, db: DbSession, now: Now):
    """Süresi yaklaşan ve dolan belgeler (ekran 7)."""
    days = int(system_settings.get(db, "document_expiry_warning_days"))
    today = local_date(now)
    return list(
        db.scalars(
            select(Document)
            .where(
                Document.valid_until.is_not(None),
                Document.valid_until <= today + timedelta(days=days),
                Document.status.in_([DocumentStatus.APPROVED, DocumentStatus.EXPIRED]),
            )
            .order_by(Document.valid_until)
            .limit(common.MAX_LIST)
        )
    )


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: uuid.UUID, staff: OpsStaff, db: DbSession, ip: ClientIp):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise NotFound("belge bulunamadı")
    data = get_storage().get(doc.storage_key)
    # Belge görüntüleme de bir erişimdir, denetim kaydına yazılır.
    audit.record(db, actor_id=staff.id, action="document.view", entity_type="document", entity_id=doc.id, ip=ip)
    db.commit()
    return Response(content=data, media_type=doc.content_type,
                    headers={"Cache-Control": "no-store", "Content-Disposition": "inline"})


class ReviewIn(BaseModel):
    decision: ReviewDecision
    valid_until: date | None = None
    note: str | None = Field(default=None, max_length=1000)


@router.post("/documents/{doc_id}/review", response_model=DocumentOut)
def review_document(doc_id: uuid.UUID, body: ReviewIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise NotFound("belge bulunamadı")
    documents.review(db, doc, decision=body.decision, valid_until=body.valid_until, note=body.note,
                     reviewer_id=staff.id, ip=ip, today=local_date(now))
    db.commit()
    return doc
