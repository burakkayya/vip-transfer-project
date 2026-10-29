"""SMS ile tek kullanımlık kod (K-16: şifresiz hızlı üyelik)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import TooManyRequests, Unauthorized
from app.models import OtpChallenge
from app.models.enums import OtpPurpose
from app.providers.sms import SmsSender
from app.security.crypto import blind_index

OTP_TEXT = {
    "tr": "getawaytransfers.com dogrulama kodunuz: {code}. Kimseyle paylasmayin.",
    "en": "Your getawaytransfers.com verification code: {code}. Do not share it.",
    "de": "Ihr getawaytransfers.com Bestaetigungscode: {code}. Nicht weitergeben.",
    "ru": "Vash kod getawaytransfers.com: {code}. Nikomu ne soobshchayte.",
}


@dataclass(frozen=True)
class OtpIssued:
    challenge_id: uuid.UUID
    expires_at: datetime
    # Yalnızca geliştirmede (konsol SMS): kodun ekranda gösterilmesi için. Üretimde her zaman None.
    dev_code: str | None = None


def _code_hash(challenge_id: uuid.UUID, code: str) -> str:
    key = get_settings().blind_index_key.encode()
    return hmac.new(key, f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()


def request_code(
    db: Session,
    sms: SmsSender,
    *,
    phone: str,
    purpose: OtpPurpose,
    locale: str,
    ip: str | None,
    now: datetime | None = None,
) -> OtpIssued:
    s = get_settings()
    now = now or datetime.now(timezone.utc)
    phone_hash = blind_index(phone)
    recent = db.scalar(
        select(func.count(OtpChallenge.id)).where(
            OtpChallenge.phone_hash == phone_hash,
            OtpChallenge.created_at > now - timedelta(hours=1),
        )
    )
    if recent >= s.otp_max_per_hour:
        raise TooManyRequests("çok fazla kod istendi, lütfen daha sonra tekrar deneyin")

    code = f"{secrets.randbelow(10 ** s.otp_length):0{s.otp_length}d}"
    challenge = OtpChallenge(
        id=uuid.uuid4(),
        phone_hash=phone_hash,
        purpose=purpose,
        expires_at=now + timedelta(seconds=s.otp_ttl_seconds),
        ip=ip,
        created_at=now,
    )
    challenge.code_hash = _code_hash(challenge.id, code)
    db.add(challenge)
    db.flush()
    sms.send(phone, OTP_TEXT.get(locale, OTP_TEXT["en"]).format(code=code))
    dev_code = code if s.env != "prod" and s.sms_provider == "console" else None
    return OtpIssued(challenge_id=challenge.id, expires_at=challenge.expires_at, dev_code=dev_code)


def verify_code(
    db: Session,
    *,
    phone: str,
    purpose: OtpPurpose,
    code: str,
    now: datetime | None = None,
) -> None:
    """Başarısızsa Unauthorized. Deneme sayısı her durumda kaydedilir (commit çağırana ait)."""
    s = get_settings()
    now = now or datetime.now(timezone.utc)
    challenge = db.scalar(
        select(OtpChallenge)
        .where(
            OtpChallenge.phone_hash == blind_index(phone),
            OtpChallenge.purpose == purpose,
            OtpChallenge.consumed_at.is_(None),
            OtpChallenge.expires_at > now,
        )
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if challenge is None or challenge.attempts >= s.otp_max_attempts:
        raise Unauthorized("kod geçersiz veya süresi dolmuş", code="otp_invalid")
    challenge.attempts += 1
    if not hmac.compare_digest(challenge.code_hash, _code_hash(challenge.id, code)):
        raise Unauthorized("kod hatalı", code="otp_invalid")
    challenge.consumed_at = now
