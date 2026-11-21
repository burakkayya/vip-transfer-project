"""Ödeme başlatma ve sağlayıcı bildirimlerinin işlenmesi (odeme.md)."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import redis
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, NotFound
from app.models import Booking, Customer, Invoice, Payment, PaymentWebhook, Refund
from app.models.enums import (
    BookingSource,
    BookingStatus,
    BookingType,
    ManualPaymentMethod,
    PaymentProviderCode,
    PaymentStatus,
    RefundStatus,
)
from app.providers.payments import (
    PAYTR_TIMEOUT_LIMIT_MINUTES,
    Checkout,
    CheckoutRequest,
    PaymentProvider,
    callback_currency_matches,
    log_safe,
)
from app.services import audit, dispatch, notifications, ratings
from app.services.bookings import execute_refund

log = logging.getLogger(__name__)

# PayTR ödeme sayfası PAYTR_TIMEOUT_LIMIT_MINUTES (30) dakika geçerli. BIZ-09: açık ödeme bu süreden UZUN bir pencere
# boyunca yeniden kullanılır; yeni sayfa ancak eskisi PayTR'de kesin olarak kapandıktan sonra açılır. Böylece bir
# rezervasyonun aynı anda yalnızca bir canlı ödeme sayfası olur ve ikinci tahsilat açılmaz (K-46). Bedeli: son
# 1 dakikada dönen sayfa süresi dolmuş olabilir; müşteri bir dakika sonra yeniden denediğinde yeni sayfa alır.
CHECKOUT_REUSE_WINDOW = timedelta(minutes=PAYTR_TIMEOUT_LIMIT_MINUTES + 1)


# REV-C-1: imzası geçerli "başarılı" bildirim tutar ya da para birimi denetimine takılırsa PayTR tarafında kart
# çekilmiş olabilir. Ödeme FAILED olur ama `failure_reason` bu değerlerden birini taşır.
# K-74: çekilen tutar aynı bildirimde otomatik iade edilir (`_refund_rejected_charge`). İade tamamlanana kadar
# rezervasyon "incelemede" sayılır: yeni ödeme sayfası açılmaz (ikinci tahsilat olmaz) ve ödeme süresi dolsa da
# otomatik iptal edilmez (jobs.cancel_unpaid_bookings). İade başarısız ya da belirsizse muhasebe yeniden dener;
# admin PayTR panelinden yapılan iadeyi doğrulayıp `mark-completed` ile kapatır; rezervasyon normal akışa döner.
REJECT_NO_TOTAL = "tahsilat tutarı bildirilmedi"
REJECT_UNDERPAID = "eksik tahsilat"
REJECT_CURRENCY = "para birimi uyuşmuyor"
CALLBACK_REJECT_REASONS = (REJECT_NO_TOTAL, REJECT_UNDERPAID, REJECT_CURRENCY)


def rejected_charge_filter():
    """İadesi henüz tamamlanmamış, reddedilmiş başarılı bildirimi olan ödeme satırları için SQL koşulu."""
    refunded = exists().where(Refund.payment_id == Payment.id, Refund.status == RefundStatus.COMPLETED)
    return (
        (Payment.purpose == "booking")  # K-62 bahşiş reddi rezervasyonu incelemeye almaz (iadesi yine yapılır)
        & (Payment.status == PaymentStatus.FAILED)
        & Payment.failure_reason.in_(CALLBACK_REJECT_REASONS)
        & ~refunded
    )


def has_rejected_charge(db: Session, booking_id) -> bool:
    return db.scalar(
        select(Payment.id).where(Payment.booking_id == booking_id, rejected_charge_filter()).limit(1)
    ) is not None


def _open_payment(db: Session, booking: Booking, now: datetime) -> Payment | None:
    return db.scalar(
        select(Payment)
        .where(
            Payment.booking_id == booking.id,
            Payment.purpose == "booking",
            Payment.status == PaymentStatus.PENDING,
            Payment.checkout_url.is_not(None),
            Payment.amount == booking.total_amount,
            Payment.currency == booking.currency,
            Payment.created_at > now - CHECKOUT_REUSE_WINDOW,
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )


def start_payment(
    db: Session,
    booking: Booking,
    customer: Customer,
    provider: PaymentProvider,
    *,
    user_ip: str,
    now: datetime | None = None,
) -> tuple[Payment, Checkout]:
    # Aynı rezervasyon için eşzamanlı başlatma istekleri sıraya girer (çift tıklama, yeniden deneme).
    db.get(Booking, booking.id, with_for_update={"of": Booking}, populate_existing=True)
    if booking.status is not BookingStatus.PENDING_PAYMENT:
        raise Conflict("bu rezervasyon için ödeme beklenmiyor", code="payment_not_expected")
    if has_rejected_charge(db, booking.id):
        raise Conflict("ödemeniz inceleniyor, lütfen destekle iletişime geçin", code="payment_under_review")
    now = now or datetime.now(timezone.utc)
    existing = _open_payment(db, booking, now)
    if existing is not None:
        return existing, Checkout(iframe_url=existing.checkout_url)
    payment = Payment(
        booking_id=booking.id,
        provider=provider.code,
        # PayTR merchant_oid yalnızca harf ve rakam kabul eder.
        merchant_oid=f"{booking.booking_code}{secrets.token_hex(4).upper()}",
        amount=booking.total_amount,
        currency=booking.currency,
    )
    db.add(payment)
    db.flush()
    checkout = provider.create_checkout(
        CheckoutRequest(
            merchant_oid=payment.merchant_oid,
            amount=payment.amount,
            currency=payment.currency,
            # Sağlayıcı e-posta ister; müşteri vermediyse rezervasyona özel adres kullanılır.
            email=customer.email or f"{booking.booking_code.lower()}@musteri.getawaytransfers.com",
            customer_name=booking.passenger_name,
            customer_phone=customer.user.phone or "",
            user_ip=user_ip,
            description=f"Transfer {booking.booking_code}",
            locale=booking.locale,
        )
    )
    payment.checkout_url = checkout.iframe_url
    return payment, checkout


# Geçersiz imza denetim kaydı örneklemesi: IP başına dakikada ve küresel dakikalık üst sınır.
INVALID_SIG_AUDIT_PER_IP = 3
INVALID_SIG_AUDIT_GLOBAL = 50


def _invalid_signature_sample(ip: str | None, now: datetime) -> tuple[bool, int | None]:
    """Geçersiz imza sayacı (API-06, MON-08). Dakikalık küresel sayaç alarm için tutulur (F2-4).
    Denetim kaydı örneklenir: IP başına dakikada ilk birkaç olay ve küresel üst sınır; böylece
    sahte bildirim seli değiştirilemez denetim tablosunu da şişiremez. Redis yoksa kayıt yazılır."""
    minute = now.strftime("%Y%m%d%H%M")
    try:
        r = redis.Redis.from_url(get_settings().redis_url, socket_timeout=1, socket_connect_timeout=1)
        pipe = r.pipeline()
        total_key = f"security:webhook_invalid:total:{minute}"
        ip_key = f"security:webhook_invalid:ip:{ip or '-'}:{minute}"
        pipe.incr(total_key)
        pipe.expire(total_key, 3600)
        pipe.incr(ip_key)
        pipe.expire(ip_key, 120)
        total, _, per_ip, _ = pipe.execute()
    except redis.RedisError:
        return True, None
    return per_ip <= INVALID_SIG_AUDIT_PER_IP and total <= INVALID_SIG_AUDIT_GLOBAL, int(total)


def handle_callback(
    db: Session, provider: PaymentProvider, form: dict[str, str], now: datetime, ip: str | None = None
) -> None:
    """Bildirim imzası geçersizse DomainError. Aynı bildirim birden çok gelirse tekrar işlenmez."""
    result = provider.parse_callback(form)
    if not result.signature_valid:
        # API-06: geçersiz imzalı istek payment_webhooks'a yazılmaz; sayaç, özet log ve (örneklenmiş)
        # security.* denetim kaydı tutulur (MON-08).
        oid = (result.merchant_oid or "")[:64]
        audit_it, count = _invalid_signature_sample(ip, now)
        # API-11: oid ve ip saldırgan kontrolünde; tek satır, kontrol karakterleri temizlenmiş ve kırpılmış.
        log.warning("geçersiz imzalı ödeme bildirimi: provider=%s oid=%s ip=%s alan=%d dakikalık=%s",
                    provider.code.value, log_safe(oid), log_safe(ip, 64), len(form), count)
        if audit_it:
            audit.record(db, actor_id=None, action="security.webhook.invalid_signature",
                         entity_type="payment_webhook", entity_id=oid or None,
                         changes={"provider": provider.code.value, "merchant_oid": oid,
                                  "field_count": len(form), "minute_count": count}, ip=ip)
            db.commit()
        raise DomainError("imza doğrulanamadı", code="invalid_signature")

    hook = PaymentWebhook(
        provider=provider.code,
        event_type="payment_" + ("success" if result.success else "failed"),
        merchant_oid=result.merchant_oid[:64] or None,
        raw_payload=result.masked_payload,
        signature_valid=True,
    )
    db.add(hook)

    payment = db.scalar(
        select(Payment).where(Payment.merchant_oid == result.merchant_oid).with_for_update()
    )
    if payment is None:
        db.commit()
        raise NotFound("ödeme bulunamadı")
    hook.processed_at = now
    if payment.status is not PaymentStatus.PENDING:
        return  # zaten işlendi

    if payment.purpose == "tip":
        _tip_callback(db, payment, provider, result, now)
        return

    booking = db.get(Booking, payment.booking_id, with_for_update={"of": Booking})
    if not result.success:
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = (result.failure_reason or "")[:255]
        return

    # BIZ-07: imza geçerli olsa da tutar ve para birimi rezervasyonla doğrulanmadan ödeme onaylanmaz.
    # Reddedilen bildirim yine işlenmiş sayılır (PayTR'ye "OK" döner, tekrar göndermez); ödeme FAILED olur ve
    # çekilen tutar otomatik iade edilir (K-74).
    reject = _reject_reason(result, payment)
    if reject is not None:
        _reject_charge(db, payment, provider, result, reject)
        return

    payment.status = PaymentStatus.PAID
    payment.paid_at = now
    audit.record(db, actor_id=None, action="payment.paid", entity_type="payment",
                 entity_id=payment.id, changes={"amount": payment.amount, "currency": payment.currency})

    if booking.status is not BookingStatus.PENDING_PAYMENT:
        # Rezervasyon bu arada iptal edildiyse (ör. ödeme süresi doldu) tamamı iade edilir.
        refund = Refund(payment_id=payment.id, amount=payment.amount,
                        reason="geç gelen ödeme, rezervasyon aktif değil", refund_percent=100)
        db.add(refund)
        db.flush()
        execute_refund(db, refund, payment, provider)
        return

    confirm_paid_booking(db, booking, now)


def _reject_reason(result, payment: Payment) -> str | None:
    """BIZ-07: imzası geçerli başarılı bildirimin tutar ve para birimi denetimi; uygunsa None."""
    if result.total_amount is None:
        return REJECT_NO_TOTAL
    if result.total_amount < payment.amount:
        return REJECT_UNDERPAID
    if result.currency is not None and not callback_currency_matches(result.currency, payment.currency):
        return REJECT_CURRENCY
    return None


def _reject_charge(db: Session, payment: Payment, provider: PaymentProvider, result, reject: str) -> None:
    """Reddedilen başarılı bildirim: ödeme FAILED, alarm logu, denetim kaydı ve otomatik iade (K-74).
    Log satırında yalnızca bizim ürettiğimiz oid ve tutar var."""
    payment.status = PaymentStatus.FAILED
    payment.failure_reason = reject
    log.error("GÜVENLİK ALARMI ödeme bildirimi reddedildi, kart çekilmiş olabilir; otomatik iade "
              "başlatılıyor (%s): oid=%s amaç=%s tutar=%s/%s para=%s/%s", reject,
              log_safe(payment.merchant_oid), payment.purpose, result.total_amount, payment.amount,
              log_safe(result.currency, 8), payment.currency.value)
    audit.record(db, actor_id=None, action="payment.callback_rejected", entity_type="payment",
                 entity_id=payment.id,
                 changes={"reason": reject, "reported_total": result.total_amount, "amount": payment.amount,
                          "reported_currency": log_safe(result.currency, 8), "currency": payment.currency,
                          "purpose": payment.purpose})
    _refund_rejected_charge(db, payment, provider, reject=reject, reported_total=result.total_amount,
                            reported_currency=result.currency)


def _refund_rejected_charge(
    db: Session,
    payment: Payment,
    provider: PaymentProvider,
    *,
    reject: str,
    reported_total: Decimal | None,
    reported_currency: str | None,
) -> Refund:
    """K-74: reddedilen başarılı bildirimde çekilen tutar otomatik iade edilir.

    Tutar ödemenin para biriminde (PayTR `return_amount` sipariş para biriminde yorumlanır):
    - eksik tahsilat: bildirilen çekilen tutar (sipariş tutarından küçük);
    - tutar bildirilmedi ya da para birimi uyuşmuyor: sipariş tutarı (`payment.amount`). Bildirilen tutar
      başka para biriminde olabilir, karşılaştırılamaz; sipariş tutarından fazlası iade edilmez.
    Ödeme FAILED kalır: hiç kabul edilmedi, ödenmiş sayılmaz. Sonuç başarısız ya da belirsizse rezervasyon
    incelemede kalır; muhasebe yeniden dener ya da admin PayTR panelindeki iadeyi doğrulayıp kapatır."""
    if reject == REJECT_UNDERPAID and reported_total is not None and 0 < reported_total < payment.amount:
        amount = reported_total
    else:
        amount = payment.amount
    amount = amount.quantize(Decimal("0.01"))
    note = f"otomatik iade: reddedilen ödeme bildirimi ({reject})"
    refund = Refund(payment_id=payment.id, amount=amount, reason=note[:255], refund_percent=100)
    db.add(refund)
    db.flush()
    refund_id = refund.id
    execute_refund(db, refund, payment, provider)
    audit.record(db, actor_id=None, action="payment.auto_refund", entity_type="refund", entity_id=refund_id,
                 changes={"payment_id": payment.id, "amount": amount, "currency": payment.currency,
                          "reported_total": reported_total, "reported_currency": log_safe(reported_currency, 8),
                          "status": refund.status.value, "reason": reject})
    db.commit()
    return refund


def _tip_callback(db: Session, payment: Payment, provider: PaymentProvider, result, now: datetime) -> None:
    """K-62 bahşiş: rezervasyon durumundan bağımsızdır; ödendiyse sürücü hakedişine eklenir.
    BIZ-07 ve K-74 bahşişte de geçerli: tutar ya da para birimi uymayan başarılı bildirim reddedilir ve
    çekilen tutar otomatik iade edilir; bahşiş ödenmemiş sayılır."""
    if not result.success:
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = (result.failure_reason or "")[:255]
        ratings.on_tip_result(db, payment, provider, paid=False, now=now)
        return
    reject = _reject_reason(result, payment)
    if reject is not None:
        _reject_charge(db, payment, provider, result, reject)
        ratings.on_tip_result(db, payment, provider, paid=False, now=now)
        return
    payment.status = PaymentStatus.PAID
    payment.paid_at = now
    audit.record(db, actor_id=None, action="payment.paid", entity_type="payment", entity_id=payment.id,
                 changes={"amount": payment.amount, "currency": payment.currency, "purpose": "tip"})
    ratings.on_tip_result(db, payment, provider, paid=True, now=now)


def confirm_paid_booking(db: Session, booking: Booking, now: datetime) -> None:
    """Ödemesi alınan rezervasyonu onaylar: fatura kuyruğu, müşteri SMS'i, anlık işte sürücü teklifi."""
    booking.status = BookingStatus.CONFIRMED
    db.add(Invoice(booking_id=booking.id))
    notifications.notify_customer(db, booking, "booking_confirmed")
    if booking.booking_type is BookingType.INSTANT:
        dispatch.offer_leg(db, booking.legs[0], now=now)


