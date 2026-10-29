"""Alan düzeyi şifreleme ve kör indeks (blind index).

Telefon, e-posta, belge yolu ve 2FA sırrı veritabanında şifreli tutulur
(yasal_ve_guvenlik.md). Şifreli alanda arama yapılamadığı için, arama gereken
alanlara ayrıca HMAC tabanlı kör indeks sütunu eklenir (örn. users.phone_hash).
"""

from __future__ import annotations

import hashlib
import hmac
import re
from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy import String, Text
from sqlalchemy.types import TypeDecorator

from app.config import get_settings

_PHONE_CLEAN = re.compile(r"[\s\-().]")
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


@lru_cache
def _fernet() -> MultiFernet:
    keys = [k.strip() for k in get_settings().field_encryption_keys.split(",") if k.strip()]
    return MultiFernet([Fernet(k.encode()) for k in keys])


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(data: bytes) -> bytes:
    return _fernet().decrypt(data)


def blind_index(value: str) -> str:
    key = get_settings().blind_index_key.encode()
    return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()


def normalize_phone(raw: str) -> str:
    """Telefonu E.164 biçimine getirir (+905321234567). Geçersizse ValueError."""
    phone = _PHONE_CLEAN.sub("", raw)
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    if not _E164.match(phone):
        raise ValueError("telefon numarası uluslararası biçimde olmalı (+90...)")
    return phone


def normalize_email(raw: str) -> str:
    return raw.strip().lower()


def mask_phone(phone: str) -> str:
    """+905321234567 -> +90532***4567"""
    if len(phone) < 8:
        return "***"
    return phone[:6] + "***" + phone[-4:]


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    return (local[:1] + "***@" + domain) if local else "***@" + domain


class EncryptedString(TypeDecorator):
    """Python tarafında düz metin, veritabanında Fernet şifreli metin."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return decrypt(value)


BlindIndex = String(64)
