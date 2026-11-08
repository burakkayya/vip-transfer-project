"""Rezervasyon oluşturma, iptal ve iade."""

from __future__ import annotations

import dataclasses
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import cancellation, commission
from app.errors import Conflict, DomainError, ServiceUnavailable
from app.models import (
    Booking,
    BookingLeg,
    CancellationPolicy,
    CommissionRule,
    Consent,
    Customer,
    DispatchOffer,
    FlightInfo,
    Payment,
    Refund,
)
from app.models.enums import (
    BookingChannel,
    BookingSource,
    BookingStatus,
    BookingType,
    ConsentType,
    FlightDirection,
    LegStatus,
    OfferStatus,
    PaymentProviderCode,
    PaymentStatus,
    RefundStatus,
    RegionType,
)
from app.providers.payments import PaymentProvider
from app.localtime import LOCAL_TZ
from app.services import audit, system_settings, trip_updates
from app.services.quotes import Quote

# Kod alfabesinde karışabilecek karakterler yok (0/O, 1/I/L).
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
# Yolculuk hiç tamamlanmazsa uçuş verisinin en geç silineceği süre.
FLIGHT_PURGE_FALLBACK = timedelta(hours=48)
FLIGHT_PURGE_AFTER_TRIP = timedelta(hours=24)


@dataclass(frozen=True)
class FlightInput:
    leg_order: int
    flight_no: str
    scheduled_at: datetime | None


@dataclass(frozen=True)
class AdminEntry:
    """K-54: admin'in WhatsApp, telefon vb. kanaldan aldığı rezervasyon."""

    staff_id: uuid.UUID
    channel: BookingChannel
    payment_due_at: datetime
    # Boşsa sistem fiyatı. Doluysa toplam tutar (müşteri para biriminde) bu olur, gerekçe zorunludur.
    override_total: Decimal | None = None
    override_reason: str | None = None


def override_quote(quote: Quote, total: Decimal) -> Quote:
    """Toplamı elle verilen tutara çeker. Bacak payları ve EUR karşılığı aynı oranla ölçeklenir;
    garanti ücreti değişmez. Kuruş farkı son bacakta."""
    price = total - quote.guarantee_fee
    if price <= 0:
        raise DomainError("fiyat garanti ücretinden büyük olmalı", code="invalid_price_override")
    ratio = price / quote.price
    shares = [(leg.price * ratio).quantize(Decimal("0.01")) for leg in quote.legs[:-1]]
    shares.append(price - sum(shares, Decimal("0")))
    legs = tuple(dataclasses.replace(leg, price=share) for leg, share in zip(quote.legs, shares))
    price_eur = price if quote.currency.value == "EUR" else (quote.price_eur * ratio).quantize(Decimal("0.01"))
    return dataclasses.replace(quote, legs=legs, price=price, price_eur=price_eur, total=total)


def new_booking_code() -> str:
    return "GA" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def active_cancellation_policy(db: Session, at: datetime) -> CancellationPolicy:
    policy = db.scalar(
        select(CancellationPolicy)
        .where(CancellationPolicy.is_active.is_(True), CancellationPolicy.valid_from <= at)
        .order_by(CancellationPolicy.valid_from.desc(), CancellationPolicy.id.desc())
        .limit(1)
    )
    if policy is None:
        raise ServiceUnavailable("iptal politikası tanımlı değil")
    return policy


def resolve_commission(
    db: Session, vehicle_type_id: int, region_id: int, at: datetime
) -> CommissionRule:
    rules = list(
        db.scalars(
            select(CommissionRule).where(
                CommissionRule.is_active.is_(True),
                CommissionRule.valid_from <= at,
                or_(CommissionRule.valid_to.is_(None), CommissionRule.valid_to > at),
            )
        )
    )
    candidates = [
        commission.CommissionCandidate(r.id, r.scope, r.scope_ref_id, r.rate) for r in rules
    ]
    try:
        chosen = commission.select_rule(candidates, vehicle_type_id, region_id)
    except LookupError as exc:
        raise ServiceUnavailable("komisyon kuralı tanımlı değil") from exc
    return next(r for r in rules if r.id == chosen.rule_id)


