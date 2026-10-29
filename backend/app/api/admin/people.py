"""Admin: müşteriler (maskeli), KVKK talepleri, personel ve roller, denetim kayıtları
(ekran 14, 16-18)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.api.admin.common import Page, page
from app.api.deps import AdminOnly, AnyStaff, ClientIp, DbSession, Now, OpsOrSupport
from app.errors import Conflict, DomainError, NotFound
from app.models import AuditLog, AuthSession, Booking, Customer, DataRequest, Role, User
from app.models.enums import BookingStatus, DataRequestStatus, RoleCode, UserKind, UserStatus
from app.security.crypto import blind_index, mask_email, mask_phone, normalize_phone
from app.services import audit, auth

router = APIRouter(tags=["admin:people"])


def _customer_row(c: Customer, booking_count: int) -> dict:
    return {
        "id": str(c.id),
        "full_name": (c.full_name[:1] + "***") if c.full_name else None,
        "phone": mask_phone(c.user.phone or ""),
        "email": mask_email(c.email) if c.email else None,
        "country_code": c.country_code,
        "locale": c.locale,
        "currency": c.currency.value,
        "booking_count": booking_count,
        "created_at": c.created_at,
        "deleted": c.deleted_at is not None,
    }


@router.get("/customers")
def list_customers(staff: OpsOrSupport, db: DbSession, p: Annotated[Page, Depends(page)], phone: str | None = None):
    """Telefonla tam eşleşme araması kör indeks üzerinden yapılır; liste maskeli döner."""
    q = select(Customer)
    if phone:
        try:
            normalized = normalize_phone(phone)
        except ValueError as exc:
            raise DomainError(str(exc)) from exc
        q = q.join(User, User.id == Customer.user_id).where(User.phone_hash == blind_index(normalized))
    rows = list(db.scalars(q.order_by(Customer.created_at.desc()).limit(p.limit).offset(p.offset)))
    counts = dict(db.execute(
        select(Booking.customer_id, func.count()).where(Booking.customer_id.in_([c.id for c in rows]))
        .group_by(Booking.customer_id)).all())
    return [_customer_row(c, counts.get(c.id, 0)) for c in rows]


# --- KVKK veri talepleri -----------------------------------------------------


@router.get("/data-requests")
def list_data_requests(staff: OpsOrSupport, db: DbSession, p: Annotated[Page, Depends(page)],
                       status: DataRequestStatus | None = None):
    q = select(DataRequest)
    if status:
        q = q.where(DataRequest.status == status)
    rows = db.scalars(q.order_by(DataRequest.due_at).limit(p.limit).offset(p.offset))
    return [{"id": str(r.id), "customer_id": str(r.customer_id), "request_type": r.request_type.value,
             "status": r.status.value, "note": r.note, "due_at": r.due_at, "completed_at": r.completed_at,
             "created_at": r.created_at} for r in rows]


class DataRequestUpdateIn(BaseModel):
    status: DataRequestStatus
    note: str | None = Field(default=None, max_length=1000)


@router.post("/data-requests/{request_id}")
def update_data_request(request_id: uuid.UUID, body: DataRequestUpdateIn, staff: OpsOrSupport,
                        db: DbSession, ip: ClientIp, now: Now):
    r = db.get(DataRequest, request_id)
    if r is None:
        raise NotFound("talep bulunamadı")
    r.status = body.status
    if body.note:
        r.note = body.note
    if body.status in (DataRequestStatus.COMPLETED, DataRequestStatus.REJECTED):
        r.completed_at = now
    audit.record(db, actor_id=staff.id, action="data_request.update", entity_type="data_request",
                 entity_id=r.id, changes={"status": body.status}, ip=ip)
    db.commit()
    return {"ok": True}


@router.post("/customers/{customer_id}/anonymize")
def anonymize_customer(customer_id: uuid.UUID, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    """Silme talebinin uygulanması: kişisel veriler silinir, rezervasyon ve fatura kayıtları
    vergi mevzuatı gereği saklanır (saklama süreleri hukukçu teyidi bekliyor)."""
    c = db.get(Customer, customer_id)
    if c is None:
        raise NotFound("müşteri bulunamadı")
    active = db.scalar(select(func.count()).where(
        Booking.customer_id == c.id,
        Booking.status.in_([BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED,
                            BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS])))
    if active:
        raise Conflict("aktif rezervasyonu olan müşteri silinemez", code="active_bookings")
    c.full_name = None
    c.email = None
    c.deleted_at = now
    c.user.phone = None
    c.user.phone_hash = None
    c.user.status = UserStatus.DISABLED
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == c.user_id, AuthSession.revoked_at.is_(None))):
        s.revoked_at = now
    audit.record(db, actor_id=staff.id, action="customer.anonymize", entity_type="customer", entity_id=c.id, ip=ip)
    db.commit()
    return {"ok": True}


# --- Personel ve roller ------------------------------------------------------


class StaffIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=200)
    roles: list[RoleCode] = Field(min_length=1)


def _staff_row(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "roles": sorted(u.role_codes), "status": u.status.value,
            "two_factor_enabled": u.two_factor_enabled, "last_login_at": u.last_login_at}


@router.get("/users")
def list_staff(staff: AdminOnly, db: DbSession):
    return [_staff_row(u) for u in db.scalars(select(User).where(User.kind == UserKind.STAFF))]


@router.post("/users", status_code=201)
def create_staff(body: StaffIn, staff: AdminOnly, db: DbSession, ip: ClientIp):
    try:
        u = auth.create_staff_user(db, email=body.email, password=body.password, roles=body.roles,
                                   actor_id=staff.id, ip=ip)
    except ValueError as exc:
        raise DomainError(str(exc)) from exc
    db.commit()
    return _staff_row(u)


class StaffUpdateIn(BaseModel):
    roles: list[RoleCode] | None = None
    status: UserStatus | None = None
    reset_2fa: bool = False


@router.patch("/users/{user_id}")
def update_staff(user_id: uuid.UUID, body: StaffUpdateIn, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    u = db.get(User, user_id)
    if u is None or u.kind is not UserKind.STAFF:
        raise NotFound("kullanıcı bulunamadı")
    if u.id == staff.id and (body.status is UserStatus.DISABLED or (body.roles and RoleCode.ADMIN not in body.roles)):
        raise Conflict("kendi yetkinizi kaldıramazsınız")
    if body.roles is not None:
        u.roles = list(db.scalars(select(Role).where(Role.code.in_(body.roles))))
    if body.status is not None:
        u.status = body.status
        if body.status is UserStatus.DISABLED:
            for s in db.scalars(select(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))):
                s.revoked_at = now
    if body.reset_2fa:
        u.two_factor_enabled = False
        u.two_factor_secret = None
    audit.record(db, actor_id=staff.id, action="staff_user.update", entity_type="user", entity_id=u.id,
                 changes=body.model_dump(exclude_unset=True), ip=ip)
    db.commit()
    return _staff_row(u)


# --- Denetim kayıtları -------------------------------------------------------


@router.get("/audit-logs")
def list_audit_logs(
    staff: AnyStaff,
    db: DbSession,
    p: Annotated[Page, Depends(page)],
    actor_id: uuid.UUID | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    q = select(AuditLog)
    if actor_id:
        q = q.where(AuditLog.actor_id == actor_id)
    if action:
        q = q.where(AuditLog.action.startswith(action))
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    if date_from:
        q = q.where(AuditLog.created_at >= date_from)
    if date_to:
        q = q.where(AuditLog.created_at < date_to)
    rows = db.scalars(q.order_by(AuditLog.created_at.desc()).limit(p.limit).offset(p.offset))
    return [{"id": str(r.id), "actor_id": str(r.actor_id) if r.actor_id else None, "action": r.action,
             "entity_type": r.entity_type, "entity_id": r.entity_id, "changes": r.changes, "ip": r.ip,
             "created_at": r.created_at} for r in rows]
