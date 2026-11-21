"""K-81: web e2e testlerinin geliştirme veritabanında bıraktığı kayıtların temizliği (yalnızca dev/test).

E2E testleri kurgusal numaralarla (ABD 555-0100…0199, Birleşik Krallık 07700 900000…900999; `web/e2e/session.ts`)
müşteri hesabı, rezervasyon ve ödeme kaydı açar. Bu komut o müşterilerin açık rezervasyonlarını iade ve bildirim
olmadan kapatır (sahte ödeme sağlayıcısı; para hareketi yok) ve müşteriyi `privacy.anonymize_customer` ile
anonimleştirir. Kayıtlar silinmez: tutar, tarih ve bölge muhasebe ve denetim ilişkileri bozulmasın diye kalır.
Üretimde çalışmaz; gerçek numaralar desene uymadığı için dokunulmaz.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import DEV_ENVS, get_settings
from app.models import Booking, BookingLeg, Customer, DispatchOffer
from app.models.enums import BookingStatus, LegStatus, OfferStatus
from app.services import audit, privacy

# NANPA 555-0100…0199 (her alan kodunda kurgu için ayrılmış) ve Ofcom 07700 900000…900999.
FICTIONAL_PHONE = re.compile(r"^(\+1[2-9]\d{2}55501\d{2}|\+447700900\d{3})$")
CLEANUP_REASON = "e2e test verisi temizliği"


@dataclass
class CleanupResult:
    customers: int = 0
    closed_bookings: int = 0
    skipped: list[str] = field(default_factory=list)


def is_fictional(phone: str | None) -> bool:
    return bool(phone and FICTIONAL_PHONE.match(phone))


def cleanup(db: Session, now: datetime, *, dry_run: bool = False) -> CleanupResult:
    if get_settings().env not in DEV_ENVS:
        raise RuntimeError("e2e temizliği yalnızca geliştirme ve test ortamında çalışır")
    result = CleanupResult()
    for c in db.scalars(select(Customer).where(Customer.deleted_at.is_(None))):
        if not is_fictional(c.user.phone):
            continue
        result.customers += 1
        active = list(db.scalars(select(Booking).where(
            Booking.customer_id == c.id, Booking.status.in_(privacy.ACTIVE_BOOKING_STATUSES))))
        result.closed_bookings += len(active)
        if dry_run:
            continue
        for b in active:
            b.status = BookingStatus.CANCELLED
            b.cancelled_at = now
            b.cancel_reason = CLEANUP_REASON
            for leg in db.scalars(select(BookingLeg).where(BookingLeg.booking_id == b.id)):
                if leg.status is not LegStatus.COMPLETED:
                    leg.status = LegStatus.CANCELLED
                for offer in db.scalars(select(DispatchOffer).where(DispatchOffer.booking_leg_id == leg.id,
                                                                    DispatchOffer.status == OfferStatus.SENT)):
                    offer.status = OfferStatus.WITHDRAWN
        db.flush()
        privacy.anonymize_customer(db, c, now)
        audit.record(db, actor_id=None, action="customer.e2e_cleanup", entity_type="customer", entity_id=c.id,
                     changes={"closed_bookings": len(active)})
    return result