def _flight_direction(leg: BookingLeg) -> FlightDirection:
    if leg.pickup_region.type is RegionType.AIRPORT:
        return FlightDirection.ARRIVAL
    return FlightDirection.DEPARTURE


def create_booking(
    db: Session,
    *,
    customer: Customer,
    quote: Quote,
    expected_total: Decimal,
    booking_type: BookingType,
    passenger_name: str,
    passenger_count: int,
    luggage_count: int,
    note: str | None,
    flights: list[FlightInput],
    locale: str,
    ip: str | None,
    now: datetime,
    admin: AdminEntry | None = None,
) -> Booking:
    if quote.total != expected_total:
        raise Conflict(
            "fiyat değişti, lütfen yeni fiyatı onaylayın",
            code="price_changed",
            details={"total": str(quote.total), "currency": quote.currency.value},
        )
    system_total = quote.total
    if admin is not None and admin.override_total is not None and admin.override_total != quote.total:
        if not (admin.override_reason and admin.override_reason.strip()):
            raise DomainError("fiyat değişikliği için gerekçe yazılmalı", code="override_reason_required")
        quote = override_quote(quote, admin.override_total)
    first_pickup = quote.legs[0].pickup_at
    if booking_type is BookingType.SCHEDULED:
        lead_hours = int(system_settings.get(db, "scheduled_min_lead_hours"))
        if first_pickup < now + timedelta(hours=lead_hours):
            raise DomainError(
                f"planlı rezervasyon en az {lead_hours} saat önceden yapılmalı",
                code="lead_time_too_short",
            )
    elif first_pickup > now + timedelta(minutes=30) or first_pickup < now - timedelta(minutes=5):
        raise DomainError("anlık rezervasyonda alış zamanı şimdi olmalı", code="invalid_instant_time")

    policy = active_cancellation_policy(db, now)
    commission_rule = resolve_commission(
        db, quote.vehicle_type.id, quote.legs[0].pickup_region.id, now
    )

    code = new_booking_code()
    while db.scalar(select(Booking.id).where(Booking.booking_code == code)):
        code = new_booking_code()

    booking = Booking(
        id=uuid.uuid4(),
        booking_code=code,
        customer_id=customer.id,
        booking_type=booking_type,
        status=BookingStatus.PENDING_PAYMENT,
        vehicle_type_id=quote.vehicle_type.id,
        passenger_count=passenger_count,
        luggage_count=luggage_count,
        is_round_trip=quote.is_round_trip,
        passenger_name=passenger_name,
        note=note,
        locale=locale,
        pricing_rule_id=quote.pricing_rule.id,
        round_trip_discount_id=quote.discount.id if quote.discount else None,
        cancellation_policy_id=policy.id,
        commission_rule_id=commission_rule.id,
        commission_rate=commission_rule.rate,
        exchange_rate_id=quote.exchange_rate.id if quote.exchange_rate else None,
        price_eur=quote.price_eur,
        quoted_price=quote.price,
        guarantee_fee=quote.guarantee_fee,
        total_amount=quote.total,
        currency=quote.currency,
        quoted_at=now,
    )
    if admin is not None:
        booking.source = BookingSource.ADMIN
        booking.channel = admin.channel
        booking.created_by_id = admin.staff_id
        booking.payment_due_at = admin.payment_due_at
        if quote.total != system_total:
            booking.system_total_amount = system_total
            booking.price_override_reason = admin.override_reason.strip()[:500]
    for order, plan in enumerate(quote.legs, start=1):
        booking.legs.append(
            BookingLeg(
                leg_order=order,
                pickup_region_id=plan.pickup_region.id,
                dropoff_region_id=plan.dropoff_region.id,
                pickup_region=plan.pickup_region,
                dropoff_region=plan.dropoff_region,
                pickup_address=plan.pickup.address,
                dropoff_address=plan.dropoff.address,
                pickup_lat=plan.pickup.lat,
                pickup_lng=plan.pickup.lng,
                dropoff_lat=plan.dropoff.lat,
                dropoff_lng=plan.dropoff.lng,
                pickup_at=plan.pickup_at,
                distance_km=plan.distance_km,
                duration_minutes=plan.duration_minutes,
                leg_price=plan.price,
            )
        )
    for f in flights:
        if not 1 <= f.leg_order <= len(booking.legs):
            raise DomainError("uçuş bilgisi geçersiz bacağa ait", code="invalid_flight_leg")
        leg = booking.legs[f.leg_order - 1]
        leg.flight = FlightInfo(
            flight_no=f.flight_no.upper().replace(" ", ""),
            direction=_flight_direction(leg),
            scheduled_at=f.scheduled_at,
            purge_at=leg.pickup_at + FLIGHT_PURGE_FALLBACK,
        )
    db.add(booking)

    # Her rezervasyonda aydınlatma metni ve mesafeli satış ön bilgilendirmesi onayı kaydedilir.
    for consent_type, key in (
        (ConsentType.DISCLOSURE, "kvkk_disclosure_version"),
        (ConsentType.DISTANCE_SALES, "distance_sales_version"),
    ):
        db.add(
            Consent(
                customer_id=customer.id,
                consent_type=consent_type,
                version=str(system_settings.get(db, key)),
                # Admin girişinde personelin IP'si müşterinin onayı gibi kaydedilmez.
                ip=ip if admin is None else None,
            )
        )
    db.flush()
    changes: dict = {
        "booking_code": booking.booking_code,
        "total": booking.total_amount,
        "currency": booking.currency,
    }
    if admin is not None:
        # Admin girişinde onaylar müşteriden kanal üzerinden alınmıştır; kanal ve fiyat farkı denetimde durur.
        changes.update(source=BookingSource.ADMIN, channel=admin.channel, customer_id=customer.id)
        if booking.system_total_amount is not None:
            changes.update(system_total=booking.system_total_amount, override_reason=booking.price_override_reason)
    audit.record(
        db,
        actor_id=admin.staff_id if admin is not None else customer.user_id,
        action="booking.admin_create" if admin is not None else "booking.create",
        entity_type="booking",
        entity_id=booking.id,
        changes=changes,
        ip=ip,
    )
    return booking


