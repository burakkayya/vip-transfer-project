"""JWT erişim jetonları ve opak yenileme jetonları.

Erişim jetonu kısa ömürlü JWT'dir ve oturum kimliği (sid) taşır; oturum iptal
edilince jeton da geçersiz olur. Yenileme jetonu rastgele üretilir, veritabanında
yalnızca SHA-256 özeti tutulur ve her kullanımda yenilenir (rotation).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.config import get_settings

ALGORITHM = "HS256"


class TokenError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, kind: str) -> str:
    s = get_settings()
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "kind": kind,
        "typ": "access",
        "iat": _now(),
        "exp": _now() + timedelta(minutes=s.jwt_access_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def create_mfa_token(user_id: uuid.UUID, purpose: str) -> str:
    """Parola doğrulandıktan sonra 2FA adımına geçiş için kısa ömürlü jeton."""
    s = get_settings()
    payload = {
        "sub": str(user_id),
        "typ": purpose,  # mfa | mfa_setup
        "iat": _now(),
        "exp": _now() + timedelta(minutes=s.jwt_mfa_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError("geçersiz veya süresi dolmuş jeton") from exc
    if payload.get("typ") != expected_type:
        raise TokenError("jeton türü uyuşmuyor")
    return payload


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
