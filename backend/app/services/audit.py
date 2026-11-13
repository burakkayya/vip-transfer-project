"""Denetim kaydı. `changes` hassas alan içermez (veritabani.md); bilinen hassas
anahtarlar yazılmadan önce maskelenir."""

from __future__ import annotations

import re
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
        # DB-07: elle tahsilat/iade dekont referansı. Asıl değer ödeme/iade kaydında (`provider_ref`) durur;
        # denetim kaydında tekrarı gerekmez.
        "reference",
    }
)

# DB-07: gerekçe alanları operasyonel olarak okunmalı (force-advance, fiyat ezme, sohbet incelemesi, iptal ve
# iade gerekçesi) ve denetim kaydı değiştirilemez olduğu için silme talebinde de anonimleştirilemez. Bu yüzden
# tamamen maskelenmez: uzunluğu kırpılır, e-posta / IBAN / telefon desenleri temizlenir. Ad gibi serbest kişisel
# veri desenle yakalanamaz (kalan risk, docs/security/findings.md DB-07).
REASON_KEYS = frozenset({"reason", "override_reason", "cancel_reason"})
REASON_MAX_LENGTH = 200
_EMAIL_RE = re.compile(r"[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}")
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b")
# Rakamla başlayıp biten, aralarında boşluk/nokta/tire/parantez olabilen dizi; en az 10 rakam telefon sayılır.
_PHONE_RE = re.compile(r"\+?\(?\d[\d\s().\-/]{6,}\d")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4}")


def _phone_sub(m: re.Match) -> str:
    text = m.group(0)
    if _DATE_RE.search(text) or sum(c.isdigit() for c in text) < 10:
        return text
    return "[telefon]"


def scrub_reason(value: Any) -> Any:
    if not isinstance(value, str):
        return _clean(value)
    text = _EMAIL_RE.sub("[e-posta]", value)
    text = _IBAN_RE.sub("[iban]", text)
    text = _PHONE_RE.sub(_phone_sub, text)
    if len(text) > REASON_MAX_LENGTH:
        text = text[:REASON_MAX_LENGTH] + "…"
    return text


def _clean_item(key: Any, value: Any) -> Any:
    if key in SENSITIVE_KEYS:
        return "***"
    if key in REASON_KEYS:
        return scrub_reason(value)
    return _clean(value)


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clean_item(k, v) for k, v in value.items()}
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
