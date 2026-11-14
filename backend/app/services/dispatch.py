"""Eşleştirme ve yolculuk akışı (is_modeli.md).

Anlık: uygun ve çevrimiçi sürücülere teklif gider, ilk kabul eden atanır.
İş havuzu (K-47): ödemesi alınmış, sürücüsü olmayan anlık ve planlı işler, aracına, belgelerine
ve takvimine uyan sürücülere listelenir; sürücü ayrıntıyı görüp kabul eder, ilk kabul eden atanır.
Admin her zaman manuel atayabilir. Sürücü yalnızca geçerli belgeleri varken iş alabilir.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app import commission
from app.errors import Conflict, DomainError, Forbidden, NotFound
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
    FlightDirection,
    LegStatus,
    OfferStatus,
    TripEventType,
    VehicleStatus,
)
from app.config import get_settings
from app.providers.routing import Point, haversine_km
from app.services import audit, eta, meeting, notifications, system_settings, trip_updates
from app.services.quotes import latest_exchange_rate

log = logging.getLogger(__name__)

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
    db: Session, leg: BookingLeg, *, require_online: bool, now: datetime, driver_id: uuid.UUID | None = None
) -> list[Candidate]:
    booking = leg.booking
    only = [Driver.id == driver_id] if driver_id is not None else []
    rows = db.execute(
        select(Driver, Vehicle)
        .join(DriverVehicleAssignment, DriverVehicleAssignment.driver_id == Driver.id)
        .join(Vehicle, Vehicle.id == DriverVehicleAssignment.vehicle_id)
        .where(
            Driver.status == DriverStatus.APPROVED,
            *only,
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


def offer_leg(db: Session, leg: BookingLeg, *, now: datetime, resend_closed: bool = False) -> int:
    """Uygun sürücülere teklif gönderir. Gönderilen teklif sayısını döner.

    `resend_closed`: bacak havuza geri döndüyse (REV-B-6) önceki turda geri çekilmiş veya süresi dolmuş
    teklifler yeniden açılır (bacak+sürücü benzersizdir). Sürücünün reddettiği teklif yeniden açılmaz."""
    if leg.driver_id is not None or leg.status is not LegStatus.PENDING:
        return 0
    require_online = leg.booking.booking_type is BookingType.INSTANT
    existing = {
        o.driver_id: o
        for o in db.scalars(select(DispatchOffer).where(DispatchOffer.booking_leg_id == leg.id))
    }
    expires = now + timedelta(seconds=get_settings().dispatch_offer_seconds)
    sent = 0
    for c in eligible_candidates(db, leg, require_online=require_online, now=now):
        old = existing.get(c.driver.id)
        if old is not None:
            if not (resend_closed and old.status in (OfferStatus.WITHDRAWN, OfferStatus.EXPIRED)):
                continue
            old.status = OfferStatus.SENT
            old.expires_at = expires
            old.responded_at = None
        else:
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
    trip_updates.to_customer(db, leg, "driver_assigned")
    meeting.on_assigned(leg, now)
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


def finish_radius_m(leg: BookingLeg) -> int:
    s = get_settings()
    precise = leg.dropoff_lat is not None and leg.dropoff_lng is not None
    return s.trip_finish_radius_m if precise else s.trip_finish_region_radius_m


def distance_to_dropoff_m(leg: BookingLeg, at: Point) -> int:
    return int(haversine_km(at, eta.dropoff_point(leg)) * 1000)


REJECTED_EVENT_AUDIT_SECONDS = 60


def _record_rejected_event(
    leg: BookingLeg, driver: Driver, event: TripEventType, reason_code: str, details: dict
) -> None:
    """Reddedilen sürücü adımı ayrı bir işlemle denetim kaydına yazılır; istek hatayla geri alınsa da kalır
    (BIZ-02: erken veya şüpheli bitirme denemeleri incelenebilsin). Kayıt yazılamazsa istek yine reddedilir.

    REV-B-8: tekrar eden denemeler denetim tablosunu şişirmesin diye bacak+olay başına dakikada bir kayıt yazılır
    (Redis SET NX). Redis'e ulaşılamazsa kayıt yine yazılır (kayıt kaybı yerine fazla kayıt)."""
    from app.db import SessionLocal
    from app.services import live_location

    try:
        if not live_location._redis().set(f"trip_rej:{leg.id}:{event.value}", "1", nx=True,
                                          ex=REJECTED_EVENT_AUDIT_SECONDS):
            return
    except Exception as exc:  # noqa: BLE001 - Redis hatası kaydı engellemez
        log.warning("reddedilen adım seyreltme anahtarı yazılamadı (leg=%s): %s", leg.id, type(exc).__name__)
    try:
        with SessionLocal() as s:
            audit.record(s, actor_id=driver.user_id, action="booking_leg.event_rejected",
                         entity_type="booking_leg", entity_id=leg.id,
                         changes={"event": event, "reason_code": reason_code, **details})
            s.commit()
    except Exception:  # noqa: BLE001
        log.exception("reddedilen yolculuk adımı denetim kaydına yazılamadı (leg=%s)", leg.id)


