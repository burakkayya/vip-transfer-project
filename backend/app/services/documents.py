"""Sürücü ve araç belgeleri: yükleme, inceleme, sürücü onayı."""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime, timedelta

from PIL import Image, ImageOps
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, TooManyRequests
from app.models import AuditLog, Document, DocumentReview, Driver, Vehicle
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

# K-78: süresi olan belgeler son geçerlilik tarihiyle yüklenir ve onaylanır (süre takibi ve uyarı için).
EXPIRY_REQUIRED: frozenset[DocumentType] = frozenset({
    DocumentType.PERSONAL_ID,
    DocumentType.DRIVER_LICENSE,
    DocumentType.D2_PERMIT,
    DocumentType.TURSAB,
    DocumentType.VEHICLE_INSPECTION,
    DocumentType.VEHICLE_INSURANCE,
})
# K-78: araç fotoğrafları yalnızca görüntü olarak (PDF değil).
PHOTO_TYPES: frozenset[DocumentType] = frozenset({
    DocumentType.VEHICLE_PHOTO_EXTERIOR,
    DocumentType.VEHICLE_PHOTO_FRONT,
    DocumentType.VEHICLE_PHOTO_REAR,
    DocumentType.VEHICLE_PHOTO_TRUNK,
})
DRIVER_ONLY: frozenset[DocumentType] = frozenset({
    DocumentType.PERSONAL_ID, DocumentType.DRIVER_LICENSE, DocumentType.SRC, DocumentType.TURSAB,
    DocumentType.CRIMINAL_RECORD, DocumentType.D2_PERMIT,
})
# Turizm taşımacılığı yetki belgesi eskiden araç belgesiydi (K-78 öncesi); iki sahibe de yüklenebilir.
EITHER_OWNER: frozenset[DocumentType] = frozenset({DocumentType.TOURISM_PERMIT})


def owner_allowed(doc_type: DocumentType, owner_type: DocumentOwner) -> bool:
    """K-78: kişisel belge araca, araç belgesi ve fotoğrafı sürücüye yüklenmez."""
    if doc_type in EITHER_OWNER:
        return True
    return (owner_type is DocumentOwner.DRIVER) == (doc_type in DRIVER_ONLY)
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
THUMBNAIL_SIDE = 640


def thumbnail(data: bytes) -> bytes:
    """K-78: araç fotoğrafının küçük resmi (en uzun kenar 640 px, meta verisiz JPEG). Sürücü uygulamasına tam
    dosya (10 MB'a kadar) gönderilmez."""
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((THUMBNAIL_SIDE, THUMBNAIL_SIDE))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=80, optimize=True)
    return out.getvalue()
_MAGIC = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
}


def check_upload_quota(
    db: Session,
    *,
    driver: Driver,
    vehicle_ids: list[uuid.UUID],
    owner_type: DocumentOwner,
    owner_id: uuid.UUID,
    doc_type: DocumentType,
    now: datetime,
) -> None:
    """API-07: disk ve denetim tablosu şişirilmesine karşı yükleme kotası.

    - Aynı sahip ve `doc_type` için incelemede bekleyen belge varsa yenisi kabul edilmez (409). Bu ön kontroldür;
      yarışta veritabanındaki kısmi benzersiz indeks (`uq_documents_one_pending`) belirleyicidir (REV-B-7).
    - Sürücü ve aktif araçları için son `document_quota_window_days` günde yüklenen belge sayısı sınırlıdır;
      onaysız sürücünün hakkı daha dardır (429). Dosya boyutu tek tek 10 MB ile sınırlı olduğundan
      toplam boyut da adet x 10 MB ile sınırlanmış olur.
    - REV-B-7: reddedilen belgeler bu kotayı doldurmaz (operasyonun reddi sürücüyü kilitlemesin); sürücünün geri
      çektiği belgeler (silinir) denetim kaydından sayılır. Reddedilen ve geri çekilenler dahil tüm yüklemeler
      `document_quota_including_rejected` ile ayrıca sınırlıdır.
    """
    s = get_settings()
    pending = db.scalar(
        select(func.count()).select_from(Document).where(
            Document.owner_type == owner_type,
            Document.owner_id == owner_id,
            Document.doc_type == doc_type,
            Document.status == DocumentStatus.PENDING,
        )
    )
    if pending:
        raise Conflict("bu belge türü için incelemede bekleyen bir belge var", code="document_pending_exists")
    limit = s.document_quota_approved if driver.status is DriverStatus.APPROVED else s.document_quota_unapproved
    since = now - timedelta(days=s.document_quota_window_days)
    owned = (Document.owner_type == DocumentOwner.DRIVER) & (Document.owner_id == driver.id)
    if vehicle_ids:
        owned = owned | ((Document.owner_type == DocumentOwner.VEHICLE) & Document.owner_id.in_(vehicle_ids))
    counts = db.execute(
        select(func.count(), func.count().filter(Document.status == DocumentStatus.REJECTED))
        .select_from(Document).where(owned, Document.created_at > since)
    ).one()
    total, rejected = int(counts[0] or 0), int(counts[1] or 0)
    withdrawn = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.actor_id == driver.user_id, AuditLog.action == WITHDRAW_ACTION, AuditLog.created_at > since
        )
    ) or 0
    if total - rejected + withdrawn >= limit or total + withdrawn >= s.document_quota_including_rejected:
        raise TooManyRequests("belge yükleme sınırına ulaşıldı, lütfen operasyon ekibiyle iletişime geçin",
                              code="document_quota_exceeded")