# --- İptal ve iade -----------------------------------------------------------

CANCELLABLE = {BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.ASSIGNED}


def paid_payment(db: Session, booking: Booking) -> Payment | None:
    return db.scalar(
        select(Payment).where(
            Payment.booking_id == booking.id,
            Payment.status.in_([PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED]),
        )
    )


def refund_quote(db: Session, booking: Booking, now: datetime) -> cancellation.RefundQuote:
    policy = db.get(CancellationPolicy, booking.cancellation_policy_id)
    tiers = [cancellation.Tier(t.hours_before_pickup, t.refund_percent) for t in policy.tiers]
    if booking.status is BookingStatus.PENDING_PAYMENT:
        # Ödeme alınmadıysa iade edilecek bir şey yok.
        return cancellation.RefundQuote(Decimal("0"), 0, Decimal("0.00"), False)
    return cancellation.quote_refund(
        booking.quoted_price, booking.first_pickup_at, now, tiers, booking.has_guarantee
    )


def cancel_booking(
    db: Session,
    booking: Booking,
    *,
    provider: PaymentProvider,
    actor_id: uuid.UUID,
    reason: str,
    now: datetime,
    ip: str | None,
    override_refund_percent: int | None = None,
) -> Refund | None:
    """İptal eder ve politikaya göre iade başlatır. Yalnızca personel iade oranını ezebilir."""
    if booking.status not in CANCELLABLE:
        raise Conflict("bu rezervasyon iptal edilemez", code="not_cancellable")
    quote = refund_quote(db, booking, now)
    percent = quote.refund_percent
    amount = quote.refund_amount
    if override_refund_percent is not None:
        if not 0 <= override_refund_percent <= 100:
            raise DomainError("iade oranı 0-100 arasında olmalı")
        percent = override_refund_percent
        amount = (booking.quoted_price * percent / Decimal(100)).quantize(Decimal("0.01"))

    booking.status = BookingStatus.CANCELLED
    booking.cancelled_at = now
    booking.cancel_reason = reason[:500]
    for leg in booking.legs:
        was_assigned = leg.driver_id is not None and leg.status not in (LegStatus.COMPLETED, LegStatus.CANCELLED)
        leg.status = LegStatus.CANCELLED
        if was_assigned:
            trip_updates.to_driver(db, leg, "trip_cancelled",
                                   pickup_at=leg.pickup_at.astimezone(LOCAL_TZ).strftime("%d.%m %H:%M"))
    for offer in db.scalars(
        select(DispatchOffer).where(
            DispatchOffer.booking_leg_id.in_([leg.id for leg in booking.legs]),
            DispatchOffer.status == OfferStatus.SENT,
        )
    ):
        offer.status = OfferStatus.WITHDRAWN

    refund = None
    payment = paid_payment(db, booking)
    if payment is not None and amount > 0:
        refund = Refund(
            payment_id=payment.id,
            amount=amount,
            reason=reason[:255],
            policy_id=booking.cancellation_policy_id,
            refund_percent=percent,
            created_by=actor_id,
        )
        db.add(refund)
        db.flush()
        execute_refund(db, refund, payment, provider)
    audit.record(
        db,
        actor_id=actor_id,
        action="booking.cancel",
        entity_type="booking",
        entity_id=booking.id,
        changes={
            "refund_percent": percent,
            "refund_amount": amount,
            "override": override_refund_percent is not None,
        },
        ip=ip,
    )
    return refund