def _reject(leg: BookingLeg, driver: Driver, event: TripEventType, code: str, message: str, **details) -> None:
    _record_rejected_event(leg, driver, event, code, details)
    raise Conflict(message, code=code)


def _started_at(db: Session, leg: BookingLeg) -> datetime | None:
    return db.scalar(
        select(TripEvent.occurred_at)
        .where(TripEvent.booking_leg_id == leg.id, TripEvent.event_type == TripEventType.STARTED)
        .order_by(TripEvent.occurred_at.desc())
        .limit(1)
    )


def planned_minutes(leg: BookingLeg) -> float:
    """Planlanan yolculuk süresi; rota süresi yoksa mesafeden (ortalama 60 km/sa) tahmin edilir."""
    if leg.duration_minutes:
        return float(leg.duration_minutes)
    return max(1.0, float(leg.distance_km or 0))


def _parse_at(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def effective_pickup_at(leg: BookingLeg) -> datetime:
    """REV-B-5: zaman penceresinin dayanağı. Havalimanından alışta (geliş uçuşu) uçuş takibinin tahmini veya
    gerçekleşen inişi alıştan erkense o kullanılır; uçak erken inerse sürücü yolcuyu alabilir. Pencere yalnızca
    genişler, hiçbir zaman daralmaz."""
    basis = leg.pickup_at
    fi = leg.flight
    if fi is not None and fi.direction is FlightDirection.ARRIVAL:
        for t in (fi.estimated_at, fi.actual_at):
            if t is not None and t < basis:
                basis = t
    return basis


def _check_time_window(leg: BookingLeg, driver: Driver, event: TripEventType, now: datetime) -> None:
    """BIZ-02: "yola çıktım" ve "yolcu alındı" alış zamanına (uçak erken indiyse tahmini inişe) göre bir
    pencerenin içinde kabul edilir."""
    s = get_settings()
    basis = effective_pickup_at(leg)
    if event is TripEventType.DEPARTED:
        earliest = basis - timedelta(minutes=s.trip_depart_window_minutes)
        if now < earliest:
            _reject(leg, driver, event, "too_early_to_depart",
                    f"yola en erken alıştan {s.trip_depart_window_minutes} dk önce çıkabilirsiniz",
                    pickup_at=leg.pickup_at, earliest=earliest)
    elif event is TripEventType.STARTED:
        earliest = basis - timedelta(minutes=s.trip_start_early_minutes)
        if now < earliest:
            _reject(leg, driver, event, "too_early_to_start",
                    f"yolculuk en erken alıştan {s.trip_start_early_minutes} dk önce başlatılabilir",
                    pickup_at=leg.pickup_at, earliest=earliest)


def _speed_kmh(distance_m: float, slack_m: float, seconds: float) -> float:
    return max(0.0, distance_m - slack_m) / max(seconds, 1.0) * 3.6


def _check_finish(db: Session, leg: BookingLeg, driver: Driver, at: Point, now: datetime) -> float | None:
    """BIZ-02: "bitti" için asgari süre ve konum makullüğü. Gerçekleşen dakikayı döner (bilinmiyorsa None).

    Sınırlama: konum istemcinin beyanıdır. Bu kontroller kaba sahteciliği (alış anında varış koordinatı
    göndermek, saniyeler içinde onlarca km sıçramak) yakalar; sahte GPS (mocked) tespiti mobil tarafta F2-17'dir.
    """
    s = get_settings()
    started = _started_at(db, leg)
    if started is None:
        return None
    elapsed = (now - started).total_seconds()
    planned = planned_minutes(leg)
    minimum = planned * s.trip_min_duration_ratio
    if elapsed < minimum * 60:
        _reject(leg, driver, TripEventType.FINISHED, "trip_too_short",
                f"yolculuk başlayalı {int(elapsed // 60)} dk oldu; en erken {int(minimum + 0.999)} dk sonra bitirilebilir",
                elapsed_minutes=round(elapsed / 60, 1), planned_minutes=planned)

    # Alıştan bitiş konumuna, başlangıçtan bu yana geçen sürede gidilebilir mi?
    pickup = eta.pickup_point(leg)
    pickup_slack = (s.trip_finish_radius_m if leg.pickup_lat is not None and leg.pickup_lng is not None
                    else s.trip_finish_region_radius_m)
    from_pickup_m = float(haversine_km(pickup, at)) * 1000
    checks = [_speed_kmh(from_pickup_m, pickup_slack, elapsed)]
    # Son paylaşılan konum örneğinden bitiş konumuna sıçrama.
    from app.services import live_location

    last = live_location.for_leg(leg)
    if last and (last_at := _parse_at(last.get("at"))) is not None:
        try:
            prev = Point(Decimal(str(last["lat"])), Decimal(str(last["lng"])))
        except (KeyError, ArithmeticError, ValueError):
            prev = None
        if prev is not None:
            jump_m = float(haversine_km(prev, at)) * 1000
            checks.append(_speed_kmh(jump_m, s.trip_location_jump_slack_m, (now - last_at).total_seconds()))
    speed = max(checks)
    if speed > s.trip_max_speed_kmh:
        _reject(leg, driver, TripEventType.FINISHED, "implausible_location",
                "konumunuz doğrulanamadı; lütfen konum servislerini kontrol edip tekrar deneyin",
                implied_speed_kmh=round(speed), limit_kmh=s.trip_max_speed_kmh)
    return elapsed / 60


def advance_trip(
    db: Session, driver: Driver, leg: BookingLeg, event: TripEventType, *, now: datetime,
    at: Point | None = None,
) -> None:
    """Sürücü adımı. `at` sürücünün o anki konumudur (yoksa son paylaşılan konum kullanılır).

    K-49: "Yolculuğu bitir" yalnızca varışa `finish_radius_m` içindeyken kabul edilir.
    BIZ-02: adımlar sırayla ve alış zamanına göre bir pencere içinde kabul edilir; "bitti" için asgari süre ve
    konum sıçraması kontrol edilir. Reddedilen ve erken (planlanan sürenin yarısından kısa) bitişler denetim
    kaydına yazılır.
    """
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
    _check_time_window(leg, driver, event, now)
    actual_minutes: float | None = None
    if event is TripEventType.FINISHED:
        if at is None:
            raise DomainError("yolculuğu bitirmek için konumunuz gerekli", code="location_required")
        radius = finish_radius_m(leg)
        distance = distance_to_dropoff_m(leg, at)
        if distance > radius:
            raise DomainError(
                f"varış noktasına {distance} m uzaktasınız; {radius} m içinde bitirebilirsiniz",
                code="too_far_from_dropoff",
            )
        actual_minutes = _check_finish(db, leg, driver, at, now)
    if event is TripEventType.FINISHED and actual_minutes is not None:
        planned = planned_minutes(leg)
        if actual_minutes < planned * get_settings().trip_early_finish_ratio:
            audit.record(db, actor_id=driver.user_id, action="booking_leg.driver_early_finish",
                         entity_type="booking_leg", entity_id=leg.id,
                         changes={"actual_minutes": round(actual_minutes, 1), "planned_minutes": leg.duration_minutes,
                                  "pickup_at": leg.pickup_at})
    _apply_transition(db, leg, event, target, actor_id=driver.user_id, now=now, at=at)


def force_advance(
    db: Session, leg: BookingLeg, event: TripEventType, *, actor_id: uuid.UUID, reason: str, now: datetime,
    ip: str | None,
) -> None:
    """REV-B-5: operasyonun "zorla ilerlet" adımı. Sürücü zaman/konum kontrollerine takılıp kilitlendiğinde
    (ör. `trip_too_short`, `implausible_location`, uçuş bilgisi olmadan erken iniş) kullanılır.

    Zaman penceresi, varış yarıçapı, asgari süre ve konum makullüğü kontrollerini ATLAR; durum makinesi sırasını
    ATLAMAZ (her çağrı tek adım ilerletir). Gerekçe zorunludur ve denetim kaydına yazılır. Çağıran bacak
    satırını kilitlemiş olmalıdır."""
    if leg.driver_id is None:
        raise Conflict("bacağa atanmış sürücü yok", code="leg_not_assigned")
    if event not in TRANSITIONS:
        raise Conflict("geçersiz yolculuk adımı", code="invalid_transition")
    expected, target = TRANSITIONS[event]
    if leg.status is not expected:
        raise Conflict(f"bu adım için yolculuk '{expected.value}' durumunda olmalı", code="invalid_transition")
    old = leg.status
    _apply_transition(db, leg, event, target, actor_id=actor_id, now=now, at=None)
    audit.record(db, actor_id=actor_id, action="booking_leg.force_advance", entity_type="booking_leg",
                 entity_id=leg.id, ip=ip,
                 changes={"event": event.value, "old_status": old.value, "new_status": target.value,
                          "driver_id": leg.driver_id, "reason": reason})


def _apply_transition(
    db: Session, leg: BookingLeg, event: TripEventType, target: LegStatus, *, actor_id: uuid.UUID,
    now: datetime, at: Point | None,
) -> None:
    leg.status = target
    # K-63: konum yalnızca kanıt gereken olaylarda saklanır (varış, bitiş); yola çıkış konumu sürücünün evi
    # olabileceği için tutulmaz.
    keep = at is not None and event in (TripEventType.ARRIVED, TripEventType.FINISHED)
    db.add(TripEvent(booking_leg_id=leg.id, event_type=event, actor_id=actor_id,
                     latitude=at.lat if keep else None, longitude=at.lng if keep else None))
    if event is TripEventType.DEPARTED:
        eta.on_departed(db, leg, at)
    elif event is TripEventType.ARRIVED:
        leg.arrived_at = now  # K-63: ücretsiz bekleme buradan sayılır
        trip_updates.to_customer(db, leg, "driver_arrived")
        meeting.maybe_send_guide(db, leg, now)
    elif event is TripEventType.STARTED:
        trip_updates.to_customer(db, leg, "trip_started", eta=leg.duration_minutes or "—")
    elif event is TripEventType.FINISHED:
        _on_leg_finished(db, leg, now)
        trip_updates.to_customer(db, leg, "trip_finished")
        eta.clear(leg)
    _refresh_booking_status(leg.booking)


def finish_by_customer(db: Session, booking: Booking, actor_id: uuid.UUID, *, now: datetime) -> BookingLeg:
    """K-48: müşteri yolculuğu her an (yolcu araçtayken) bitirebilir; tamamlandı sayılır, iade yoktur."""
    leg = next((leg for leg in booking.legs if leg.status is LegStatus.STARTED), None)
    if leg is None:
        raise Conflict("bitirilecek aktif yolculuk yok", code="no_active_trip")
    db.refresh(leg, with_for_update={"of": BookingLeg})
    if leg.status is not LegStatus.STARTED:
        raise Conflict("bitirilecek aktif yolculuk yok", code="no_active_trip")
    leg.status = LegStatus.COMPLETED
    db.add(TripEvent(booking_leg_id=leg.id, event_type=TripEventType.FINISHED, actor_id=actor_id))
    _on_leg_finished(db, leg, now)
    trip_updates.to_driver(db, leg, "customer_finished")
    eta.clear(leg)
    _refresh_booking_status(booking)
    audit.record(db, actor_id=actor_id, action="booking_leg.customer_finish", entity_type="booking_leg",
                 entity_id=leg.id)
    return leg


# --- İş havuzu (K-47) ---------------------------------------------------------

POOL_LOOKBACK = timedelta(minutes=30)
POOL_LIMIT = 50


def _pool_query(driver: Driver, now: datetime):
    vehicle_types = (
        select(Vehicle.vehicle_type_id)
        .join(DriverVehicleAssignment, DriverVehicleAssignment.vehicle_id == Vehicle.id)
        .where(
            DriverVehicleAssignment.driver_id == driver.id,
            DriverVehicleAssignment.valid_from <= now,
            or_(DriverVehicleAssignment.valid_to.is_(None), DriverVehicleAssignment.valid_to > now),
            Vehicle.status == VehicleStatus.ACTIVE,
        )
    )
    declined = select(DispatchOffer.booking_leg_id).where(
        DispatchOffer.driver_id == driver.id, DispatchOffer.status == OfferStatus.REJECTED
    )
    q = (
        select(BookingLeg)
        .join(Booking)
        .where(
            BookingLeg.status == LegStatus.PENDING,
            BookingLeg.driver_id.is_(None),
            Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS]),
            Booking.vehicle_type_id.in_(vehicle_types),
            BookingLeg.pickup_at > now - POOL_LOOKBACK,
            BookingLeg.id.not_in(declined),
        )
    )
    # Anlık işler yalnızca çevrimiçi sürücüye; planlı işler onaylı her uygun sürücüye görünür.
    if not driver.is_online:
        q = q.where(Booking.booking_type == BookingType.SCHEDULED)
    return q.order_by(BookingLeg.pickup_at).limit(POOL_LIMIT)


