"""Admin: havalimanı buluşma rehberleri (K-62). Terminal başına en çok 8 adım; her adımın metni dillere
göre ve isteğe bağlı fotoğrafı vardır. Müşteri rehberi kendi dilinde görür (yoksa İngilizce, o da yoksa Türkçe)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import ClientIp, DbSession, Now, OpsStaff
from app.api.schemas import SUPPORTED_LOCALES
from app.errors import Conflict, DomainError, NotFound
from app.models import MeetingGuide, Region
from app.models.enums import RegionType
from app.providers.storage import get_storage
from app.services import audit, meeting

router = APIRouter(tags=["admin:meeting-guides"])


class StepIn(BaseModel):
    texts: dict[str, str]
    # Güncellemede bu adımın fotoğrafı eski adımlardan hangisinden alınır (eski sıra numarası). Alan hiç
    # gönderilmezse aynı sıradaki fotoğraf kalır; null gönderilirse adımın fotoğrafı yoktur.
    photo_from: int | None = None

    @field_validator("texts")
    @classmethod
    def _texts(cls, v: dict[str, str]) -> dict[str, str]:
        clean = {k.lower()[:2]: t.strip()[:400] for k, t in v.items() if t and t.strip()}
        if any(k not in SUPPORTED_LOCALES for k in clean):
            raise ValueError("desteklenmeyen dil")
        if not clean:
            raise ValueError("adım metni boş olamaz")
        return clean


class GuideIn(BaseModel):
    region_id: int
    terminal: str = Field(default="", max_length=40)
    steps: list[StepIn] = Field(min_length=1, max_length=meeting.MAX_GUIDE_STEPS)
    is_active: bool = True


def _out(g: MeetingGuide) -> dict:
    return {
        "id": g.id, "region_id": g.region_id, "region": g.region.name, "terminal": g.terminal, "is_active": g.is_active,
        "updated_at": g.updated_at,
        "steps": [{"texts": s.get("texts") or {}, "has_photo": bool(s.get("photo_key")),
                   "photo_path": f"/api/v1/meeting-guides/{g.id}/photos/{i}" if s.get("photo_key") else None}
                  for i, s in enumerate(g.steps or [])],
    }


def _airport(db, region_id: int) -> Region:
    region = db.get(Region, region_id)
    if region is None or region.type is not RegionType.AIRPORT:
        raise DomainError("rehber yalnızca havalimanı için eklenir", code="guide_region_invalid")
    return region


@router.get("/meeting-guides")
def list_guides(staff: OpsStaff, db: DbSession):
    return [_out(g) for g in db.scalars(select(MeetingGuide).order_by(MeetingGuide.region_id, MeetingGuide.terminal))]


@router.post("/meeting-guides", status_code=201)
def create_guide(body: GuideIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    region = _airport(db, body.region_id)
    guide = MeetingGuide(region_id=region.id, region=region, terminal=body.terminal.strip(), is_active=body.is_active,
                         steps=[{"texts": s.texts, "photo_key": None} for s in body.steps], updated_at=now)
    db.add(guide)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("bu havalimanı ve terminal için rehber var", code="guide_exists") from exc
    audit.record(db, actor_id=staff.id, action="meeting_guide.create", entity_type="meeting_guide",
                 entity_id=guide.id, ip=ip)
    db.commit()
    return _out(guide)


@router.put("/meeting-guides/{guide_id}")
def update_guide(guide_id: int, body: GuideIn, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now):
    guide = db.get(MeetingGuide, guide_id)
    if guide is None:
        raise NotFound("rehber bulunamadı")
    region = _airport(db, body.region_id)
    db.refresh(guide, with_for_update={"of": MeetingGuide})  # eşzamanlı fotoğraf yüklemesiyle ezişmesin
    old = list(guide.steps or [])
    steps = []
    for i, s in enumerate(body.steps):
        src = s.photo_from if "photo_from" in s.model_fields_set else i
        prev = old[src] if src is not None and 0 <= src < len(old) else {}
        steps.append({"texts": s.texts, "photo_key": prev.get("photo_key"), "photo_type": prev.get("photo_type")})
    kept = {s["photo_key"] for s in steps if s["photo_key"]}
    removed = [s.get("photo_key") for s in old if s.get("photo_key") and s.get("photo_key") not in kept]
    guide.steps = steps
    guide.region_id, guide.region, guide.terminal = region.id, region, body.terminal.strip()
    guide.is_active, guide.updated_at = body.is_active, now
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("bu havalimanı ve terminal için rehber var", code="guide_exists") from exc
    audit.record(db, actor_id=staff.id, action="meeting_guide.update", entity_type="meeting_guide",
                 entity_id=guide.id, ip=ip)
    db.commit()
    for key in removed:
        get_storage().delete(key)
    return _out(guide)


@router.post("/meeting-guides/{guide_id}/steps/{index}/photo")
async def upload_step_photo(guide_id: int, index: int, staff: OpsStaff, db: DbSession, ip: ClientIp, now: Now,
                            file: Annotated[UploadFile, File()]):
    guide = db.get(MeetingGuide, guide_id)
    if guide is None:
        raise NotFound("rehber bulunamadı")
    steps = [dict(s) for s in guide.steps or []]
    if not 0 <= index < len(steps):
        raise NotFound("adım bulunamadı")
    data = await file.read(meeting.MAX_PHOTO_BYTES + 1)
    clean = meeting.clean_photo(file.content_type or "", data)
    db.refresh(guide, with_for_update={"of": MeetingGuide})
    steps = [dict(s) for s in guide.steps or []]
    if not 0 <= index < len(steps):
        raise NotFound("adım bulunamadı")
    storage = get_storage()
    old = steps[index].get("photo_key")
    steps[index]["photo_key"] = storage.put(f"meeting_guide/{guide.id}", clean)
    steps[index]["photo_type"] = meeting.PHOTO_CONTENT_TYPE
    guide.steps, guide.updated_at = steps, now
    audit.record(db, actor_id=staff.id, action="meeting_guide.photo", entity_type="meeting_guide",
                 entity_id=guide.id, changes={"step": index}, ip=ip)
    db.commit()
    if old:
        storage.delete(old)
    return _out(guide)
