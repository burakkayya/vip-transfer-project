"""KVKK/GDPR silme talebinin uygulanması (PRIV-01, F0-4).

Anonimleştirme kişisel verileri siler ya da kişiyle bağı koparır. Rezervasyon, tutar, tarih, fatura
ve ödeme kayıtları vergi mevzuatı gereği saklanır; bacakta bölge (ilçe) düzeyi kalır, kesin adres ve
koordinat silinir. consents.ip yasal kanıt olarak şimdilik saklanır (saklama süreleri hukukçu
teyidi bekliyor).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.errors import Conflict
from app.models import (
    AuthSession,
    Booking,
    BookingLeg,
    Customer,
    DataRequest,
    OtpChallenge,
    Payment,
    Refund,
    TripMessage,
    TripUpdate,
)
from app.models.enums import BookingStatus, DataRequestStatus, DataRequestType, UserStatus

# bookings.passenger_name NOT NULL; ekranlar ilk harf/ilk kelime kullandığı için boş olmayan sabit.
ANONYMIZED_NAME = "Anonim"

ACTIVE_BOOKING_STATUSES = (BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED,
                           BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS)

# refunds.reason NOT NULL; iptal/iade gerekçesindeki serbest metin bu sabitle değiştirilir.
ANONYMIZED_REASON = "anonimleştirildi"
# execute_refund'ın eklediği sistem son eki (" | belirsiz: ...", " | hata: ..."): sağlayıcı sonucu, kişisel veri değil.
_SYSTEM_SUFFIX_SEP = " | "


def anonymized_refund_reason(reason: str | None) -> str:
    """Kullanıcı/personel serbest metnini atar, sistemin eklediği sağlayıcı sonucu son ekini korur."""
    suffix = ""
    if reason and _SYSTEM_SUFFIX_SEP in reason:
        tail = reason.split(_SYSTEM_SUFFIX_SEP, 1)[1]
        if tail.startswith(("belirsiz:", "hata:")):
            suffix = _SYSTEM_SUFFIX_SEP + tail
    return (ANONYMIZED_REASON + suffix)[:255]


def anonymize_customer(db: Session, c: Customer, now: datetime) -> None:
    """Müşterinin kişisel verilerini siler. Aktif rezervasyon varsa Conflict. Commit etmez."""
    active = db.scalar(select(func.count()).where(
        Booking.customer_id == c.id, Booking.status.in_(ACTIVE_BOOKING_STATUSES)))
    if active:
        raise Conflict("aktif rezervasyonu olan müşteri silinemez", code="active_bookings")

    # REV-A-8: telefonun blind index'iyle tutulan OTP kayıtları silinir (hash'i silmeden önce).
    if c.user.phone_hash:
        db.execute(delete(OtpChallenge).where(OtpChallenge.phone_hash == c.user.phone_hash)
                   .execution_options(synchronize_session=False))

    # Hesap
    c.full_name = None
    c.email = None
    c.push_token = None
    c.deleted_at = now
    c.user.phone = None
    c.user.phone_hash = None
    c.user.status = UserStatus.DISABLED

    # Oturumlar: iptal + IP ve cihaz bilgisi temizliği (iptal edilmiş eski oturumlar dahil).
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == c.user_id)):
        if s.revoked_at is None:
            s.revoked_at = now
        s.ip = None
        s.device_info = None

    # Rezervasyonlar ve bacaklar: tutar/tarih/bölge kalır, ad, not, adres, koordinat gider.
    booking_ids = select(Booking.id).where(Booking.customer_id == c.id)
    for b in db.scalars(select(Booking).where(Booking.customer_id == c.id)):
        b.passenger_name = ANONYMIZED_NAME
        b.note = None
        # REV-A-8: iptal gerekçesi müşteri serbest metni olabilir; iptal edildiği bilgisi kalır.
        if b.cancel_reason is not None:
            b.cancel_reason = ANONYMIZED_REASON
    # İade gerekçesi iptal gerekçesinden kopyalanır; tutar, durum ve sağlayıcı sonucu muhasebe için kalır.
    for refund in db.scalars(
        select(Refund).join(Payment, Payment.id == Refund.payment_id).where(Payment.booking_id.in_(booking_ids))
    ):
        refund.reason = anonymized_refund_reason(refund.reason)
    db.execute(
        update(BookingLeg).where(BookingLeg.booking_id.in_(booking_ids))
        .values(pickup_address=None, dropoff_address=None, pickup_lat=None, pickup_lng=None,
                dropoff_lat=None, dropoff_lng=None)
        .execution_options(synchronize_session="fetch")
    )
    leg_ids = select(BookingLeg.id).where(BookingLeg.booking_id.in_(booking_ids))
    db.execute(delete(TripMessage).where(TripMessage.booking_leg_id.in_(leg_ids))
               .execution_options(synchronize_session=False))
    # Uygulama içi bildirim akışı: müşteriye ve sürücüye giden kayıtlar yolcu adı ve mesaj önizlemesi taşır.
    db.execute(delete(TripUpdate).where(TripUpdate.booking_leg_id.in_(leg_ids))
               .execution_options(synchronize_session=False))

    # Talepler: müşterinin yazdığı serbest metin silinir; açık silme talepleri kapanır.
    for r in db.scalars(select(DataRequest).where(DataRequest.customer_id == c.id)):
        r.note = None
        if r.request_type is DataRequestType.DELETE and r.completed_at is None:
            r.status = DataRequestStatus.COMPLETED
            r.completed_at = now