def open_jobs(db: Session, driver: Driver, now: datetime) -> list[tuple[BookingLeg, Candidate]]:
    if driver.status is not DriverStatus.APPROVED:
        return []
    out: list[tuple[BookingLeg, Candidate]] = []
    for leg in db.scalars(_pool_query(driver, now)):
        candidate = _candidate_for(db, leg, driver, now)
        if candidate is not None:
            out.append((leg, candidate))
    return out


def _candidate_for(db: Session, leg: BookingLeg, driver: Driver, now: datetime) -> Candidate | None:
    return next(iter(eligible_candidates(db, leg, require_online=False, now=now, driver_id=driver.id)), None)


def job_for(db: Session, driver: Driver, leg_id: uuid.UUID, now: datetime) -> BookingLeg:
    """Havuzdaki tek iş (ayrıntı ekranı). Sürücüye uygun değilse 404, alındıysa 409."""
    leg = db.get(BookingLeg, leg_id)
    if leg is None:
        raise NotFound("iş bulunamadı")
    if leg.driver_id == driver.id:
        raise Conflict("bu işi zaten aldınız", code="already_yours")
    if leg.driver_id is not None or leg.status is not LegStatus.PENDING:
        raise Conflict("iş başka bir sürücüye atandı", code="already_taken")
    if leg.booking.booking_type is BookingType.INSTANT and not driver.is_online:
        raise Forbidden("anlık işler için çevrimiçi olun", code="driver_offline")
    if _candidate_for(db, leg, driver, now) is None:
        raise NotFound("iş bulunamadı")
    return leg


