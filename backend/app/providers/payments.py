"""Ödeme sağlayıcıları (odeme.md). Kart verisi sisteme hiç gelmez; müşteri
sağlayıcının iFrame/yönlendirme sayfasında öder, sonuç sunucudan sunucuya
bildirim (callback) ile gelir.

PayTR imza formülleri PayTR iFrame API belgesine göre yazıldı. Canlıya almadan
önce test mağazasında doğrulanmalıdır (acik_konular.md, MVP çıkış kriterleri).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models.enums import Currency, PaymentProviderCode

log = logging.getLogger(__name__)

# BIZ-09: PayTR ödeme sayfasının geçerlilik süresi (timeout_limit, dakika). services.payments yeniden kullanım
# penceresini bu değerden uzun tutar; böylece aynı rezervasyon için aynı anda iki canlı sayfa olmaz.
PAYTR_TIMEOUT_LIMIT_MINUTES = 30

# API-10: sağlayıcı ayrıntısı istemciye dönmez; istemci yalnızca bu kodu görür.
PROVIDER_ERROR_CODE = "payment_provider_error"
_PROVIDER_ERROR_MESSAGE = "ödeme sayfası oluşturulamadı, lütfen biraz sonra tekrar deneyin"

_LOG_VALUE_MAX = 80


def log_safe(value: object, max_len: int = _LOG_VALUE_MAX) -> str:
    """API-11 (CWE-117): saldırgan kontrolündeki değer loga tek satır ve kısa yazılır. CR/LF, NUL, ESC gibi
    kontrol karakterleri ve Unicode satır/paragraf ayırıcıları '?' olur; uzunluk kırpılır, kırpıldıysa '…'."""
    if value is None:
        return "-"
    text = str(value)
    clipped = len(text) > max_len
    if clipped:
        text = text[: max_len - 1]
    text = "".join("?" if unicodedata.category(ch) in ("Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp") else ch
                   for ch in text)
    return text + "…" if clipped else text


# BIZ-07: PayTR bildirimindeki `currency` değerleri (TL, EUR, USD, ...) ile rezervasyon para birimi eşlemesi.
_CALLBACK_CURRENCY = {"TL": Currency.TRY, "TRY": Currency.TRY, "EUR": Currency.EUR}


def callback_currency_matches(raw: str | None, expected: Currency) -> bool:
    return _CALLBACK_CURRENCY.get((raw or "").strip().upper()) is expected


@dataclass(frozen=True)
class CheckoutRequest:
    merchant_oid: str
    amount: Decimal
    currency: Currency
    email: str
    customer_name: str
    customer_phone: str
    user_ip: str
    description: str
    locale: str
    # "tip": bahşiş ödemesi kendi dönüş sayfasına gider (rezervasyon ödeme sonucu değil).
    purpose: str = "booking"


def result_path(purpose: str) -> str:
    """Ödeme sağlayıcısının iFrame içinde döndüğü web sayfası (sonuç sunucu bildirimiyle kesinleşir)."""
    return "/booking/tip-result" if purpose == "tip" else "/booking/payment-result"


@dataclass(frozen=True)
class Checkout:
    iframe_url: str


@dataclass(frozen=True)
class CallbackResult:
    merchant_oid: str
    success: bool
    total_amount: Decimal | None
    signature_valid: bool
    failure_reason: str | None
    masked_payload: dict
    # BIZ-07: bildirimdeki para birimi (PayTR: "TL", "EUR", ...); gönderilmediyse None.
    currency: str | None = None


@dataclass(frozen=True)
class RefundResult:
    ok: bool
    provider_ref: str | None = None
    error: str | None = None
    # BIZ-03: istek sağlayıcıya ulaşmış olabilir ama sonuç alınamadı (okuma zaman aşımı, bozuk yanıt).
    # Bu durumda iade FAILED sayılmaz; kayıt belirsiz kalır ve aynı referansla sürdürülür.
    unknown: bool = False


class PaymentProvider(Protocol):
    code: PaymentProviderCode

    def create_checkout(self, req: CheckoutRequest) -> Checkout: ...
    def parse_callback(self, form: dict[str, str]) -> CallbackResult: ...
    def refund(self, merchant_oid: str, amount: Decimal, reference: str | None = None) -> RefundResult: ...


def _b64_hmac(key: str, message: str) -> str:
    digest = hmac.new(key.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


# Webhook içerikleri maskelenerek saklanır (odeme.md).
_SENSITIVE_CALLBACK_FIELDS = {"hash", "email", "user_phone", "user_name", "user_address"}
# API-06: yalnızca PayTR bildirim belgesindeki alanlar saklanır, bilinmeyen alanlar atılır ve her değer
# kırpılır; böylece büyük/çok alanlı gövdeler payment_webhooks tablosunu şişiremez.
_KNOWN_CALLBACK_FIELDS = {
    "merchant_oid", "status", "total_amount", "hash", "failed_reason_code", "failed_reason_msg",
    "test_mode", "payment_type", "currency", "payment_amount", "installment_count",
}
_CALLBACK_VALUE_MAX = 255


def mask_payload(form: dict[str, str]) -> dict:
    return {
        k: ("***" if k in _SENSITIVE_CALLBACK_FIELDS else str(v)[:_CALLBACK_VALUE_MAX])
        for k, v in form.items()
        if k in _KNOWN_CALLBACK_FIELDS
    }


_PAYTR_CURRENCY = {Currency.TRY: "TL", Currency.EUR: "EUR"}


@dataclass
class PaytrProvider:
    merchant_id: str
    merchant_key: str
    merchant_salt: str
    test_mode: bool
    ok_url: str
    fail_url: str
    code: PaymentProviderCode = PaymentProviderCode.PAYTR
    base_url: str = "https://www.paytr.com"

    @staticmethod
    def _return_url(url: str, purpose: str) -> str:
        return url.replace("/booking/payment-result", result_path(purpose), 1)

    def create_checkout(self, req: CheckoutRequest) -> Checkout:
        payment_amount = str(int((req.amount * 100).to_integral_value()))  # kuruş/cent
        basket = base64.b64encode(
            json.dumps([[req.description, f"{req.amount:.2f}", 1]]).encode()
        ).decode()
        no_installment, max_installment = "1", "0"
        currency = _PAYTR_CURRENCY[req.currency]
        test_mode = "1" if self.test_mode else "0"
        hash_str = (
            f"{self.merchant_id}{req.user_ip}{req.merchant_oid}{req.email}"
            f"{payment_amount}{basket}{no_installment}{max_installment}{currency}{test_mode}"
        )
        token = _b64_hmac(self.merchant_key, hash_str + self.merchant_salt)
        data = {
            "merchant_id": self.merchant_id,
            "user_ip": req.user_ip,
            "merchant_oid": req.merchant_oid,
            "email": req.email,
            "payment_amount": payment_amount,
            "paytr_token": token,
            "user_basket": basket,
            "debug_on": "1" if self.test_mode else "0",
            "no_installment": no_installment,
            "max_installment": max_installment,
            "user_name": req.customer_name,
            "user_address": "-",
            "user_phone": req.customer_phone,
            "merchant_ok_url": self._return_url(self.ok_url, req.purpose),
            "merchant_fail_url": self._return_url(self.fail_url, req.purpose),
            "timeout_limit": str(PAYTR_TIMEOUT_LIMIT_MINUTES),
            "currency": currency,
            "test_mode": test_mode,
            "lang": "tr" if req.locale == "tr" else "en",
        }
        try:
            resp = httpx.post(f"{self.base_url}/odeme/api/get-token", data=data, timeout=20)
            body = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("PayTR get-token isteği başarısız: oid=%s hata=%s",
                        log_safe(req.merchant_oid), type(exc).__name__)
            raise ServiceUnavailable(_PROVIDER_ERROR_MESSAGE, code=PROVIDER_ERROR_CODE) from exc
        if not isinstance(body, dict) or body.get("status") != "success" or not body.get("token"):
            # API-10: PayTR `reason` (mağaza yapılandırması ipucu) yalnızca sunucu loguna yazılır; istekte
            # kişisel veri var ama reason'da yok, yine de tek satır ve kırpılmış yazılır.
            reason = body.get("reason") if isinstance(body, dict) else "beklenmeyen yanıt"
            log.warning("PayTR ödeme sayfası oluşturulamadı: oid=%s reason=%s",
                        log_safe(req.merchant_oid), log_safe(reason, 300))
            raise ServiceUnavailable(_PROVIDER_ERROR_MESSAGE, code=PROVIDER_ERROR_CODE)
        return Checkout(iframe_url=f"{self.base_url}/odeme/guvenli/{body['token']}")

    def parse_callback(self, form: dict[str, str]) -> CallbackResult:
        oid = form.get("merchant_oid", "")
        status = form.get("status", "")
        total = form.get("total_amount", "")
        expected = _b64_hmac(self.merchant_key, f"{oid}{self.merchant_salt}{status}{total}")
        valid = hmac.compare_digest(expected, form.get("hash", ""))
        return CallbackResult(
            merchant_oid=oid,
            success=status == "success",
            # total_amount kuruş cinsindendir; taksit farkı varsa ödenen tutardan büyük olabilir.
            total_amount=(Decimal(total) / 100) if total.isdigit() else None,
            signature_valid=valid,
            failure_reason=form.get("failed_reason_msg"),
            masked_payload=mask_payload(form),
            currency=form.get("currency") or None,
        )

    def refund(self, merchant_oid: str, amount: Decimal, reference: str | None = None) -> RefundResult:
        return_amount = f"{amount:.2f}"
        token = _b64_hmac(
            self.merchant_key,
            f"{self.merchant_id}{merchant_oid}{return_amount}{self.merchant_salt}",
        )
        data = {
            "merchant_id": self.merchant_id,
            "merchant_oid": merchant_oid,
            "return_amount": return_amount,
            "paytr_token": token,
        }
        if reference:
            # BIZ-03: iade kaydına özel benzersiz referans; tekrar denemede aynısı gönderilir.
            # PayTR'nin isteğe bağlı `reference_no` alanı (belgeye göre; test mağazasında doğrulanmalı).
            data["reference_no"] = reference
        try:
            resp = httpx.post(f"{self.base_url}/odeme/iade", data=data, timeout=20)
            body = resp.json()
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            # Bağlantı kurulamadı: istek PayTR'ye ulaşmadı, iade yapılmamıştır.
            return RefundResult(ok=False, error=f"bağlantı hatası: {exc.__class__.__name__}")
        except (httpx.HTTPError, ValueError) as exc:
            # İstek gitmiş olabilir (okuma zaman aşımı, kopan bağlantı, bozuk yanıt): sonuç belirsiz.
            return RefundResult(ok=False, unknown=True, error=f"yanıt alınamadı: {exc.__class__.__name__}")
        if not isinstance(body, dict):
            return RefundResult(ok=False, unknown=True, error="beklenmeyen yanıt")
        if body.get("status") == "success":
            return RefundResult(ok=True, provider_ref=body.get("reference_no"))
        return RefundResult(ok=False, error=f"{body.get('err_no', '')} {body.get('err_msg', '')}")


@dataclass
class FakeProvider:
    """Geliştirme ve test. Ödeme sayfası yerine API'deki sahte onay ucunu kullanır."""

    secret: str
    public_api_url: str
    code: PaymentProviderCode = PaymentProviderCode.FAKE
    fail_refunds: bool = False

    def sign(self, oid: str, status: str, total: str) -> str:
        return _b64_hmac(self.secret, f"{oid}{status}{total}")

    def create_checkout(self, req: CheckoutRequest) -> Checkout:
        return Checkout(iframe_url=f"{self.public_api_url}/api/v1/payments/fake/{req.merchant_oid}")

    def parse_callback(self, form: dict[str, str]) -> CallbackResult:
        oid, status, total = form.get("merchant_oid", ""), form.get("status", ""), form.get("total_amount", "")
        valid = hmac.compare_digest(self.sign(oid, status, total), form.get("hash", ""))
        return CallbackResult(
            merchant_oid=oid,
            success=status == "success",
            total_amount=(Decimal(total) / 100) if total.isdigit() else None,
            signature_valid=valid,
            failure_reason=form.get("failed_reason_msg"),
            masked_payload=mask_payload(form),
            currency=form.get("currency") or None,
        )

    def refund(self, merchant_oid: str, amount: Decimal, reference: str | None = None) -> RefundResult:
        if self.fail_refunds:
            return RefundResult(ok=False, error="sahte iade hatası")
        return RefundResult(ok=True, provider_ref=f"fake-refund-{merchant_oid}")


@lru_cache
def get_payment_provider() -> PaymentProvider:
    s = get_settings()
    if s.payment_provider == "paytr":
        return PaytrProvider(
            merchant_id=s.paytr_merchant_id,
            merchant_key=s.paytr_merchant_key,
            merchant_salt=s.paytr_merchant_salt,
            test_mode=s.paytr_test_mode,
            ok_url=f"{s.public_web_url}/booking/payment-result?status=ok",
            fail_url=f"{s.public_web_url}/booking/payment-result?status=fail",
        )
    if s.payment_provider == "fake":
        return FakeProvider(secret=s.jwt_secret, public_api_url="http://localhost:8000")
    # iyzico yedek sağlayıcısı: para birimi desteği teyit edilince eklenecek (acik_konular.md).
    raise RuntimeError(f"desteklenmeyen ödeme sağlayıcısı: {s.payment_provider}")
