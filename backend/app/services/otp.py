"""SMS ile tek kullanımlık kod (K-16: şifresiz hızlı üyelik)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import redis
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import DEV_ENVS, get_settings
from app.errors import TooManyRequests, Unauthorized
from app.models import OtpChallenge
from app.models.enums import OtpPurpose
from app.providers.sms import SmsSender
from app.security.crypto import blind_index
from app.services import incidents
from app.services.auth import ip_bucket

logger = logging.getLogger(__name__)

OTP_TEXT = {
    "tr": "getawaytransfers.com dogrulama kodunuz: {code}. Kimseyle paylasmayin.",
    "en": "Your getawaytransfers.com verification code: {code}. Do not share it.",
    "de": "Ihr getawaytransfers.com Bestaetigungscode: {code}. Nicht weitergeben.",
    "ru": "Vash kod getawaytransfers.com: {code}. Nikomu ne soobshchayte.",
    "es": 'Su codigo de verificacion de getawaytransfers.com: {code}. No lo comparta.',
    "fr": 'Votre code de verification getawaytransfers.com : {code}. Ne le partagez pas.',
    "it": 'Il suo codice di verifica getawaytransfers.com: {code}. Non condividerlo.',
    "pt": 'Seu codigo de verificacao getawaytransfers.com: {code}. Nao compartilhe.',
    "ar": 'رمز التحقق من getawaytransfers.com: {code}. لا تشاركه مع أحد.',
    "zh": '您的 getawaytransfers.com 验证码：{code}。请勿告诉他人。',
    "ja": 'getawaytransfers.com の認証コード：{code}。他人に教えないでください。',
    "ko": 'getawaytransfers.com 인증 코드: {code}. 타인에게 알려주지 마세요.',
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


@lru_cache
def _redis() -> redis.Redis:
    s = get_settings()
    return redis.Redis.from_url(s.redis_url, socket_timeout=s.redis_socket_timeout_seconds,
                                socket_connect_timeout=s.redis_socket_timeout_seconds)


# Redis yoksa alarm tekrarı süreç içinde bastırılır (çok süreçte süreç başına saatte bir).
_local_alarm_hours: set[str] = set()


def _alarm_slot_claimed(now: datetime) -> bool:
    """Bu saat için küresel OTP alarmını yazma hakkı (saatte bir kez). Redis SET NX; yoksa süreç içi."""
    hour = f"{now.astimezone(timezone.utc):%Y%m%d%H}"
    try:
        return bool(_redis().set(f"security:otp_global_alarm:{hour}", 1, ex=7200, nx=True))
    except redis.RedisError:
        if hour in _local_alarm_hours:
            return False
        _local_alarm_hours.clear()
        _local_alarm_hours.add(hour)
        return True


def _retry_after(db: Session, *conditions, count: int, limit: int, now: datetime) -> int:
    """Saatlik pencere sınırı aşıldığında yeniden denemeye kalan saniye: sayı sınırın altına inmesi için
    penceredeki en eski (count - limit + 1). isteğin bir saati dolmalı. Bulunamazsa bir saat."""
    since = now - timedelta(hours=1)
    nth = db.scalar(
        select(OtpChallenge.created_at)
        .where(OtpChallenge.created_at > since, *conditions)
        .order_by(OtpChallenge.created_at.asc())
        .offset(max(0, count - limit))
        .limit(1)
    )
    if nth is None:
        return 3600
    return max(1, min(3600, int((nth + timedelta(hours=1) - now).total_seconds()) + 1))


def _ip_count(db: Session, ip: str, now: datetime) -> int:
    """Son bir saatte aynı IP önekinden (ip_bucket) gelen istek sayısı."""
    since = now - timedelta(hours=1)
    bucket = ip_bucket(ip)
    if bucket == ip:  # IPv4 ya da IP olmayan değer: tam eşleşme (indeksli sorgu)
        return db.scalar(
            select(func.count(OtpChallenge.id)).where(OtpChallenge.ip == ip, OtpChallenge.created_at > since)
        )
    # IPv6: sütun metin (String(45)); önek eşleşmesi Python'da yapılır. Satır sayısı küresel sert tavanla
    # sınırlıdır; inet dönüşümü kullanılmaz (IP olmayan bir değer sorguyu hataya düşürmesin).
    rows = db.scalars(
        select(OtpChallenge.ip).where(OtpChallenge.ip.contains(":"), OtpChallenge.created_at > since)
    )
    return sum(1 for r in rows if ip_bucket(r) == bucket)


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
        raise TooManyRequests(
            "çok fazla kod istendi, lütfen daha sonra tekrar deneyin",
            retry_after=_retry_after(db, OtpChallenge.phone_hash == phone_hash, count=recent,
                                     limit=s.otp_max_per_hour, now=now),
        )
    # AUTH-04: numara değiştirerek SMS pompalamaya karşı IP başına saatlik sınır.
    # REV-A-1: IPv6 /64 önekine göre sayılır (ip_bucket); IPv4 tam adres.
    if ip:
        ip_count = _ip_count(db, ip, now)
        if ip_count >= s.otp_max_per_ip_per_hour:
            # IPv4'te kesin süre; IPv6 önekinde (Python'da sayılır) en kötü durum: bir saat.
            wait = (_retry_after(db, OtpChallenge.ip == ip, count=ip_count, limit=s.otp_max_per_ip_per_hour,
                                 now=now) if ip_bucket(ip) == ip else 3600)
            raise TooManyRequests("çok fazla kod istendi, lütfen daha sonra tekrar deneyin", retry_after=wait)
    total = db.scalar(
        select(func.count(OtpChallenge.id)).where(OtpChallenge.created_at > now - timedelta(hours=1))
    )
    # REV-A-1: küresel eşik sert ret değil alarmdır; tek bir saldırgan tüm müşteri ve sürücü girişini
    # kapatamasın. Sert ret yalnızca çok daha yüksek maliyet tavanında.
    if total >= s.otp_global_hard_limit_per_hour:
        logger.error("otp küresel sert tavanı aşıldı (%s/saat): tüm OTP istekleri reddediliyor",
                     s.otp_global_hard_limit_per_hour)
        incidents.alarm("otp_global_hard_limit", "SMS kodu küresel sert tavanı aşıldı: tüm kod istekleri reddediliyor",
                        level="critical")
        raise TooManyRequests(
            "çok fazla kod istendi, lütfen daha sonra tekrar deneyin",
            retry_after=_retry_after(db, count=total, limit=s.otp_global_hard_limit_per_hour, now=now),
        )
    if total >= s.otp_global_max_per_hour and _alarm_slot_claimed(now):
        # Saatte bir kez ERROR: log toplayıcıdaki alarm kuralı bu kaydı yakalar (ayrı Sentry yok).
        logger.error("GÜVENLİK ALARMI otp küresel saatlik eşiği aşıldı: %s istek (eşik %s, sert tavan %s); "
                     "SMS pompalama olabilir", total, s.otp_global_max_per_hour, s.otp_global_hard_limit_per_hour)
        incidents.alarm("otp_global_threshold", "SMS kodu küresel saatlik eşiği aşıldı (SMS pompalama olabilir)",
                        level="critical", context={"hourly_total": total})

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
    dev_code = code if s.env in DEV_ENVS and s.sms_provider == "console" else None
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