def accept_job(db: Session, driver: Driver, leg_id: uuid.UUID, *, now: datetime) -> BookingLeg:
    leg = db.get(BookingLeg, leg_id, with_for_update={"of": BookingLeg})
    if leg is None:
        raise NotFound("iş bulunamadı")
    db.refresh(leg)
    if leg.driver_id is not None:
        raise Conflict("iş başka bir sürücüye atandı", code="already_taken")
    _assignable_booking(leg)
    if leg.booking.booking_type is BookingType.INSTANT and not driver.is_online:
        raise Forbidden("anlık işler için çevrimiçi olun", code="driver_offline")
    candidate = _candidate_for(db, leg, driver, now)
    if candidate is None:
        raise Forbidden("bu işi almak için belgeleriniz, aracınız veya takviminiz uygun değil", code="not_eligible")
    offer = db.scalar(select(DispatchOffer).where(DispatchOffer.booking_leg_id == leg.id,
                                                  DispatchOffer.driver_id == driver.id))
    if offer is not None:
        offer.status = OfferStatus.ACCEPTED
        offer.responded_at = now
    assign(db, leg, candidate, actor_id=driver.user_id, now=now)
    return leg


def decline_job(db: Session, driver: Driver, leg_id: uuid.UUID, *, now: datetime) -> None:
    """İş bu sürücünün havuzundan kalkar (reddedilmiş teklif olarak kaydedilir)."""
    leg = db.get(BookingLeg, leg_id)
    if leg is None:
        raise NotFound("iş bulunamadı")
    offer = db.scalar(select(DispatchOffer).where(DispatchOffer.booking_leg_id == leg.id,
                                                  DispatchOffer.driver_id == driver.id))
    if offer is None:
        db.add(DispatchOffer(booking_leg_id=leg.id, driver_id=driver.id, status=OfferStatus.REJECTED,
                             expires_at=now, responded_at=now))
    elif offer.status in (OfferStatus.SENT, OfferStatus.EXPIRED):
        offer.status = OfferStatus.REJECTED
        offer.responded_at = now


