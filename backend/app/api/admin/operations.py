"""Admin: genel panel, rezervasyonlar, eşleştirme (ekran 2-4)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.admin import manual_bookings
from app.api.admin.common import Page, page
from app.api.deps import ClientIp, DbSession, Now, OpsOrFinance, OpsOrSupport, OpsStaff
from app.api.schemas import BookingOut, MoneyStr
from app.errors import NotFound
from app.localtime import LOCAL_TZ
from app.models import Booking, BookingLeg, DispatchOffer, Driver, DriverLedger, Payment, TripEvent
from app.models.enums import BookingSource, BookingStatus, PaymentStatus
from app.providers.payments import get_payment_provider
from app.security.crypto import mask_phone
from app.services import bookings, dispatch, live_location

router = APIRouter(tags=["admin:operations"])


@router.get("/dashboard")
def dashboard(staff: OpsOrSupport, db: DbSession, now: Now):
    today = now.astimezone(LOCAL_TZ).date()
    start = datetime.combine(today, time.min, LOCAL_TZ)
    end = start + timedelta(days=1)
    todays_legs = list(
        db.scalars(
            select(BookingLeg)
            .join(Booking)
            .where(BookingLeg.pickup_at >= start, BookingLeg.pickup_at < end,
                   Booking.status != BookingStatus.CANCELLED)
            .order_by(BookingLeg.pickup_at)
        )
    )
    status_counts = dict(db.execute(select(Booking.status, func.count()).group_by(Booking.status)).all())
    payment_counts = dict(
        db.execute(
            select(Payment.status, func.count())
            .where(Payment.created_at >= start - timedelta(days=7))
            .group_by(Payment.status)
        ).all()
    )
    live = []
    for leg in todays_legs:
        loc = live_location.for_booking(leg.booking) if leg.status in live_location.TRACKABLE else None
        if loc:
            live.append({"booking_code": leg.booking.booking_code, **loc})
    return {
        "today": today.isoformat(),
        "todays_trips": [
            {"booking_code": leg.booking.booking_code, "leg_id": str(leg.id), "pickup_at": leg.pickup_at,
             "pickup": leg.pickup_region.name, "dropoff": leg.dropoff_region.name, "status": leg.status.value,
             "driver": leg.driver.full_name if leg.driver else None}
            for leg in todays_legs
        ],
        "open_dispatch": len(dispatch.pending_legs(db, now)),
        "booking_status_counts": {k.value: v for k, v in status_counts.items()},
        "payment_status_counts_7d": {k.value: v for k, v in payment_counts.items()},
        "live_locations": live,
    }


class AdminBookingRow(BaseModel):
    id: uuid.UUID
    booking_code: str
    status: BookingStatus
    booking_type: str
    pickup_at: datetime
    route: str
    total_amount: MoneyStr
    currency: str
    customer_phone: str
    created_at: datetime
    source: str = "musteri"
    channel: str | None = None


@router.get("/bookings", response_model=list[AdminBookingRow])
def list_bookings(
    staff: OpsOrSupport,
    db: DbSession,
    p: Annotated[Page, Depends(page)],
    status: BookingStatus | None = None,
    code: str | None = None,
    source: BookingSource | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    q = select(Booking)
    if status:
        q = q.where(Booking.status == status)
    if code:
        q = q.where(Booking.booking_code == code.upper())
    if source:
        q = q.where(Booking.source == source)
    if date_from or date_to:
        q = q.join(BookingLeg, (BookingLeg.booking_id == Booking.id) & (BookingLeg.leg_order == 1))
        if date_from:
            q = q.where(BookingLeg.pickup_at >= datetime.combine(date_from, time.min, LOCAL_TZ))
        if date_to:
            q = q.where(BookingLeg.pickup_at < datetime.combine(date_to + timedelta(days=1), time.min, LOCAL_TZ))
    rows = db.scalars(q.order_by(Booking.created_at.desc()).limit(p.limit).offset(p.offset))
    return [
        AdminBookingRow(
            id=b.id, booking_code=b.booking_code, status=b.status, booking_type=b.booking_type.value,
            pickup_at=b.first_pickup_at,
            route=f"{b.legs[0].pickup_region.name} → {b.legs[0].dropoff_region.name}",
            total_amount=b.total_amount, currency=b.currency.value,
            # Müşteri hassas alanları admin panelinde maskeli (ekran 14).
            customer_phone=mask_phone(b.customer.user.phone or ""), created_at=b.created_at,
            source=b.source.value, channel=b.channel.value if b.channel else None,
        )
        for b in rows
    ]


def _booking(db, booking_id: uuid.UUID) -> Booking:
    b = db.get(Booking, booking_id)
    if b is None:
        raise NotFound("rezervasyon bulunamadı")
    return b


@router.get("/bookings/{booking_id}")
def booking_detail(booking_id: uuid.UUID, staff: OpsOrSupport, db: DbSession):
    b = _booking(db, booking_id)
    leg_ids = [leg.id for leg in b.legs]
    events = db.scalars(select(TripEvent).where(TripEvent.booking_leg_id.in_(leg_ids)).order_by(TripEvent.occurred_at))
    offers = db.scalars(select(DispatchOffer).where(DispatchOffer.booking_leg_id.in_(leg_ids)))
    pays = list(db.scalars(select(Payment).where(Payment.booking_id == b.id).order_by(Payment.created_at)))
    earnings = db.scalars(select(DriverLedger).where(DriverLedger.booking_leg_id.in_(leg_ids))
                          .order_by(DriverLedger.created_at))
    return {
        "booking": BookingOut.build(b),
        "customer_phone": mask_phone(b.customer.user.phone or ""),
        "commission_rate": str(b.commission_rate),
        "price_eur": f"{b.price_eur:.2f}",
        "cancel_reason": b.cancel_reason,
        "customer_id": str(b.customer_id),
        "customer_name": (b.customer.full_name[:1] + "***") if b.customer.full_name else None,
        # K-54: kaynak, kanal, ödeme son anı, fiyat değişikliği, ödeme bağlantısı ve paylaşım metni.
        "manual": manual_bookings.manual_info(b),
        # K-63: olay anındaki sürücü konumu (kanıtlı bekleme, yolcu gelmedi).
        "events": [{"leg_id": str(e.booking_leg_id), "event": e.event_type.value, "at": e.occurred_at,
                    "lat": str(e.latitude) if e.latitude is not None else None,
                    "lng": str(e.longitude) if e.longitude is not None else None} for e in events],
        "offers": [{"leg_id": str(o.booking_leg_id), "driver_id": str(o.driver_id), "status": o.status.value,
                    "offered_at": o.offered_at} for o in offers],
        "payments": [
            {"id": str(x.id), "provider": x.provider.value, "merchant_oid": x.merchant_oid,
             "amount": f"{x.amount:.2f}", "currency": x.currency.value, "status": x.status.value,
             "paid_at": x.paid_at, "manual_method": x.manual_method.value if x.manual_method else None,
             "provider_ref": x.provider_ref, "note": x.note,
             "refundable": f"{bookings.refundable_amount(db, x):.2f}"
             if x.status in (PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED) else "0.00",
             "refunds": [{"id": str(r.id), "amount": f"{r.amount:.2f}", "percent": r.refund_percent,
                          "status": r.status.value, "reason": r.reason} for r in x.refunds]}
            for x in pays
        ],
        # K-57: elle iade bu ödemeden yapılır (en yeni ödenmiş ödeme); arayüz yalnız bunu gösterir.
        "refund_target": (
            {"payment_id": str(rp.id), "refundable": f"{bookings.refundable_amount(db, rp):.2f}",
             "currency": rp.currency.value}
            if (rp := bookings.paid_payment(db, b)) is not None else None
        ),
        # K-57: bacakların sürücü hakedişleri (admin iptal edebilir).
        "earnings": [
            {"id": str(e.id), "leg_id": str(e.booking_leg_id), "driver_id": str(e.driver_id), "kind": e.kind,
             "net": f"{e.net_amount:.2f}", "currency": e.currency.value,
             "net_try": f"{e.net_amount_try:.2f}" if e.net_amount_try is not None else None,
             "status": e.status.value, "in_payout": e.payout_id is not None}
            for e in earnings
        ],
    }


class AdminCancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    # Boşsa politika uygulanır; dolu ise iade oranını ezer (ör. operasyonel iptalde %100).
    refund_percent: int | None = Field(default=None, ge=0, le=100)
    # K-57: bacakların bekleyen sürücü hakedişleri de iptal edilsin mi.
    cancel_driver_earnings: bool = False


@router.post("/bookings/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(booking_id: uuid.UUID, body: AdminCancelIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    """Personel iptali (K-57): yolculuk başlamış olsa da iptal edilir, sürücüye bildirim gider."""
    b = _booking(db, booking_id)
    bookings.cancel_booking(db, b, provider=get_payment_provider(), actor_id=staff.id, reason=body.reason,
                            now=now, ip=ip, override_refund_percent=body.refund_percent, by_staff=True,
                            cancel_driver_earnings=body.cancel_driver_earnings)
    db.commit()
    return BookingOut.build(b)


class AdminRefundIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=3, max_length=255)


@router.post("/bookings/{booking_id}/refund")
def refund_booking(booking_id: uuid.UUID, body: AdminRefundIn, staff: OpsOrFinance, db: DbSession, ip: ClientIp):
    """Müşteriye elle para iadesi (K-57), rezervasyonun durumundan bağımsız."""
    b = _booking(db, booking_id)
    refund = bookings.staff_refund(db, b, provider=get_payment_provider(), actor_id=staff.id,
                                   amount=body.amount, reason=body.reason, ip=ip)
    db.commit()
    return {"id": str(refund.id), "amount": f"{refund.amount:.2f}", "status": refund.status.value}


class LedgerCancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


@router.post("/ledger/{entry_id}/cancel")
def cancel_earning(entry_id: uuid.UUID, body: LedgerCancelIn, staff: OpsOrFinance, db: DbSession, ip: ClientIp):
    """Sürücü hakedişini iptal eder (K-57). Ödenmiş hakediş iptal edilemez."""
    entry = db.get(DriverLedger, entry_id)
    if entry is None:
        raise NotFound("hakediş bulunamadı")
    bookings.cancel_ledger_entry(db, entry, actor_id=staff.id, reason=body.reason, ip=ip)
    db.commit()
    return {"id": str(entry.id), "status": entry.status.value}


# --- Eşleştirme --------------------------------------------------------------


@router.get("/dispatch/pending")
def pending(staff: OpsStaff, db: DbSession, now: Now):
    return [
        {"leg_id": str(leg.id), "booking_code": leg.booking.booking_code,
         "booking_type": leg.booking.booking_type.value, "pickup_at": leg.pickup_at,
         "pickup": leg.pickup_region.name, "dropoff": leg.dropoff_region.name,
         "vehicle_type": leg.booking.vehicle_type.code, "passengers": leg.booking.passenger_count}
        for leg in dispatch.pending_legs(db, now)
    ]


def _leg(db, leg_id: uuid.UUID) -> BookingLeg:
    leg = db.get(BookingLeg, leg_id)
    if leg is None:
        raise NotFound("bacak bulunamadı")
    return leg


@router.get("/dispatch/legs/{leg_id}/candidates")
def candidates(leg_id: uuid.UUID, staff: OpsStaff, db: DbSession, now: Now):
    leg = _leg(db, leg_id)
    return [
        {"driver_id": str(c.driver.id), "driver_name": c.driver.full_name, "is_online": c.driver.is_online,
         "vehicle_id": str(c.vehicle.id), "plate": c.vehicle.plate, "vehicle": f"{c.vehicle.brand} {c.vehicle.model}"}
        for c in dispatch.eligible_candidates(db, leg, require_online=False, now=now)
    ]


class AssignIn(BaseModel):
    driver_id: uuid.UUID
    vehicle_id: uuid.UUID | None = None


@router.post("/dispatch/legs/{leg_id}/assign", status_code=204)
def assign(leg_id: uuid.UUID, body: AssignIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    leg = _leg(db, leg_id)
    dispatch.manual_assign(db, leg, body.driver_id, body.vehicle_id, actor_id=staff.id, now=now, ip=ip)
    db.commit()


@router.post("/dispatch/legs/{leg_id}/offer")
def send_offers(leg_id: uuid.UUID, staff: OpsStaff, db: DbSession, now: Now):
    leg = _leg(db, leg_id)
    sent = dispatch.offer_leg(db, leg, now=now)
    db.commit()
    return {"sent": sent}


@router.get("/drivers/online")
def online_drivers(staff: OpsStaff, db: DbSession):
    rows = db.scalars(select(Driver).where(Driver.is_online.is_(True)))
    return [{"id": str(d.id), "full_name": d.full_name} for d in rows]
