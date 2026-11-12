"""Yolculuk sonrası puan ve bahşiş (K-62).

- Müşteri tamamlanan her bacağı bir kez 1-5 yıldızla puanlar (isteğe bağlı yorum). Sürücüye yalnızca yıldız
  bildirilir; yorum yalnızca operasyonda görünür.
- Bahşiş isteğe bağlıdır, rezervasyon para biriminde, ödeme sağlayıcısının sayfasında ayrıca ödenir
  (`Payment.purpose="tip"`). Ödeme gelince tamamı komisyonsuz sürücü hakedişine eklenir (`kind="tip"`).
  Bahşiş rezervasyon iadesi ve iptal hesaplarına girmez.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import Conflict, DomainError, NotFound
from app.models import Booking, BookingLeg, Customer, DriverLedger, Payment, Refund, TripRating
from app.models.enums import Currency, LegStatus, PaymentStatus
from app.providers.payments import Checkout, CheckoutRequest, PaymentProvider
from app.services import audit, trip_updates
from app.services.quotes import latest_exchange_rate

log = logging.getLogger(__name__)
RATING_WINDOW = timedelta(days=14)
# Açık bahşiş ödeme sayfası bu süre içinde yeniden kullanılır (K-46 gibi: aynı anda tek canlı sayfa).
TIP_REUSE_WINDOW = timedelta(minutes=25)
TIP_MIN = {Currency.EUR: Decimal("1"), Currency.TRY: Decimal("20")}
TIP_OPEN, TIP_PENDING, TIP_PAID, TIP_FAILED = "yok", "beklemede", "odendi", "basarisiz"


def rateable_leg(booking: Booking) -> BookingLeg | None:
    """Puanlanacak bacak: sürücüsü olan son tamamlanmış bacak."""
    done = [leg for leg in booking.legs if leg.status is LegStatus.COMPLETED and leg.driver_id is not None]
    return done[-1] if done else None


def rating_for(db: Session, leg: BookingLeg) -> TripRating | None:
    return db.scalar(select(TripRating).where(TripRating.booking_leg_id == leg.id))


def driver_summary(db: Session, driver_id) -> tuple[Decimal | None, int]:
    avg, count = db.execute(
        select(func.avg(TripRating.stars), func.count()).where(TripRating.driver_id == driver_id)
    ).one()
    return (Decimal(avg).quantize(Decimal("0.1")) if avg is not None else None), int(count)


def _tip_max(currency: Currency) -> Decimal:
    s = get_settings()
    return s.tip_max_try if currency is Currency.TRY else s.tip_max_eur


def _check_tip(booking: Booking, amount: Decimal) -> Decimal:
    amount = amount.quantize(Decimal("0.01"))
    if amount < TIP_MIN[booking.currency]:
        raise DomainError(f"bahşiş en az {TIP_MIN[booking.currency]} {booking.currency.value} olabilir",
                          code="tip_invalid", details={"min": str(TIP_MIN[booking.currency])})
    limit = _tip_max(booking.currency)
    if amount > limit:
        raise DomainError(f"bahşiş en fazla {limit} {booking.currency.value} olabilir", code="tip_too_large",
                          details={"max": str(limit), "currency": booking.currency.value})
    return amount


def check_tip(booking: Booking, amount: Decimal) -> Decimal:
    return _check_tip(booking, amount)


def rate(db: Session, booking: Booking, *, stars: int, comment: str | None, now: datetime) -> TripRating:
    leg = rateable_leg(booking)
    if leg is None:
        raise Conflict("puanlanacak tamamlanmış yolculuk yok", code="nothing_to_rate")
    db.refresh(leg, with_for_update={"of": BookingLeg})
    if now > leg.pickup_at + RATING_WINDOW:
        raise Conflict("puanlama süresi doldu", code="rating_closed")
    if rating_for(db, leg) is not None:
        raise Conflict("bu yolculuk zaten puanlandı", code="already_rated")
    if not 1 <= stars <= 5:
        raise DomainError("puan 1 ile 5 arasında olmalı", code="invalid_stars")
    rating = TripRating(booking_leg_id=leg.id, driver_id=leg.driver_id, stars=stars,
                        comment=(comment or "").strip()[:500] or None, currency=booking.currency)
    db.add(rating)
    trip_updates.to_driver(db, leg, "trip_rated", stars=stars)
    db.flush()
    return rating


def start_tip(db: Session, booking: Booking, customer: Customer, provider: PaymentProvider, *,
              amount: Decimal, user_ip: str, now: datetime) -> tuple[TripRating, Checkout]:
    """Puanlanmış bacağa bahşiş ödemesi açar. Ödenmiş bahşiş tekrar açılmaz; açık ödeme yenisiyle değişir."""
    leg = rateable_leg(booking)
    rating = rating_for(db, leg) if leg is not None else None
    if rating is None:
        raise Conflict("önce yolculuğu puanlayın", code="rating_required")
    db.refresh(rating, with_for_update={"of": TripRating})
    if rating.tip_status == TIP_PAID:
        raise Conflict("bahşiş zaten ödendi", code="tip_already_paid")
    if now > leg.pickup_at + RATING_WINDOW:
        raise Conflict("bahşiş süresi doldu", code="rating_closed")
    amount = _check_tip(booking, amount)
    # Açık (ödenmemiş) bahşiş sayfası varsa ve tutar aynıysa o kullanılır: ikinci canlı sayfa açılmaz.
    if rating.tip_payment_id is not None:
        open_payment = db.get(Payment, rating.tip_payment_id)
        if (open_payment is not None and open_payment.status is PaymentStatus.PENDING
                and open_payment.amount == amount and open_payment.checkout_url
                and open_payment.created_at > now - TIP_REUSE_WINDOW):
            return rating, Checkout(iframe_url=open_payment.checkout_url)
    payment = Payment(
        booking_id=booking.id,
        provider=provider.code,
        merchant_oid=f"{booking.booking_code}T{secrets.token_hex(4).upper()}",
        amount=amount,
        currency=booking.currency,
        purpose="tip",
    )
    db.add(payment)
    db.flush()
    checkout = provider.create_checkout(CheckoutRequest(
        merchant_oid=payment.merchant_oid,
        amount=amount,
        currency=booking.currency,
        email=customer.email or f"{booking.booking_code.lower()}@musteri.getawaytransfers.com",
        customer_name=booking.passenger_name,
        customer_phone=customer.user.phone or "",
        user_ip=user_ip,
        description=f"Bahşiş {booking.booking_code}",
        locale=booking.locale,
    ))
    payment.checkout_url = checkout.iframe_url
    rating.tip_amount = amount
    rating.tip_status = TIP_PENDING
    rating.tip_payment_id = payment.id
    return rating, checkout


def on_tip_result(db: Session, payment: Payment, provider: PaymentProvider, *, paid: bool, now: datetime) -> None:
    """Ödeme bildirimi: bahşiş ödendiyse sürücü hakedişine eklenir (komisyonsuz).

    Yerine yenisi açılmış eski bir bahşiş sayfası da ödenebilir (müşteri iki sekmede ödedi, bildirim gecikti):
    bahşiş henüz ödenmediyse bu ödeme bahşiş sayılır; ödendiyse para müşteriye tamamen iade edilir."""
    leg_id = db.scalar(select(BookingLeg.id).where(BookingLeg.booking_id == payment.booking_id,
                                                   BookingLeg.id.in_(select(TripRating.booking_leg_id))
                                                   ).order_by(BookingLeg.leg_order.desc()).limit(1))
    rating = db.scalar(select(TripRating).where(TripRating.tip_payment_id == payment.id).with_for_update())
    if rating is None and leg_id is not None:
        rating = db.scalar(select(TripRating).where(TripRating.booking_leg_id == leg_id).with_for_update())
        if rating is not None and paid:
            if rating.tip_status == TIP_PAID:
                log.error("fazla bahşiş ödemesi iade ediliyor: %s", payment.merchant_oid)
                refund = Refund(payment_id=payment.id, amount=payment.amount, refund_percent=100,
                                reason="mükerrer bahşiş ödemesi")
                db.add(refund)
                db.flush()
                from app.services.bookings import execute_refund

                execute_refund(db, refund, payment, provider)
                return
            rating.tip_payment_id, rating.tip_amount = payment.id, payment.amount
    if rating is None or rating.tip_payment_id != payment.id:
        return  # eski sayfanın başarısız sonucu bahşişi değiştirmez
    if not paid:
        rating.tip_status = TIP_FAILED
        return
    rating.tip_status = TIP_PAID
    leg = db.get(BookingLeg, rating.booking_leg_id)
    if payment.currency is Currency.TRY:
        net_try = payment.amount
    else:
        fx = latest_exchange_rate(db, now)
        net_try = (payment.amount * fx.rate).quantize(Decimal("0.01")) if fx else None
    db.add(DriverLedger(driver_id=rating.driver_id, booking_leg_id=leg.id, gross_amount=payment.amount,
                        commission_amount=Decimal("0"), net_amount=payment.amount, currency=payment.currency,
                        net_amount_try=net_try, kind="tip"))
    audit.record(db, actor_id=None, action="tip.paid", entity_type="booking_leg", entity_id=leg.id,
                 changes={"amount": payment.amount, "currency": payment.currency})
    if leg.driver_id == rating.driver_id:
        trip_updates.to_driver(db, leg, "tip_received", amount=f"{payment.amount:.2f}",
                               currency=payment.currency.value)


def get_rating(db: Session, booking: Booking) -> tuple[BookingLeg | None, TripRating | None]:
    leg = rateable_leg(booking)
    if leg is None:
        raise NotFound("puanlanacak yolculuk yok", code="nothing_to_rate")
    return leg, rating_for(db, leg)
