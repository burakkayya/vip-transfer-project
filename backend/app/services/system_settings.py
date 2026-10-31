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
    # Ödenmeyen rezervasyon kaç dakika sonra iptal edilir.
    "pending_payment_minutes": 30,
    "try_rounding_step": 5,
    "kvkk_disclosure_version": "1.0",
    "distance_sales_version": "1.0",
    # Açık konu: sürücü ve araç yetki belgelerinin listesi hukukçu ile teyit edilecek.
    "required_driver_documents": [
        DocumentType.DRIVER_LICENSE.value,
        DocumentType.SRC.value,
        DocumentType.CRIMINAL_RECORD.value,
    ],
    "required_vehicle_documents": [
        DocumentType.VEHICLE_REGISTRATION.value,
        DocumentType.VEHICLE_INSURANCE.value,
        DocumentType.VEHICLE_INSPECTION.value,
        DocumentType.TOURISM_PERMIT.value,
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