# --- Askıya alma (AUTH-06) ------------------------------------------------------

# Yolcu henüz araca binmemiş bacaklar. STARTED (yolcu araçta) bacağa dokunulmaz: yolculuğu ortada
# havuza düşürmek yolcu güvenliğini bozar; operasyon bu bacağı elle yönetir (denetim kaydına yazılır).
RELEASABLE_ON_SUSPEND = (LegStatus.ASSIGNED, LegStatus.EN_ROUTE, LegStatus.ARRIVED)


def release_driver(
    db: Session, driver: Driver, *, actor_id: uuid.UUID | None, ip: str | None, now: datetime
) -> int:
    """Onayı kaldırılan (askıya alınan, pasifleştirilen) sürücünün etkileri. Havuza dönen bacak sayısını döner.

    - Yolcu alınmamış bacaklar PENDING'e döner (sürücü ve araç ataması kaldırılır); iş havuzunda ve admin
      eşleştirme ekranında yeniden görünür.
    - Sürücüye gönderilmiş açık teklifler geri çekilir.
    - Sürücünün tüm oturumları iptal edilir (erişim jetonu da oturuma bağlı olduğu için hemen geçersizleşir).
    - REV-B-6: havuza dönen her bacak için uygun sürücülere yeniden teklif gönderilir; sonuç denetim kaydına
      ve loga yazılır (hiç teklif gidemediyse operasyon elle eşleştirmeli).
    - `actor_id=None`: sistem (zamanlanmış görev) tarafından çağrı.
    """
    from app.models import AuthSession
    from app.services import live_location

    legs = list(db.scalars(
        select(BookingLeg)
        .where(BookingLeg.driver_id == driver.id, BookingLeg.status.in_(RELEASABLE_ON_SUSPEND))
        .with_for_update(of=BookingLeg)
    ))
    for leg in legs:
        old_status = leg.status
        leg.driver_id = None
        leg.vehicle_id = None
        leg.driver = None
        leg.vehicle = None
        leg.assigned_at = None
        leg.status = LegStatus.PENDING
        eta.clear(leg)
        live_location.clear(leg)
        _refresh_booking_status(leg.booking)
        audit.record(db, actor_id=actor_id, action="booking_leg.release_suspended_driver",
                     entity_type="booking_leg", entity_id=leg.id,
                     changes={"driver_id": driver.id, "old_status": old_status, "pickup_at": leg.pickup_at}, ip=ip)

    started = list(db.scalars(
        select(BookingLeg.id).where(BookingLeg.driver_id == driver.id, BookingLeg.status == LegStatus.STARTED)
    ))
    if started:
        audit.record(db, actor_id=actor_id, action="driver.suspended_with_active_trip", entity_type="driver",
                     entity_id=driver.id, changes={"started_leg_ids": started}, ip=ip)

    for offer in db.scalars(select(DispatchOffer).where(DispatchOffer.driver_id == driver.id,
                                                        DispatchOffer.status == OfferStatus.SENT)):
        offer.status = OfferStatus.WITHDRAWN

    db.flush()
    for leg in legs:
        sent = offer_leg(db, leg, now=now, resend_closed=True)
        audit.record(db, actor_id=actor_id, action="booking_leg.reoffer_after_release", entity_type="booking_leg",
                     entity_id=leg.id, changes={"offers_sent": sent, "released_driver_id": driver.id}, ip=ip)
        if sent:
            log.info("askıya alınan sürücüden dönen bacak yeniden teklife açıldı (leg=%s, teklif=%s)", leg.id, sent)
        else:
            log.warning("askıya alınan sürücüden dönen bacağa uygun sürücü yok, elle eşleştirme gerekli (leg=%s)",
                        leg.id)

    revoked = 0
    for session in db.scalars(select(AuthSession).where(AuthSession.user_id == driver.user_id,
                                                        AuthSession.revoked_at.is_(None))):
        session.revoked_at = now
        revoked += 1
    audit.record(db, actor_id=actor_id, action="driver.release", entity_type="driver", entity_id=driver.id,
                 changes={"released_legs": len(legs), "revoked_sessions": revoked}, ip=ip)
    return len(legs)


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
