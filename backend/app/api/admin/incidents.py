"""K-83 admin: olaylar ve rezervasyon bazında yolculuk geçmişi.

Erişim: admin ve operasyon (kullanıcı kararı). Destek ve muhasebe göremez.
- Olay listesi ve ayrıntısı maskelenmiş teknik bilgidir; gerekçe istemez.
- Yolculuk geçmişi kişisel ayrıntı (aktör, konum) içerdiği için gerekçe yazılarak açılır; açılış gerekçesiyle
  denetim kaydına düşer (K-55 sohbet incelemesiyle aynı model).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select

from app.api.admin.common import Page, page
from app.api.deps import ClientIp, DbSession, OpsStaff
from app.errors import Conflict, NotFound
from app.models import Booking, Incident, IncidentOccurrence, User
from app.security.crypto import mask_email
from app.retention import ACTIVITY_DAYS, LOCATION_DAYS, POLICY
from app.services import activity, audit, incidents

router = APIRouter(tags=["admin:incidents"])

OCCURRENCE_LIMIT = 50


def _incident_out(i: Incident) -> dict:
    return {
        "id": str(i.id), "level": i.level, "source": i.source, "kind": i.kind, "code": i.code, "title": i.title,
        "status": i.status, "occurrence_count": i.occurrence_count, "first_seen_at": i.first_seen_at,
        "last_seen_at": i.last_seen_at, "last_notified_at": i.last_notified_at,
    }


@router.get("/incidents")
def list_incidents(
    staff: OpsStaff,
    db: DbSession,
    p: Annotated[Page, Depends(page)],
    status: Annotated[Literal["open", "acknowledged", "resolved", "active"] | None, Query()] = "active",
    level: Annotated[Literal["warning", "error", "critical"] | None, Query()] = None,
    source: Annotated[str | None, Query(max_length=20)] = None,
):
    q = select(Incident)
    if status == "active":
        q = q.where(Incident.status != "resolved")
    elif status:
        q = q.where(Incident.status == status)
    if level:
        q = q.where(Incident.level == level)
    if source:
        q = q.where(Incident.source == source)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(Incident.last_seen_at.desc()).limit(p.limit).offset(p.offset))
    return {"total": total, "items": [_incident_out(i) for i in rows]}


@router.get("/incidents/count")
def incident_count(staff: OpsStaff, db: DbSession):
    """Menüdeki rozet: çözülmemiş olay sayısı ve aralarında kritik olan var mı."""
    active = select(Incident).where(Incident.status != "resolved")
    total = db.scalar(select(func.count()).select_from(active.subquery())) or 0
    critical = db.scalar(select(func.count()).select_from(
        active.where(Incident.level == "critical").subquery())) or 0
    return {"active": total, "critical": critical}


def _names(db, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    # Personelin adı tutulmuyor; maskelenmiş e-posta yeterince ayırt edici.
    return {u.id: (mask_email(u.email) if u.email else "personel")
            for u in db.scalars(select(User).where(User.id.in_(ids)))}


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: uuid.UUID, staff: OpsStaff, db: DbSession):
    i = db.get(Incident, incident_id)
    if i is None:
        raise NotFound("olay bulunamadı")
    occurrences = list(db.scalars(
        select(IncidentOccurrence).where(IncidentOccurrence.incident_id == i.id)
        .order_by(IncidentOccurrence.occurred_at.desc()).limit(OCCURRENCE_LIMIT)))
    bookings = {b.id: b.booking_code for b in db.scalars(
        select(Booking).where(Booking.id.in_({o.booking_id for o in occurrences if o.booking_id})))}
    names = _names(db, {i.acknowledged_by, i.resolved_by})
    return {
        **_incident_out(i),
        "detail": i.detail,
        "acknowledged_at": i.acknowledged_at, "acknowledged_by": names.get(i.acknowledged_by),
        "resolved_at": i.resolved_at, "resolved_by": names.get(i.resolved_by), "resolution_note": i.resolution_note,
        "occurrences": [
            {"id": str(o.id), "occurred_at": o.occurred_at, "request_id": o.request_id,
             "booking_id": str(o.booking_id) if o.booking_id else None,
             "booking_code": bookings.get(o.booking_id),
             "context": json.loads(o.context) if o.context else {}}
            for o in occurrences
        ],
    }


class IncidentStatusIn(BaseModel):
    status: Literal["acknowledged", "resolved", "open"]
    # Çözüldü işaretinde ne yapıldığı zorunludur (sonraki tekrar incelemesi için).
    note: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=1000)] = None


@router.post("/incidents/{incident_id}/status")
def set_incident_status(incident_id: uuid.UUID, body: IncidentStatusIn, staff: OpsStaff, db: DbSession,
                        ip: ClientIp):
    i = db.get(Incident, incident_id, with_for_update=True)
    if i is None:
        raise NotFound("olay bulunamadı")
    if body.status == "resolved" and not (body.note and len(body.note) >= 5):
        raise Conflict("çözüm notu en az 5 karakter olmalı", code="note_required")
    now = datetime.now(timezone.utc)
    previous = i.status
    i.status = body.status
    if body.status == "acknowledged":
        i.acknowledged_by, i.acknowledged_at = staff.id, now
    elif body.status == "resolved":
        i.resolved_by, i.resolved_at = staff.id, now
        i.resolution_note = audit.scrub_text(body.note, 1000)
    else:  # yeniden açma
        i.resolved_by = i.resolved_at = None
    audit.record(db, actor_id=staff.id, action="incident.status", entity_type="incident", entity_id=i.id,
                 changes={"from": previous, "to": body.status}, ip=ip)
    db.commit()
    return _incident_out(i)


def _uuid_or_none(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


class TimelineIn(BaseModel):
    # Şikâyet/talep ya da olay referansı; denetim kaydına yazılır (KVKK: amaçla sınırlı erişim).
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=300)]


@router.post("/bookings/{booking_id}/timeline")
def booking_timeline(booking_id: uuid.UUID, body: TimelineIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    b = db.get(Booking, booking_id)
    if b is None:
        raise NotFound("rezervasyon bulunamadı")
    items = activity.timeline(db, b)
    staff_ids = {sid for i in items if i["actor_type"] == "staff" and (sid := _uuid_or_none(i["actor_id"]))}
    names = _names(db, staff_ids)
    for item in items:
        if item["actor_type"] == "staff":
            item["actor_name"] = names.get(_uuid_or_none(item["actor_id"]))
    audit.record(db, actor_id=staff.id, action="booking.timeline_view", entity_type="booking", entity_id=b.id,
                 changes={"reason": body.reason, "item_count": len(items)}, ip=ip)
    db.commit()
    return {
        "booking_code": b.booking_code,
        "retention": {"activity_days": ACTIVITY_DAYS, "location_days": LOCATION_DAYS},
        "items": items,
    }


@router.get("/retention-policy")
def retention_policy(staff: OpsStaff):
    """Saklama süreleri (tek kaynak `app/retention.py`); admin bilgi ekranı için."""
    return {"items": [
        {"data": r.data, "days": r.days, "action": r.action, "basis": r.basis} for r in POLICY
    ]}


__all__ = ["router", "incidents"]
