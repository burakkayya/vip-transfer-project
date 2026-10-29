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
from app.models import Driver, DriverVehicleAssignment, ExchangeRate, User, Vehicle, VehicleType
from app.models.enums import DocumentOwner, DocumentType, DriverStatus, ReviewDecision, VehicleStatus
from app.providers.storage import get_storage
from app.security.crypto import blind_index
from app.services import auth, documents, system_settings

# En küçük geçerli PDF (belge yükleme imza kontrolünden geçer).
DEMO_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


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


def _driver(db: Session, d: DemoDriver, today: date) -> str:
    user = db.scalar(select(User).where(User.phone_hash == blind_index(d.phone)))
    if user and db.scalar(select(Driver).where(Driver.user_id == user.id)):
        return f"{d.name} ({d.phone}) zaten var"
    user = user or auth.get_or_create_driver_user(db, d.phone)
    driver = Driver(user_id=user.id, full_name=d.name, tursab_or_agency_no="DEMO-0001",
                    iban="TR000000000000000000000000")
    db.add(driver)
    vt = db.scalar(select(VehicleType).where(VehicleType.code == d.vehicle_type))
    vehicle = Vehicle(plate=d.plate, vehicle_type_id=vt.id, vehicle_type=vt, brand=d.brand, model=d.model,
                      year=2024, capacity=d.capacity)
    db.add(vehicle)
    db.flush()
    db.add(DriverVehicleAssignment(driver_id=driver.id, vehicle_id=vehicle.id, valid_from=datetime.now(timezone.utc)))

    valid_until = today + timedelta(days=365)
    owners = [
        (DocumentOwner.DRIVER, driver.id, system_settings.get(db, "required_driver_documents")),
        (DocumentOwner.VEHICLE, vehicle.id, system_settings.get(db, "required_vehicle_documents")),
    ]
    for owner_type, owner_id, doc_types in owners:
        for doc_type in doc_types:
            doc = documents.upload(db, get_storage(), owner_type=owner_type, owner_id=owner_id,
                                   doc_type=DocumentType(doc_type), content_type="application/pdf",
                                   data=DEMO_PDF, valid_until=valid_until, actor_id=user.id)
            documents.review(db, doc, decision=ReviewDecision.APPROVED, valid_until=valid_until,
                             note="demo", reviewer_id=user.id, ip=None, today=today)
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
