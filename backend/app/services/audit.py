"""Denetim kaydı. `changes` hassas alan içermez (veritabani.md); bilinen hassas
anahtarlar yazılmadan önce maskelenir."""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog

SENSITIVE_KEYS = frozenset(
    {
        "phone",
        "email",
        "password",
        "password_hash",
        "two_factor_secret",
        "full_name",
        "passenger_name",
        "storage_key",
        "iban",
        "address",
        "pickup_address",
        "dropoff_address",
        "note",
        "token",
        "code",
    }
)


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("***" if k in SENSITIVE_KEYS else _clean(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def record(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    changes: dict | None = None,
    ip: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            changes=_clean(changes) if changes else None,
            ip=ip,
        )
    )
