"""Eşleştirme ve yolculuk akışı (is_modeli.md).

Anlık: uygun ve çevrimiçi sürücülere teklif gider, ilk kabul eden atanır.
Planlı: admin manuel atar (veya ileride otomatik kural).
Sürücü yalnızca geçerli belgeleri varken iş alabilir.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app import commission
from app.errors import Conflict, Forbidden, NotFound
from app.models import (
    Booking,
    BookingLeg,
    DispatchOffer,
    Document,
    Driver,
    DriverLedger,
    DriverVehicleAssignment,
    TripEvent,
    Vehicle,
)
from app.models.enums import (
    BookingStatus,
    BookingType,
    Currency,
    DocumentOwner,
    DocumentStatus,
    DriverStatus,
    LegStatus,
    OfferStatus,
    TripEventType,
    VehicleStatus,
)
from app.config import get_settings
from app.services import audit, notifications, system_settings
from app.services.quotes import latest_exchange_rate

ACTIVE_LEG_STATUSES = (LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED)
BUSY_BUFFER = timedelta(minutes=90)

# Sürücünün tetikleyebileceği geçişler.
TRANSITIONS: dict[TripEventType, tuple[LegStatus, LegStatus]] = {
    TripEventType.DEPARTED: (LegStatus.ASSIGNED, LegStatus.EN_ROUTE),
    TripEventType.ARRIVED: (LegStatus.EN_ROUTE, LegStatus.ARRIVED),
    TripEventType.STARTED: (LegStatus.ARRIVED, LegStatus.STARTED),
    TripEventType.FINISHED: (LegStatus.STARTED, LegStatus.COMPLETED),
}


@dataclass(frozen=True)
class Candidate:
    driver: Driver
    vehicle: Vehicle


def missing_documents(
    db: Session, owner_type: DocumentOwner, owner_id: uuid.UUID, on: date
) -> list[str]:
    """Zorunlu olup onaylı ve `on` tarihinde geçerli olmayan belge türleri."""
    key = (
        "required_driver_documents"
        if owner_type is DocumentOwner.DRIVER
        else "required_vehicle_documents"
    )
    required = set(system_settings.get(db, key))
    valid = {
        d.doc_type.value
        for d in db.scalars(
            select(Document).where(
                Document.owner_type == owner_type,
                Document.owner_id == owner_id,
                Document.status == DocumentStatus.APPROVED,
                or_(Document.valid_until.is_(None), Document.valid_until >= on),
            )
        )
    }
    return sorted(required - valid)


def _is_busy(db: Session, driver_id: uuid.UUID, leg: BookingLeg) -> bool:
    window = BUSY_BUFFER + timedelta(minutes=leg.duration_minutes or 60)
    return (
        db.scalar(
            select(BookingLeg.id).where(
                BookingLeg.driver_id == driver_id,
                BookingLeg.id != leg.id,
                BookingLeg.status.in_(ACTIVE_LEG_STATUSES),
                BookingLeg.pickup_at > leg.pickup_at - window,
                BookingLeg.pickup_at < leg.pickup_at + window,
            ).limit(1)
        )
        is not None
    )


def eligible_candidates(
    db: Session, leg: BookingLeg, *, require_online: bool, now: datetime
) -> list[Candidate]:
    booking = leg.booking
    rows = db.execute(
        select(Driver, Vehicle)
        .join(DriverVehicleAssignment, DriverVehicleAssignment.driver_id == Driver.id)
        .join(Vehicle, Vehicle.id == DriverVehicleAssignment.vehicle_id)
        .where(
            Driver.status == DriverStatus.APPROVED,
            *( [Driver.is_online.is_(True)] if require_online else [] ),
            DriverVehicleAssignment.valid_from <= now,
            or_(DriverVehicleAssignment.valid_to.is_(None), DriverVehicleAssignment.valid_to > now),
            Vehicle.status == VehicleStatus.ACTIVE,
            Vehicle.vehicle_type_id == booking.vehicle_type_id,
            Vehicle.capacity >= booking.passenger_count,
        )
    ).all()
    on = leg.pickup_at.date()
    result: list[Candidate] = []
    seen: set[uuid.UUID] = set()
    for driver, vehicle in rows:
        if driver.id in seen:
            continue
        if missing_documents(db, DocumentOwner.DRIVER, driver.id, on):
            continue
        if missing_documents(db, DocumentOwner.VEHICLE, vehicle.id, on):
            continue
        if _is_busy(db, driver.id, leg):
            continue
        seen.add(driver.id)
        result.append(Candidate(driver, vehicle))
    return result


def offer_leg(db: Session, leg: BookingLeg, *, now: datetime) -> int:
    """Uygun sürücülere teklif gönderir. Gönderilen teklif sayısını döner."""
    if leg.driver_id is not None or leg.status is not LegStatus.PENDING:
        return 0
    require_online = leg.booking.booking_type is BookingType.INSTANT
    already = set(
        db.scalars(select(DispatchOffer.driver_id).where(DispatchOffer.booking_leg_id == leg.id))
    )
    expires = now + timedelta(seconds=get_settings().dispatch_offer_seconds)
    sent = 0
    for c in eligible_candidates(db, leg, require_online=require_online, now=now):
        if c.driver.id in already:
            continue
        db.add(DispatchOffer(booking_leg_id=leg.id, driver_id=c.driver.id, expires_at=expires))
        notifications.notify_driver(
            db,
            c.driver,
            "dispatch_offer",
            {"pickup": leg.pickup_region.name, "dropoff": leg.dropoff_region.name},
            {"type": "offer", "leg_id": str(leg.id)},
        )
        sent += 1
    db.flush()
    return sent


def _refresh_booking_status(booking: Booking) -> None:
    legs = [leg for leg in booking.legs if leg.status is not LegStatus.CANCELLED]
    if legs and all(leg.status is LegStatus.COMPLETED for leg in legs):
        booking.status = BookingStatus.COMPLETED
    elif any(leg.status in (LegStatus.EN_ROUTE, LegStatus.ARRIVED, LegStatus.STARTED) for leg in legs):
        booking.status = BookingStatus.IN_PROGRESS
    elif all(leg.driver_id is not None for leg in legs if leg.status is not LegStatus.COMPLETED):
        booking.status = BookingStatus.ASSIGNED
    else:
        booking.status = BookingStatus.CONFIRMED


def assign(
    db: Session,
    leg: BookingLeg,
    candidate: Candidate,
    *,
    actor_id: uuid.UUID,
    now: datetime,
    ip: str | None = None,
) -> None:
    leg.driver_id = candidate.driver.id
    leg.vehicle_id = candidate.vehicle.id
    leg.driver = candidate.driver
    leg.vehicle = candidate.vehicle
    leg.assigned_at = now
    leg.status = LegStatus.ASSIGNED
    db.add(TripEvent(booking_leg_id=leg.id, event_type=TripEventType.ASSIGNED, actor_id=actor_id))
    for offer in db.scalars(
        select(DispatchOffer).where(
            DispatchOffer.booking_leg_id == leg.id,
            DispatchOffer.status == OfferStatus.SENT,
            DispatchOffer.driver_id != candidate.driver.id,
        )
    ):
        offer.status = OfferStatus.WITHDRAWN
    _refresh_booking_status(leg.booking)
    audit.record(
        db,
        actor_id=actor_id,
        action="booking_leg.assign",
        entity_type="booking_leg",
        entity_id=leg.id,
        changes={"driver_id": candidate.driver.id, "vehicle_id": candidate.vehicle.id},
        ip=ip,
    )


def _assignable_booking(leg: BookingLeg) -> None:
    if leg.booking.status not in (BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS):
        raise Conflict("rezervasyon atamaya uygun değil", code="booking_not_assignable")
    if leg.status not in (LegStatus.PENDING, LegStatus.ASSIGNED):
        raise Conflict("bu bacak artık atanamaz", code="leg_not_assignable")


def accept_offer(db: Session, driver: Driver, offer_id: uuid.UUID, *, now: datetime) -> BookingLeg:
    offer = db.get(DispatchOffer, offer_id, with_for_update={"of": DispatchOffer})
    if offer is None or offer.driver_id != driver.id:
        raise NotFound("teklif bulunamadı")
    if offer.status is not OfferStatus.SENT:
        raise Conflict("teklif artık geçerli değil", code="offer_closed")
    if offer.expires_at <= now:
        offer.status = OfferStatus.EXPIRED
        raise Conflict("teklifin süresi doldu", code="offer_expired")
    # Aynı bacağa eşzamanlı kabulleri sıraya sokmak için bacak satırı kilitlenir.
    leg = db.get(BookingLeg, offer.booking_leg_id, with_for_update={"of": BookingLeg})
    db.refresh(leg)
    if leg.driver_id is not None:
        offer.status = OfferStatus.WITHDRAWN
        raise Conflict("iş başka bir sürücüye atandı", code="already_taken")
    _assignable_booking(leg)
    candidate = next(
        (c for c in eligible_candidates(db, leg, require_online=False, now=now) if c.driver.id == driver.id),
        None,
    )
    if candidate is None:
        raise Forbidden("bu işi almak için belgeleriniz veya aracınız uygun değil", code="not_eligible")
    offer.status = OfferStatus.ACCEPTED
    offer.responded_at = now
    assign(db, leg, candidate, actor_id=driver.user_id, now=now)
    return leg


def reject_offer(db: Session, driver: Driver, offer_id: uuid.UUID, *, now: datetime) -> None:
    offer = db.get(DispatchOffer, offer_id)
    if offer is None or offer.driver_id != driver.id:
        raise NotFound("teklif bulunamadı")
    if offer.status is OfferStatus.SENT:
        offer.status = OfferStatus.REJECTED
        offer.responded_at = now


def manual_assign(
    db: Session,
    leg: BookingLeg,
    driver_id: uuid.UUID,
    vehicle_id: uuid.UUID | None,
    *,
    actor_id: uuid.UUID,
    now: datetime,
    ip: str | None,
) -> None:
    db.refresh(leg, with_for_update={"of": BookingLeg})
    _assignable_booking(leg)
    if leg.status is not LegStatus.PENDING and leg.status is not LegStatus.ASSIGNED:
        raise Conflict("bu bacak artık atanamaz")
    candidates = eligible_candidates(db, leg, require_online=False, now=now)
    candidate = next(
        (
            c
            for c in candidates
            if c.driver.id == driver_id and (vehicle_id is None or c.vehicle.id == vehicle_id)
        ),
        None,
    )
    if candidate is None:
        raise Conflict("sürücü bu iş için uygun değil (belge, araç veya zaman çakışması)", code="not_eligible")
    assign(db, leg, candidate, actor_id=actor_id, now=now, ip=ip)


def advance_trip(
    db: Session, driver: Driver, leg: BookingLeg, event: TripEventType, *, now: datetime
) -> None:
    if leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    if event not in TRANSITIONS:
        raise Conflict("geçersiz yolculuk adımı")
    expected, target = TRANSITIONS[event]
    if leg.status is not expected:
        raise Conflict(
            f"bu adım için yolculuk '{expected.value}' durumunda olmalı",
            code="invalid_transition",
        )
    leg.status = target
    db.add(TripEvent(booking_leg_id=leg.id, event_type=event, actor_id=driver.user_id))
    if event is TripEventType.FINISHED:
        _on_leg_finished(db, leg, now)
    _refresh_booking_status(leg.booking)


def _on_leg_finished(db: Session, leg: BookingLeg, now: datetime) -> None:
    booking = leg.booking
    if leg.flight is not None:
        # K-18 (K-31 ile güncel): yolculuk tamamlanınca silinir. Kuruma bildirim zorunluluğu
        # doğrulanırsa silme, bildirim kaydedildikten sonra yapılacak (docs/acik_konular.md).
        leg.flight.purge_at = now
    split = commission.split(leg.leg_price, booking.commission_rate)
    if booking.currency is Currency.TRY:
        net_try = split.net
    else:
        # EUR tahsil edilir, sürücüye TL ödenir; kur, iş tamamlandığı andaki kurdur (K-13).
        # Kur yoksa boş kalır, hakediş ödemesi oluşturulurken o günün kuruyla doldurulur.
        rate = latest_exchange_rate(db, now)
        net_try = (split.net * rate.rate).quantize(Decimal("0.01")) if rate else None
    db.add(
        DriverLedger(
            driver_id=leg.driver_id,
            booking_leg_id=leg.id,
            gross_amount=split.gross,
            commission_amount=split.commission,
            net_amount=split.net,
            currency=booking.currency,
            net_amount_try=net_try,
        )
    )


def expire_offers(db: Session, now: datetime) -> int:
    offers = list(
        db.scalars(
            select(DispatchOffer).where(
                DispatchOffer.status == OfferStatus.SENT, DispatchOffer.expires_at <= now
            )
        )
    )
    for offer in offers:
        offer.status = OfferStatus.EXPIRED
    return len(offers)


def pending_legs(db: Session, now: datetime) -> list[BookingLeg]:
    """Ödemesi alınmış, henüz sürücüsü olmayan bacaklar (admin eşleştirme ekranı)."""
    return list(
        db.scalars(
            select(BookingLeg)
            .join(Booking)
            .where(
                and_(
                    BookingLeg.status == LegStatus.PENDING,
                    BookingLeg.driver_id.is_(None),
                    Booking.status.in_(
                        [BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS]
                    ),
                    BookingLeg.pickup_at > now - timedelta(hours=6),
                )
            )
            .order_by(BookingLeg.pickup_at)
        )
    )
