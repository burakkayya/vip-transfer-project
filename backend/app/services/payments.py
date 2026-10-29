"""Ödeme başlatma ve sağlayıcı bildirimlerinin işlenmesi (odeme.md)."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import Conflict, DomainError, NotFound
from app.models import Booking, Customer, Invoice, Payment, PaymentWebhook, Refund
from app.models.enums import BookingStatus, BookingType, PaymentStatus
from app.providers.payments import Checkout, CheckoutRequest, PaymentProvider
from app.services import audit, dispatch, notifications
from app.services.bookings import execute_refund

log = logging.getLogger(__name__)


def start_payment(
    db: Session,
    booking: Booking,
    customer: Customer,
    provider: PaymentProvider,
    *,
    user_ip: str,
) -> tuple[Payment, Checkout]:
    if booking.status is not BookingStatus.PENDING_PAYMENT:
        raise Conflict("bu rezervasyon için ödeme beklenmiyor", code="payment_not_expected")
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
    return payment, checkout


def handle_callback(
    db: Session, provider: PaymentProvider, form: dict[str, str], now: datetime
) -> None:
    """Bildirim imzası geçersizse DomainError. Aynı bildirim birden çok gelirse tekrar işlenmez."""
    result = provider.parse_callback(form)
    hook = PaymentWebhook(
        provider=provider.code,
        event_type="payment_" + ("success" if result.success else "failed"),
        merchant_oid=result.merchant_oid or None,
        raw_payload=result.masked_payload,
        signature_valid=result.signature_valid,
    )
    db.add(hook)
    if not result.signature_valid:
        db.commit()
        log.error("geçersiz imzalı ödeme bildirimi: %s", result.merchant_oid)
        raise DomainError("imza doğrulanamadı", code="invalid_signature")

    payment = db.scalar(
        select(Payment).where(Payment.merchant_oid == result.merchant_oid).with_for_update()
    )
    if payment is None:
        db.commit()
        raise NotFound("ödeme bulunamadı")
    hook.processed_at = now
    if payment.status is not PaymentStatus.PENDING:
        return  # zaten işlendi

    booking = db.get(Booking, payment.booking_id, with_for_update={"of": Booking})
    if not result.success:
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = (result.failure_reason or "")[:255]
        return

    if result.total_amount is not None and result.total_amount < payment.amount:
        payment.status = PaymentStatus.FAILED
        payment.failure_reason = "eksik tahsilat"
        log.error("eksik tahsilat %s: %s < %s", payment.merchant_oid, result.total_amount, payment.amount)
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

    booking.status = BookingStatus.CONFIRMED
    db.add(Invoice(booking_id=booking.id))
    notifications.notify_customer(db, booking, "booking_confirmed")
    if booking.booking_type is BookingType.INSTANT:
        dispatch.offer_leg(db, booking.legs[0], now=now)
