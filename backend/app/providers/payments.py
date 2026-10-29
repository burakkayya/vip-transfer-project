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
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models.enums import Currency, PaymentProviderCode


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


@dataclass(frozen=True)
class RefundResult:
    ok: bool
    provider_ref: str | None = None
    error: str | None = None


class PaymentProvider(Protocol):
    code: PaymentProviderCode

    def create_checkout(self, req: CheckoutRequest) -> Checkout: ...
    def parse_callback(self, form: dict[str, str]) -> CallbackResult: ...
    def refund(self, merchant_oid: str, amount: Decimal) -> RefundResult: ...


def _b64_hmac(key: str, message: str) -> str:
    digest = hmac.new(key.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


# Webhook içerikleri maskelenerek saklanır (odeme.md).
_SENSITIVE_CALLBACK_FIELDS = {"hash", "email", "user_phone", "user_name", "user_address"}


def mask_payload(form: dict[str, str]) -> dict:
    return {k: ("***" if k in _SENSITIVE_CALLBACK_FIELDS else v) for k, v in form.items()}


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
            "merchant_ok_url": self.ok_url,
            "merchant_fail_url": self.fail_url,
            "timeout_limit": "30",
            "currency": currency,
            "test_mode": test_mode,
            "lang": "tr" if req.locale == "tr" else "en",
        }
        try:
            resp = httpx.post(f"{self.base_url}/odeme/api/get-token", data=data, timeout=20)
            body = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailable("ödeme sayfası oluşturulamadı") from exc
        if body.get("status") != "success":
            raise ServiceUnavailable(f"ödeme sayfası oluşturulamadı: {body.get('reason', '')}")
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
        )

    def refund(self, merchant_oid: str, amount: Decimal) -> RefundResult:
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
        try:
            resp = httpx.post(f"{self.base_url}/odeme/iade", data=data, timeout=20)
            body = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            return RefundResult(ok=False, error=f"bağlantı hatası: {exc.__class__.__name__}")
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
        )

    def refund(self, merchant_oid: str, amount: Decimal) -> RefundResult:
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
