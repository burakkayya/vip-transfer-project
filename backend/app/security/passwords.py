"""Argon2 ile parola özeti (yalnızca admin kullanıcılar; müşteri ve sürücü OTP kullanır)."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

MIN_PASSWORD_LENGTH = 12


def hash_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"parola en az {MIN_PASSWORD_LENGTH} karakter olmalı")
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        # Zamanlama farkıyla kullanıcı varlığı sızmasın diye yine de özet hesapla.
        _hasher.hash(password)
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False