def execute_refund(db: Session, refund: Refund, payment: Payment, provider: PaymentProvider) -> None:
    """Sağlayıcıda iadeyi çalıştırır. Başarısızsa kayıt 'basarisiz' kalır, admin tekrar dener."""
    others = db.scalar(
        select(func.coalesce(func.sum(Refund.amount), 0)).where(
            Refund.payment_id == payment.id,
            Refund.id != refund.id,
            Refund.status != RefundStatus.FAILED,
        )
    )
    if others + refund.amount > payment.amount:
        raise Conflict("iade tutarı ödenen tutarı aşıyor", code="refund_exceeds_payment")
    if payment.provider is PaymentProviderCode.MANUAL:
        # Elle tahsilatın iadesi de elle yapılır (havale, nakit): kayıt beklemede kalır, muhasebe
        # parayı iade edip `complete_manual_refund` ile kapatır (K-54).
        refund.status = RefundStatus.PENDING
        return
    result = provider.refund(payment.merchant_oid, refund.amount)
    if result.ok:
        refund.status = RefundStatus.COMPLETED
        refund.provider_ref = result.provider_ref
        _settle_payment_status(db, payment)
    else:
        refund.status = RefundStatus.FAILED
        refund.reason = f"{refund.reason[:150]} | hata: {result.error}"[:255]


def _settle_payment_status(db: Session, payment: Payment) -> None:
    db.flush()
    db.refresh(payment)
    completed = sum(
        (r.amount for r in payment.refunds if r.status is RefundStatus.COMPLETED), Decimal("0")
    )
    payment.status = (
        PaymentStatus.REFUNDED if completed >= payment.amount else PaymentStatus.PARTIALLY_REFUNDED
    )


def complete_manual_refund(db: Session, refund: Refund, *, reference: str) -> None:
    """Elle tahsilatın iadesi yapıldı (K-54): muhasebe havale/nakit iadesini kaydeder."""
    payment = refund.payment
    if payment.provider is not PaymentProviderCode.MANUAL:
        raise Conflict("yalnızca elle tahsilatın iadesi elle kapatılır", code="not_manual_payment")
    if refund.status is not RefundStatus.PENDING:
        raise Conflict("iade beklemede değil", code="refund_not_pending")
    refund.status = RefundStatus.COMPLETED
    refund.provider_ref = reference[:100]
    _settle_payment_status(db, payment)
