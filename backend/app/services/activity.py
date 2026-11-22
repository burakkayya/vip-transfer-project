"""K-83: rezervasyon bazında yolculuk geçmişi.

`record()` adımı isteğin kendi işlemine ekler: işlem geri alınırsa adım da yazılmaz (olmayan bir adım geçmişte
görünmez). Ayrıntıda kişisel veri tutulmaz; konum yalnızca önemli anlarda ve şifreli.

`timeline()` admin görünümü içindir: bu tabloyu, mevcut `trip_events` (eski rezervasyonlar dahil) ve
rezervasyona bağlı denetim kayıtları ile olaylarla birleştirip zaman sırasıyla döner.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import request_context
from app.models import (
    AuditLog,
    Booking,
    BookingActivity,
    Incident,
    IncidentOccurrence,
    Payment,
    Refund,
    TripEvent,
    TripUpdate,
    User,
)
from app.models.enums import UserKind
from app.services import audit

ACTOR_TYPES = frozenset({"customer", "driver", "staff", "system"})
# Önemli anlar: konum yalnızca bunlarda yazılır (K-83, kullanıcı kararı "adımlar + önemli anda konum").
# K-63 ile aynı: yola çıkış konumu sürücünün evi olabileceği için tutulmaz.
LOCATION_EVENTS = frozenset({"leg.arrived", "leg.finished", "leg.no_show"})
TIMELINE_LIMIT = 2000
_USER_KIND_ACTOR = {UserKind.CUSTOMER: "customer", UserKind.DRIVER: "driver", UserKind.STAFF: "staff"}
# Hem denetim kaydında hem geçmişte yazılan adımlar: geçmiş kaydı (platform ve sürüm bilgili) varsa denetimdeki
# karşılığı listede tekrar edilmez.
_AUDIT_EQUIVALENT = {
    "booking.create": "booking.created",
    "booking.admin_create": "booking.created",
    "payment.paid": "payment.succeeded",
    "booking_leg.assign": "leg.assigned",
    "booking_leg.customer_finish": "leg.customer_finished",
    "booking_leg.no_show": "leg.no_show",
}


def _platform_for(actor_type: str) -> str | None:
    ctx = request_context.current()
    if ctx.platform:
        return ctx.platform
    return "system" if actor_type == "system" else None


def record(
    db: Session,
    booking: Booking | uuid.UUID,
    event: str,
    *,
    actor_type: str | None = None,
    actor_id: uuid.UUID | str | None = None,
    leg_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
    latitude: Decimal | float | None = None,
    longitude: Decimal | float | None = None,
    at: datetime | None = None,
) -> None:
    """Adımı yazar. Aktör verilmezse istek bağlamından (giriş yapan kullanıcı) alınır; istek dışında sistemdir."""
    ctx = request_context.current()
    if actor_type is None:
        actor_type = ctx.actor_type or "system"
        if actor_id is None and ctx.actor_id:
            actor_id = ctx.actor_id
    if actor_type not in ACTOR_TYPES:
        actor_type = "system"
    location = None
    if event in LOCATION_EVENTS and latitude is not None and longitude is not None:
        location = f"{float(latitude):.6f},{float(longitude):.6f}"
    row = BookingActivity(
        booking_id=booking.id if isinstance(booking, Booking) else booking,
        booking_leg_id=leg_id,
        actor_type=actor_type,
        actor_id=uuid.UUID(str(actor_id)) if actor_id else None,
        event=event[:60],
        platform=_platform_for(actor_type),
        app_version=ctx.app_version,
        request_id=ctx.request_id,
        data=audit.clean(data) if data else None,
        location=location,
    )
    if at is not None:
        row.occurred_at = at
    db.add(row)


# --- Admin görünümü -------------------------------------------------------------------------------------------

_TRIP_EVENT_CODES = {
    "atandi": "leg.assigned",
    "yola_cikti": "leg.departed",
    "vardi": "leg.arrived",
    "basladi": "leg.started",
    "bitti": "leg.finished",
    "gelmedi": "leg.no_show",
}


def _loc(lat: Any, lon: Any) -> dict | None:
    if lat is None or lon is None:
        return None
    return {"lat": float(lat), "lng": float(lon)}


def timeline(db: Session, booking: Booking) -> list[dict[str, Any]]:
    """Rezervasyonun tüm kaynaklardan birleşik, zaman sıralı geçmişi."""
    leg_ids = [leg.id for leg in booking.legs]
    leg_order = {leg.id: leg.leg_order for leg in booking.legs}
    items: list[dict[str, Any]] = []

    own_events: set[tuple[str, uuid.UUID | None]] = set()
    for a in db.scalars(select(BookingActivity).where(BookingActivity.booking_id == booking.id)
                        .order_by(BookingActivity.occurred_at).limit(TIMELINE_LIMIT)):
        location = None
        if a.location:
            lat, _, lon = a.location.partition(",")
            location = _loc(lat, lon)
        own_events.add((a.event, a.booking_leg_id))
        items.append({
            "at": a.occurred_at, "source": "activity", "event": a.event, "actor_type": a.actor_type,
            "actor_id": str(a.actor_id) if a.actor_id else None, "leg_order": leg_order.get(a.booking_leg_id),
            "platform": a.platform, "app_version": a.app_version, "request_id": a.request_id,
            "data": a.data or {}, "location": location,
        })

    if leg_ids:
        # K-83 öncesi adımlar yalnızca trip_events'te; yeni kayıtta aynı adım geçmişte zaten varsa tekrar edilmez.
        for e in db.scalars(select(TripEvent).where(TripEvent.booking_leg_id.in_(leg_ids))
                            .order_by(TripEvent.occurred_at).limit(TIMELINE_LIMIT)):
            code = _TRIP_EVENT_CODES.get(e.event_type.value, f"leg.{e.event_type.value}")
            if (code, e.booking_leg_id) in own_events:
                continue
            items.append({
                "at": e.occurred_at, "source": "trip_event", "event": code,
                "actor_type": "driver" if code != "leg.assigned" else "staff",
                "actor_id": str(e.actor_id) if e.actor_id else None, "leg_order": leg_order.get(e.booking_leg_id),
                "platform": None, "app_version": None, "request_id": None, "data": {},
                "location": _loc(e.latitude, e.longitude),
            })

    payment_ids = [str(p) for p in db.scalars(select(Payment.id).where(Payment.booking_id == booking.id))]
    refund_ids = [str(r) for r in db.scalars(
        select(Refund.id).join(Payment, Refund.payment_id == Payment.id).where(Payment.booking_id == booking.id))]
    entity_filters = [
        (AuditLog.entity_type == "booking") & (AuditLog.entity_id == str(booking.id)),
    ]
    if leg_ids:
        entity_filters.append((AuditLog.entity_type == "booking_leg")
                              & AuditLog.entity_id.in_([str(i) for i in leg_ids]))
    if payment_ids:
        entity_filters.append((AuditLog.entity_type == "payment") & AuditLog.entity_id.in_(payment_ids))
    if refund_ids:
        entity_filters.append((AuditLog.entity_type == "refund") & AuditLog.entity_id.in_(refund_ids))
    own_codes = {code for code, _ in own_events}
    audit_rows = [r for r in db.scalars(select(AuditLog).where(or_(*entity_filters))
                                        .order_by(AuditLog.created_at).limit(TIMELINE_LIMIT))
                  if _AUDIT_EQUIVALENT.get(r.action) not in own_codes]
    # Denetim kaydında yalnızca kullanıcı kimliği var; aktör türü kullanıcının türünden okunur.
    kinds = {u.id: _USER_KIND_ACTOR.get(u.kind, "staff") for u in db.scalars(
        select(User).where(User.id.in_({r.actor_id for r in audit_rows if r.actor_id})))}
    for log_row in audit_rows:
        items.append({
            "at": log_row.created_at, "source": "audit", "event": log_row.action,
            "actor_type": kinds.get(log_row.actor_id, "staff") if log_row.actor_id else "system",
            "actor_id": str(log_row.actor_id) if log_row.actor_id else None, "leg_order": None,
            "platform": None, "app_version": None, "request_id": None,
            "data": log_row.changes or {}, "location": None,
        })

    for occ, inc in db.execute(
        select(IncidentOccurrence, Incident).join(Incident, Incident.id == IncidentOccurrence.incident_id)
        .where(IncidentOccurrence.booking_id == booking.id).order_by(IncidentOccurrence.occurred_at).limit(200)
    ):
        context = json.loads(occ.context) if occ.context else {}
        items.append({
            "at": occ.occurred_at, "source": "incident", "event": "incident",
            "actor_type": context.get("actor_type") or "system", "actor_id": context.get("actor_id"),
            "leg_order": None, "platform": context.get("platform"), "app_version": context.get("app_version"),
            "request_id": occ.request_id, "location": None,
            "data": {"incident_id": str(inc.id), "level": inc.level, "title": inc.title, "status": inc.status},
        })

    if leg_ids:
        # Bildirim akışı: hangi bildirimin kime gittiği. Başlık ve metin (ad, mesaj önizlemesi) yazılmaz.
        for u in db.scalars(select(TripUpdate).where(TripUpdate.booking_leg_id.in_(leg_ids))
                            .order_by(TripUpdate.created_at).limit(TIMELINE_LIMIT)):
            items.append({
                "at": u.created_at, "source": "notification", "event": f"notify.{u.code}",
                "actor_type": "system", "actor_id": None, "leg_order": leg_order.get(u.booking_leg_id),
                "platform": None, "app_version": None, "request_id": None,
                "data": {"recipient": u.recipient_type}, "location": None,
            })

    items.sort(key=lambda i: i["at"])
    return items[:TIMELINE_LIMIT]
