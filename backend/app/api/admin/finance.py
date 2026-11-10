"""Admin: ödemeler, iadeler, sürücü hakedişleri, faturalar (ekran 11-13)."""

from __future__ import annotations

import csv
import io
import uuid
from collections import defaultdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.admin.common import Page, page
from app.api.deps import ClientIp, DbSession, FinanceStaff, Now
from app.errors import Conflict, NotFound, ServiceUnavailable
from app.models import BookingLeg, Driver, DriverLedger, DriverPayout, Invoice, Payment, Refund
from app.models.enums import (
    InvoiceStatus,
    LedgerStatus,
    PaymentStatus,
    PayoutStatus,
    RefundStatus,
)
from app.providers.payments import get_payment_provider
from app.services import audit
from app.services.bookings import execute_refund
from app.services.quotes import latest_exchange_rate

router = APIRouter(tags=["admin:finance"])


@router.get("/payments")
def list_payments(staff: FinanceStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                  status: PaymentStatus | None = None):
    q = select(Payment)
    if status:
        q = q.where(Payment.status == status)
    rows = db.scalars(q.order_by(Payment.created_at.desc()).limit(p.limit).offset(p.offset))
    return [
        {"id": str(x.id), "booking_id": str(x.booking_id), "provider": x.provider.value,
         "merchant_oid": x.merchant_oid, "amount": f"{x.amount:.2f}", "currency": x.currency.value,
         "status": x.status.value, "paid_at": x.paid_at, "created_at": x.created_at,
         "refunded": f"{x.refunded_amount:.2f}"}
        for x in rows
    ]


@router.get("/refunds")
def list_refunds(staff: FinanceStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                 status: RefundStatus | None = None):
    q = select(Refund).options(joinedload(Refund.payment))
    if status:
        q = q.where(Refund.status == status)
    rows = db.scalars(q.order_by(Refund.created_at.desc()).limit(p.limit).offset(p.offset))
    return [
        {"id": str(r.id), "payment_id": str(r.payment_id), "amount": f"{r.amount:.2f}",
         "refund_percent": r.refund_percent, "status": r.status.value, "reason": r.reason,
         "provider_ref": r.provider_ref, "created_at": r.created_at,
         "manual": r.payment.provider.value == "elle"}
        for r in rows
    ]


@router.post("/refunds/{refund_id}/retry")
def retry_refund(refund_id: uuid.UUID, staff: FinanceStaff, db: DbSession, ip: ClientIp):
    refund = db.get(Refund, refund_id, with_for_update=True)
    if refund is None:
        raise NotFound("iade bulunamadı")
    if refund.status is not RefundStatus.FAILED:
        raise Conflict("yalnızca başarısız iade tekrar denenebilir")
    refund.status = RefundStatus.PENDING
    execute_refund(db, refund, refund.payment, get_payment_provider())
    audit.record(db, actor_id=staff.id, action="refund.retry", entity_type="refund", entity_id=refund.id,
                 changes={"result": refund.status}, ip=ip)
    db.commit()
    return {"status": refund.status.value}


# --- Sürücü hakedişleri ------------------------------------------------------


@router.get("/ledger")
def list_ledger(staff: FinanceStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                status: LedgerStatus | None = LedgerStatus.PENDING, driver_id: uuid.UUID | None = None):
    q = select(DriverLedger)
    if status:
        q = q.where(DriverLedger.status == status)
    if driver_id:
        q = q.where(DriverLedger.driver_id == driver_id)
    rows = list(db.scalars(q.order_by(DriverLedger.created_at.desc()).limit(p.limit).offset(p.offset)))
    legs = {leg.id: leg for leg in db.scalars(
        select(BookingLeg).where(BookingLeg.id.in_([r.booking_leg_id for r in rows])))}
    return [
        {"id": str(r.id), "driver_id": str(r.driver_id), "leg_id": str(r.booking_leg_id),
         "booking_id": str(legs[r.booking_leg_id].booking_id) if r.booking_leg_id in legs else None,
         "booking_code": legs[r.booking_leg_id].booking.booking_code if r.booking_leg_id in legs else None,
         "in_payout": r.payout_id is not None,
         "gross": f"{r.gross_amount:.2f}", "commission": f"{r.commission_amount:.2f}",
         "net": f"{r.net_amount:.2f}", "currency": r.currency.value,
         "net_try": f"{r.net_amount_try:.2f}" if r.net_amount_try is not None else None,
         "status": r.status.value, "created_at": r.created_at}
        for r in rows
    ]


