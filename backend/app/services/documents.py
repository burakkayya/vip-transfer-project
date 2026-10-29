"""Sürücü ve araç belgeleri: yükleme, inceleme, sürücü onayı."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.errors import Conflict, DomainError
from app.models import Document, DocumentReview, Driver, Vehicle
from app.models.enums import (
    DocumentOwner,
    DocumentStatus,
    DocumentType,
    DriverStatus,
    ReviewDecision,
    VehicleStatus,
)
from app.providers.storage import Storage
from app.services import audit
from app.services.dispatch import missing_documents

ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
_MAGIC = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
}


def upload(
    db: Session,
    storage: Storage,
    *,
    owner_type: DocumentOwner,
    owner_id: uuid.UUID,
    doc_type: DocumentType,
    content_type: str,
    data: bytes,
    valid_until: date | None,
    actor_id: uuid.UUID,
) -> Document:
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise DomainError("yalnızca PDF, JPEG veya PNG yüklenebilir", code="invalid_file_type")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DomainError("dosya en fazla 10 MB olabilir", code="file_too_large")
    if not data.startswith(_MAGIC[content_type]):
        raise DomainError("dosya içeriği türüyle uyuşmuyor", code="invalid_file_type")
    key = storage.put(f"{owner_type.value}/{owner_id}", data)
    doc = Document(
        owner_type=owner_type,
        owner_id=owner_id,
        doc_type=doc_type,
        storage_key=key,
        content_type=content_type,
        valid_until=valid_until,
    )
    db.add(doc)
    db.flush()
    audit.record(db, actor_id=actor_id, action="document.upload", entity_type="document",
                 entity_id=doc.id, changes={"doc_type": doc_type, "owner_type": owner_type})
    return doc


def review(
    db: Session,
    doc: Document,
    *,
    decision: ReviewDecision,
    valid_until: date | None,
    note: str | None,
    reviewer_id: uuid.UUID,
    ip: str | None,
    today: date,
) -> None:
    if doc.status is not DocumentStatus.PENDING:
        raise Conflict("belge zaten incelendi", code="already_reviewed")
    if decision is ReviewDecision.APPROVED:
        valid_until = valid_until or doc.valid_until
        if valid_until is not None and valid_until < today:
            raise DomainError("geçerlilik tarihi geçmiş belge onaylanamaz", code="document_expired")
        doc.valid_until = valid_until
        doc.status = DocumentStatus.APPROVED
    else:
        if not note:
            raise DomainError("ret için açıklama gerekli", code="note_required")
        doc.status = DocumentStatus.REJECTED
    db.add(DocumentReview(document_id=doc.id, reviewer_id=reviewer_id, decision=decision, note=note))
    audit.record(db, actor_id=reviewer_id, action="document.review", entity_type="document",
                 entity_id=doc.id, changes={"decision": decision, "valid_until": doc.valid_until}, ip=ip)


def set_driver_status(
    db: Session,
    driver: Driver,
    status: DriverStatus,
    *,
    actor_id: uuid.UUID,
    reason: str | None,
    ip: str | None,
    today: date,
) -> None:
    if status is DriverStatus.APPROVED:
        missing = missing_documents(db, DocumentOwner.DRIVER, driver.id, today)
        if missing:
            raise Conflict("eksik veya onaysız belgeler var", code="documents_missing", details=missing)
    old = driver.status
    driver.status = status
    if status is not DriverStatus.APPROVED:
        driver.is_online = False
    audit.record(db, actor_id=actor_id, action="driver.status", entity_type="driver",
                 entity_id=driver.id, changes={"old": old, "new": status, "reason": reason}, ip=ip)


def set_vehicle_status(
    db: Session,
    vehicle: Vehicle,
    status: VehicleStatus,
    *,
    actor_id: uuid.UUID,
    ip: str | None,
    today: date,
) -> None:
    if status is VehicleStatus.ACTIVE:
        missing = missing_documents(db, DocumentOwner.VEHICLE, vehicle.id, today)
        if missing:
            raise Conflict("eksik veya onaysız araç belgeleri var", code="documents_missing", details=missing)
    old = vehicle.status
    vehicle.status = status
    audit.record(db, actor_id=actor_id, action="vehicle.status", entity_type="vehicle",
                 entity_id=vehicle.id, changes={"old": old, "new": status}, ip=ip)


def is_expiring(doc: Document, today: date, warning_days: int) -> bool:
    return (
        doc.valid_until is not None
        and doc.status is DocumentStatus.APPROVED
        and (doc.valid_until - today).days <= warning_days
    )
