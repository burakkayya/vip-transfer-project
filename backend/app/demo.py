"""Geliştirme demo verisi: ekrandan uçtan uca test için hazır sürücüler (docs/test_senaryolari.md).

Üretimde çalışmaz. Tekrar çalıştırılabilir; var olan kayıtlar atlanır.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.localtime import local_date
from app.models import Document, Driver, DriverVehicleAssignment, ExchangeRate, User, Vehicle, VehicleType
from app.models.enums import DocumentOwner, DocumentStatus, DocumentType, DriverStatus, ReviewDecision, VehicleStatus
from app.providers.storage import get_storage
from app.security.crypto import blind_index
from app.services import auth, documents, system_settings

# En küçük geçerli PDF (belge yükleme imza kontrolünden geçer).
DEMO_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
# K-78 araç fotoğrafları görüntü olmalı: 1x1 PNG.
DEMO_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
    "0000000c49444154789c631011110100007c003d928027db0000000049454e44ae426082"
)


@dataclass(frozen=True)
class DemoDriver:
    phone: str
    name: str
    plate: str
    vehicle_type: str
    brand: str
    model: str
    capacity: int


DEMO_DRIVERS = [
    DemoDriver("+905300000001", "Mehmet Demir", "07GA001", "minivan", "Mercedes-Benz", "Vito Tourer", 6),
    DemoDriver("+905300000002", "Ayşe Kaya", "48GA002", "vip_van", "Mercedes-Benz", "V 300 d", 6),
]


def _complete_documents(db: Session, user: User, owner_type: DocumentOwner, owner_id, setting: str, today: date) -> int:
    """Zorunlu listede olup onaylı belgesi olmayan türleri demo dosyasıyla yükleyip onaylar (K-78 sonrası eski
    demo sürücüler de iş alabilsin)."""
    valid_until = today + timedelta(days=365)
    added = 0
    for doc_type in system_settings.get(db, setting):
        dtype = DocumentType(doc_type)
        approved = db.scalar(select(Document.id).where(
            Document.owner_type == owner_type, Document.owner_id == owner_id, Document.doc_type == dtype,
            Document.status == DocumentStatus.APPROVED).limit(1))
        if approved:
            continue
        photo = dtype in documents.PHOTO_TYPES
        doc = documents.upload(db, get_storage(), owner_type=owner_type, owner_id=owner_id, doc_type=dtype,
                               content_type="image/png" if photo else "application/pdf",
                               data=DEMO_PNG if photo else DEMO_PDF, valid_until=valid_until, actor_id=user.id)
        documents.review(db, doc, decision=ReviewDecision.APPROVED, valid_until=valid_until,
                         note="demo", reviewer_id=user.id, ip=None, today=today)
        added += 1
    return added


def _driver(db: Session, d: DemoDriver, today: date) -> str:
    user = db.scalar(select(User).where(User.phone_hash == blind_index(d.phone)))
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id)) if user else None
    if driver is not None:
        vehicle = db.scalar(select(Vehicle).where(Vehicle.plate == d.plate))
        added = _complete_documents(db, user, DocumentOwner.DRIVER, driver.id, "required_driver_documents", today)
        if vehicle is not None:
            added += _complete_documents(db, user, DocumentOwner.VEHICLE, vehicle.id, "required_vehicle_documents", today)
        return f"{d.name} ({d.phone}) zaten var" + (f", {added} eksik belge tamamlandı" if added else "")
    user = user or auth.get_or_create_driver_user(db, d.phone)
    driver = Driver(user_id=user.id, full_name=d.name, tursab_or_agency_no="DEMO-0001",
                    iban="TR000000000000000000000000", operating_province="antalya")
    db.add(driver)
    vt = db.scalar(select(VehicleType).where(VehicleType.code == d.vehicle_type))
    vehicle = Vehicle(plate=d.plate, vehicle_type_id=vt.id, vehicle_type=vt, brand=d.brand, model=d.model,
                      year=2024, capacity=d.capacity)
    db.add(vehicle)
    db.flush()
    db.add(DriverVehicleAssignment(driver_id=driver.id, vehicle_id=vehicle.id, valid_from=datetime.now(timezone.utc)))
    _complete_documents(db, user, DocumentOwner.DRIVER, driver.id, "required_driver_documents", today)
    _complete_documents(db, user, DocumentOwner.VEHICLE, vehicle.id, "required_vehicle_documents", today)
    vehicle.status = VehicleStatus.ACTIVE
    driver.status = DriverStatus.APPROVED
    return f"{d.name} ({d.phone}) oluşturuldu: {d.vehicle_type}, {d.plate}"


def run(db: Session) -> list[str]:
    if get_settings().env == "prod":
        raise RuntimeError("demo verisi üretimde yüklenemez")
    today = local_date(datetime.now(timezone.utc))
    out = [_driver(db, d, today) for d in DEMO_DRIVERS]
    if db.scalar(select(ExchangeRate).limit(1)) is None:
        db.add(ExchangeRate(rate=Decimal("36.5000"), source="demo", valid_from=datetime.now(timezone.utc) - timedelta(days=1)))
        out.append("EUR/TRY kuru eklendi: 36,50")
    return out
