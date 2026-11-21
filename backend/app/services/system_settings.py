"""Admin panelinden değiştirilebilen çalışma zamanı ayarları (system_settings tablosu)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SystemSetting
from app.models.enums import DocumentType
from app.services import audit

DEFAULTS: dict[str, Any] = {
    # Planlı rezervasyon için kalkışa en az kaç saat kala rezervasyon alınır.
    "scheduled_min_lead_hours": 2,
    # K-29: günlük kiralama ilk günün başlangıcından en az kaç saat önce alınır (sürücü planlaması için).
    "daily_min_lead_hours": 24,
    # K-79: günlük kiralama gününden önce ve sonra sürücünün başka işe başlamadan dinlenme süresi (saat).
    # Aynı rezervasyonun ardışık günleri arasında uygulanmaz. Operasyonla teyit edilecek.
    "daily_rest_hours": 9,
    # BIZ-04 (K-81): admin fiyat ezmesi sistem fiyatının yüzde kaçı ile yüzde kaçı arasında olabilir.
    # Sınır dışı tutarı yalnızca admin rolü girebilir.
    "price_override_min_percent": 50,
    "price_override_max_percent": 150,
    # Ödenmeyen rezervasyon kaç dakika sonra iptal edilir.
    "pending_payment_minutes": 30,
    "try_rounding_step": 5,
    "kvkk_disclosure_version": "1.0",
    "distance_sales_version": "1.0",
    # K-78: sürücü detayları ve araç detayları (admin ayarlardan değiştirebilir).
    "required_driver_documents": [
        DocumentType.PERSONAL_ID.value,
        DocumentType.DRIVER_LICENSE.value,
        DocumentType.CRIMINAL_RECORD.value,
        DocumentType.D2_PERMIT.value,
        DocumentType.TURSAB.value,
    ],
    "required_vehicle_documents": [
        DocumentType.VEHICLE_PHOTO_EXTERIOR.value,
        DocumentType.VEHICLE_PHOTO_FRONT.value,
        DocumentType.VEHICLE_PHOTO_REAR.value,
        DocumentType.VEHICLE_PHOTO_TRUNK.value,
        DocumentType.VEHICLE_REGISTRATION.value,
        DocumentType.VEHICLE_INSPECTION.value,
        DocumentType.VEHICLE_INSURANCE.value,
    ],
    "document_expiry_warning_days": 30,
}


def get(db: Session, key: str) -> Any:
    row = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if row is not None:
        return row.value
    if key in DEFAULTS:
        return DEFAULTS[key]
    raise KeyError(key)


def all_settings(db: Session) -> dict[str, Any]:
    values = dict(DEFAULTS)
    for row in db.scalars(select(SystemSetting)):
        values[row.key] = row.value
    return values


def put(db: Session, key: str, value: Any, actor_id: uuid.UUID, ip: str | None) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    row = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    old = row.value if row else DEFAULTS[key]
    if row is None:
        row = SystemSetting(key=key)
        db.add(row)
    row.value = value
    row.updated_by = actor_id
    audit.record(
        db,
        actor_id=actor_id,
        action="system_setting.update",
        entity_type="system_setting",
        entity_id=key,
        changes={"old": old, "new": value},
        ip=ip,
    )
