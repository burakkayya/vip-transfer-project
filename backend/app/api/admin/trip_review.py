"""Admin: şikâyet incelemesi (K-55).

- Yolculuk sohbeti (K-50) personel tarafından yalnızca gerekçe yazılarak açılır; her açılış gerekçesiyle denetim
  kaydına düşer. Mesajlar yolculuktan 30 gün sonra silindiği için daha eski sohbet boş döner.
- Müşterinin kendisinin bitirdiği yolculuklar (K-48) planlanan ve gerçekleşen süreyle listelenir; erken bitiş
  ve sürücü/yolcu anlaşmazlıkları buradan incelenir.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.admin.common import Page, page
from app.api.deps import ClientIp, DbSession, OpsOrSupport
from app.errors import NotFound
from app.localtime import LOCAL_TZ
from app.models import Booking, BookingLeg, Driver, TripEvent, TripMessage, User
from app.models.enums import TripEventType, UserKind
from app.services import audit
from app.services.messages import RETENTION

router = APIRouter(tags=["admin:trip-review"])


class ChatViewIn(BaseModel):
    # Şikâyet veya talep referansı; denetim kaydına yazılır (KVKK: amaçla sınırlı erişim).
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=300)]


@router.post("/bookings/{booking_id}/messages")
def view_chat(booking_id: uuid.UUID, body: ChatViewIn, staff: OpsOrSupport, db: DbSession, ip: ClientIp):
    """Rezervasyonun tüm bacaklarındaki müşteri–sürücü yazışması. Okundu bilgisi değişmez (personel okuması
    karşı tarafa "okundu" göstermez)."""
    b = db.get(Booking, booking_id)
    if b is None:
        raise NotFound("rezervasyon bulunamadı")
    legs = {leg.id: leg for leg in b.legs}
    rows = list(db.scalars(
        select(TripMessage).where(TripMessage.booking_leg_id.in_(legs.keys()))
        .order_by(TripMessage.created_at).limit(2000)
    ))
    # Mesajı yazan sürücü (iş devredildiyse bacağın şimdiki sürücüsünden farklı olabilir).
    senders = {d.id: d.full_name for d in db.scalars(
        select(Driver).where(Driver.id.in_({m.driver_id for m in rows if m.driver_id})))}
    audit.record(db, actor_id=staff.id, action="booking.chat_view", entity_type="booking", entity_id=b.id,
                 changes={"reason": body.reason, "message_count": len(rows)}, ip=ip)
    db.commit()
    return {
        "retention_days": RETENTION.days,
        "legs": [
            {
                "leg_id": str(leg.id),
                "leg_order": leg.leg_order,
                "status": leg.status.value,
                "driver_name": leg.driver.full_name if leg.driver else None,
                "passenger_name": b.passenger_name,
            }
            for leg in b.legs
        ],
        "messages": [
            {"id": str(m.id), "leg_id": str(m.booking_leg_id), "sender": m.sender, "body": m.body,
             "created_at": m.created_at, "read_at": m.read_at,
             "driver_name": senders.get(m.driver_id) if m.sender == "driver" else None}
            for m in rows
        ],
    }


@router.get("/trips/customer-finished")
def customer_finished(
    staff: OpsOrSupport,
    db: DbSession,
    p: Annotated[Page, Depends(page)],
    date_from: date | None = None,
    date_to: date | None = None,
    early: bool = False,
):
    """K-48: yolculuğu müşterinin bitirdiği bacaklar (bitti olayının aktörü müşteri), en yeni önce.
    `early=true`: yalnızca planlanan sürenin yarısından kısa bitenler (sayfalamadan önce veritabanında süzülür)."""
    finished = aliased(TripEvent)
    q = (
        select(BookingLeg, finished.occurred_at, Booking.booking_code)
        .join(Booking, Booking.id == BookingLeg.booking_id)
        .join(finished, (finished.booking_leg_id == BookingLeg.id) & (finished.event_type == TripEventType.FINISHED))
        .join(User, User.id == finished.actor_id)
        .where(User.kind == UserKind.CUSTOMER)
    )
    if early:
        started_ev = aliased(TripEvent)
        q = q.join(
            started_ev,
            (started_ev.booking_leg_id == BookingLeg.id) & (started_ev.event_type == TripEventType.STARTED),
        ).where(
            BookingLeg.duration_minutes.is_not(None),
            func.extract("epoch", finished.occurred_at - started_ev.occurred_at) / 60
            < BookingLeg.duration_minutes / 2.0,
        )
    if date_from:
        q = q.where(finished.occurred_at >= datetime.combine(date_from, time.min, LOCAL_TZ))
    if date_to:
        q = q.where(finished.occurred_at < datetime.combine(date_to + timedelta(days=1), time.min, LOCAL_TZ))
    rows = db.execute(q.order_by(finished.occurred_at.desc()).limit(p.limit).offset(p.offset)).all()

    started = dict(db.execute(
        select(TripEvent.booking_leg_id, TripEvent.occurred_at).where(
            TripEvent.booking_leg_id.in_([leg.id for leg, _, _ in rows]),
            TripEvent.event_type == TripEventType.STARTED,
        )
    ).all()) if rows else {}

    out = []
    for leg, finished_at, booking_code in rows:
        start = started.get(leg.id)
        actual = round((finished_at - start).total_seconds() / 60) if start else None
        out.append({
            "booking_id": str(leg.booking_id),
            "booking_code": booking_code,
            "leg_id": str(leg.id),
            "leg_order": leg.leg_order,
            "route": f"{leg.pickup_region.name} → {leg.dropoff_region.name}",
            "pickup_at": leg.pickup_at,
            "started_at": start,
            "finished_at": finished_at,
            "planned_minutes": leg.duration_minutes,
            "actual_minutes": actual,
            # Planlanan sürenin yarısından kısa bittiyse erken bitiş olarak işaretlenir.
            "early": bool(actual is not None and leg.duration_minutes and actual < leg.duration_minutes / 2),
            "distance_km": f"{leg.distance_km:.1f}",
            "driver_name": leg.driver.full_name if leg.driver else None,
        })
    return out