@router.post("/payouts", status_code=201)
def create_payouts(staff: FinanceStaff, db: DbSession, ip: ClientIp, now: Now):
    """Bekleyen hakedişleri sürücü bazında toplayıp ödeme kayıtları oluşturur.

    Otomatik aktarım (split) sağlayıcıda açılana kadar ödeme banka dosyasıyla
    manuel yapılır (odeme.md, acik_konular.md).
    """
    entries = list(
        db.scalars(
            select(DriverLedger).where(DriverLedger.status == LedgerStatus.PENDING,
                                       DriverLedger.payout_id.is_(None)).with_for_update()
        )
    )
    if any(e.net_amount_try is None for e in entries):
        rate = latest_exchange_rate(db, now)
        if rate is None:
            raise ServiceUnavailable("EUR hakedişleri için TRY kuru girilmeli")
        for e in entries:
            if e.net_amount_try is None:
                e.net_amount_try = (e.net_amount * rate.rate).quantize(Decimal("0.01"))
    by_driver: dict[uuid.UUID, list[DriverLedger]] = defaultdict(list)
    for e in entries:
        by_driver[e.driver_id].append(e)
    created = []
    for driver_id, items in by_driver.items():
        payout = DriverPayout(driver_id=driver_id, total_try=sum((i.net_amount_try for i in items), Decimal("0")))
        db.add(payout)
        db.flush()
        for i in items:
            i.payout_id = payout.id
        created.append(payout)
        audit.record(db, actor_id=staff.id, action="payout.create", entity_type="driver_payout",
                     entity_id=payout.id, changes={"total_try": payout.total_try, "entries": len(items)}, ip=ip)
    db.commit()
    return [{"id": str(x.id), "driver_id": str(x.driver_id), "total_try": f"{x.total_try:.2f}"} for x in created]


@router.get("/payouts")
def list_payouts(staff: FinanceStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                 status: PayoutStatus | None = None):
    q = select(DriverPayout)
    if status:
        q = q.where(DriverPayout.status == status)
    rows = db.scalars(q.order_by(DriverPayout.created_at.desc()).limit(p.limit).offset(p.offset))
    return [{"id": str(x.id), "driver_id": str(x.driver_id), "total_try": f"{x.total_try:.2f}",
             "status": x.status.value, "paid_at": x.paid_at, "created_at": x.created_at} for x in rows]


@router.get("/payouts/export.csv")
def export_payouts(staff: FinanceStaff, db: DbSession, ip: ClientIp):
    """Bekleyen ödemeler için banka toplu ödeme dosyası (hakediş dosyası)."""
    rows = db.execute(
        select(DriverPayout, Driver).join(Driver, Driver.id == DriverPayout.driver_id)
        .where(DriverPayout.status == PayoutStatus.PENDING)
    ).all()
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["odeme_id", "ad_soyad", "iban", "tutar_try", "aciklama"])
    for payout, driver in rows:
        writer.writerow([payout.id, driver.full_name, driver.iban or "", f"{payout.total_try:.2f}",
                         f"getawaytransfers hakedis {payout.created_at:%Y-%m-%d}"])
    # IBAN içeren dosya indirmek hassas bir erişimdir.
    audit.record(db, actor_id=staff.id, action="payout.export", entity_type="driver_payout",
                 changes={"count": len(rows)}, ip=ip)
    db.commit()
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=hakedis.csv", "Cache-Control": "no-store"})


@router.post("/payouts/{payout_id}/mark-paid")
def mark_payout_paid(payout_id: uuid.UUID, staff: FinanceStaff, db: DbSession, ip: ClientIp, now: Now,
                     provider_ref: str | None = None):
    payout = db.get(DriverPayout, payout_id, with_for_update=True)
    if payout is None:
        raise NotFound("ödeme bulunamadı")
    if payout.status is PayoutStatus.PAID:
        raise Conflict("zaten ödendi")
    payout.status = PayoutStatus.PAID
    payout.paid_at = now
    payout.provider_ref = provider_ref
    for e in db.scalars(select(DriverLedger).where(DriverLedger.payout_id == payout.id)):
        e.status = LedgerStatus.PAID
    audit.record(db, actor_id=staff.id, action="payout.paid", entity_type="driver_payout",
                 entity_id=payout.id, changes={"provider_ref": provider_ref}, ip=ip)
    db.commit()
    return {"ok": True}


# --- Faturalar ---------------------------------------------------------------


@router.get("/invoices")
def list_invoices(staff: FinanceStaff, db: DbSession, p: Annotated[Page, Depends(page)],
                  status: InvoiceStatus | None = None):
    """e-Arşiv entegratörü (Paraşüt/Logo/Uyumsoft) seçilince kesim otomatik olacak."""
    q = select(Invoice)
    if status:
        q = q.where(Invoice.status == status)
    rows = db.scalars(q.order_by(Invoice.created_at.desc()).limit(p.limit).offset(p.offset))
    return [{"id": str(i.id), "booking_id": str(i.booking_id), "type": i.type, "gib_ref": i.gib_ref,
             "status": i.status.value, "issued_at": i.issued_at, "created_at": i.created_at} for i in rows]