WITHDRAW_ACTION = "document.withdraw"
PENDING_UNIQUE_INDEX = "uq_documents_one_pending"


def _is_pending_unique_violation(exc: IntegrityError) -> bool:
    diag = getattr(exc.orig, "diag", None)
    return getattr(diag, "constraint_name", None) == PENDING_UNIQUE_INDEX or PENDING_UNIQUE_INDEX in str(exc.orig)


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
    # K-78: belge sahibi türle uyumlu olmalı (kimlik araca, ruhsat sürücüye yüklenmez).
    if not owner_allowed(doc_type, owner_type):
        raise DomainError("bu belge türü bu sahibe yüklenemez", code="invalid_document_owner")
    if doc_type in PHOTO_TYPES and not content_type.startswith("image/"):
        raise DomainError("araç fotoğrafı JPEG veya PNG olmalı", code="photo_required")
    if doc_type in EXPIRY_REQUIRED and valid_until is None:
        raise DomainError("bu belge için son geçerlilik tarihi gerekli", code="valid_until_required")
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
    try:
        with db.begin_nested():
            db.add(doc)
            db.flush()
    except IntegrityError as exc:
        storage.delete(key)
        if _is_pending_unique_violation(exc):
            raise Conflict("bu belge türü için incelemede bekleyen bir belge var",
                           code="document_pending_exists") from exc
        raise
    audit.record(db, actor_id=actor_id, action="document.upload", entity_type="document",
                 entity_id=doc.id, changes={"doc_type": doc_type, "owner_type": owner_type})
    return doc


def withdraw(db: Session, storage: Storage, doc: Document, *, actor_id: uuid.UUID, ip: str | None) -> None:
    """REV-B-7: sürücü incelemede bekleyen kendi belgesini geri çeker (yanlış dosya, yeniden yükleme). Kayıt ve
    dosya silinir; geri çekme denetim kaydına yazılır ve yükleme kotasından sayılır. Sahiplik çağıranda denetlenir."""
    if doc.status is not DocumentStatus.PENDING:
        raise Conflict("yalnızca incelemede bekleyen belge geri çekilebilir", code="document_not_pending")
    audit.record(db, actor_id=actor_id, action=WITHDRAW_ACTION, entity_type="document", entity_id=doc.id,
                 changes={"doc_type": doc.doc_type, "owner_type": doc.owner_type}, ip=ip)
    key = doc.storage_key
    db.delete(doc)
    db.flush()
    try:
        storage.delete(key)
    except OSError:
        pass  # dosya zaten yoksa kayıt yine silinir


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
        if valid_until is None and doc.doc_type in EXPIRY_REQUIRED:
            raise DomainError("bu belge için son geçerlilik tarihi gerekli", code="valid_until_required")
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