def record_manual_payment(
    db: Session,
    booking: Booking,
    *,
    staff_id,
    method: ManualPaymentMethod,
    amount: Decimal,
    reference: str | None,
    note: str | None,
    now: datetime,
    ip: str | None,
    staff_is_admin: bool = False,
) -> Payment:
    """K-54: havale/EFT, ofiste nakit veya fiziki POS tahsilatını kaydeder ve rezervasyonu onaylar.
    Tutar rezervasyon toplamına eşit olmalıdır (kısmi tahsilat yok). Sağlayıcı çağrılmaz."""
    db.get(Booking, booking.id, with_for_update={"of": Booking}, populate_existing=True)
    if booking.source is not BookingSource.ADMIN:
        # K-12: sitede ve uygulamada açılan rezervasyonda havale/elle tahsilat yok.
        raise Conflict("elle tahsilat yalnızca admin girişli rezervasyonda kaydedilir", code="manual_payment_not_allowed")
    if booking.status is not BookingStatus.PENDING_PAYMENT:
        raise Conflict("bu rezervasyon için ödeme beklenmiyor", code="payment_not_expected")
    if not (reference and reference.strip()):
        # BIZ-04: dekont, makbuz ya da POS slip numarası olmadan tahsilat kaydedilmez.
        raise DomainError("tahsilat için dekont, makbuz veya slip numarası yazılmalı", code="payment_reference_required")
    if booking.system_total_amount is not None and booking.created_by_id == staff_id and not staff_is_admin:
        # BIZ-04 görev ayrılığı: fiyatı değiştiren kişi aynı rezervasyonun elle tahsilatını kaydedemez.
        raise Conflict("fiyatı değiştirilen rezervasyonun tahsilatını başka bir personel kaydetmeli",
                       code="manual_payment_needs_other_staff")
    if amount != booking.total_amount:
        raise DomainError(
            "tahsil edilen tutar rezervasyon toplamına eşit olmalı",
            code="amount_mismatch",
            details={"total": str(booking.total_amount), "currency": booking.currency.value},
        )
    # Bu arada kartla ödeme sayfası açıldıysa o ödeme kullanılmaz; geç gelirse tam iade yolu işler (K-46).
    payment = Payment(
        booking_id=booking.id,
        provider=PaymentProviderCode.MANUAL,
        merchant_oid=f"{booking.booking_code}M{secrets.token_hex(4).upper()}",
        provider_ref=(reference or None) and reference[:100],
        amount=amount,
        currency=booking.currency,
        status=PaymentStatus.PAID,
        paid_at=now,
        manual_method=method,
        recorded_by_id=staff_id,
        note=(note or None) and note[:500],
    )
    db.add(payment)
    db.flush()
    audit.record(db, actor_id=staff_id, action="payment.manual", entity_type="payment", entity_id=payment.id,
                 changes={"booking_code": booking.booking_code, "method": method, "amount": amount,
                          "currency": booking.currency, "reference": reference}, ip=ip)
    confirm_paid_booking(db, booking, now)
    return payment
