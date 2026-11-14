"""Zamanlanmış görevler. Her fonksiyon tek işlemde çalışır ve etkilenen kayıt sayısını döner.

ARQ worker'ı (app/worker.py) bunları periyodik çağırır.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.orm import Session

from app.errors import ServiceUnavailable
from app.localtime import local_date
from app.models import (
    Booking,
    BookingLeg,
    Document,
    Driver,
    ExchangeRate,
    FlightInfo,
    OtpChallenge,
    Payment,
    Refund,
    TripMessage,
    TripUpdate,
    Vehicle,
)
from app.providers import fx
from app.services.quotes import latest_exchange_rate
from app.models.enums import (
    BookingStatus,
    DocumentOwner,
    DocumentStatus,
    DriverStatus,
    LegStatus,
    PaymentProviderCode,
    RefundStatus,
    VehicleStatus,
)
from app.services import audit, dispatch, driver_tools, flight_tracking, meeting, payments, system_settings

log = logging.getLogger(__name__)


def purge_flight_data(db: Session, now: datetime) -> int:
    """K-18/K-31: `purge_at` dolan uçuş bilgisi silinir. `purge_at`: yolculuk tamamlanınca ve rezervasyon
    iptal edilince o an (PRIV-10); hiç tamamlanmazsa alıştan 48 saat sonra (bookings.FLIGHT_PURGE_FALLBACK).
    Saatlik iş olduğu için gerçek silme en geç bir saat içinde olur."""
    result = db.execute(delete(FlightInfo).where(FlightInfo.purge_at <= now))
    return result.rowcount or 0


def purge_trip_messages(db: Session, now: datetime) -> int:
    """K-50: yolculuk sohbeti ve uygulama içi bildirimler alış zamanından 30 gün sonra silinir."""
    cutoff = now - timedelta(days=30)
    old_legs = select(BookingLeg.id).where(BookingLeg.pickup_at < cutoff)
    removed = db.execute(delete(TripMessage).where(TripMessage.booking_leg_id.in_(old_legs))).rowcount or 0
    removed += db.execute(delete(TripUpdate).where(TripUpdate.created_at < cutoff)).rowcount or 0
    return removed


def refresh_exchange_rate(db: Session, now: datetime) -> int:
    """K-33: EUR/TRY kuru TCMB'den otomatik alınır. Değişmediyse yeni kayıt açılmaz.

    Kaynağa ulaşılamazsa son kur geçerli kalır (rezervasyonlar kuru zaten dondurur).
    """
    try:
        rate = fx.fetch_eur_try()
    except ServiceUnavailable as exc:
        log.warning("kur güncellenemedi: %s", exc)
        return 0
    last = latest_exchange_rate(db, now)
    if last is not None and last.rate == rate:
        return 0
    db.add(ExchangeRate(rate=rate, source="tcmb", valid_from=now))
    return 1


def expire_documents(db: Session, now: datetime) -> int:
    """Süresi dolan belgeyi işaretler; zorunlu belgesi düşen sürücü/araç pasife alınır."""
    today = local_date(now)
    docs = list(
        db.scalars(
            select(Document).where(
                Document.status == DocumentStatus.APPROVED, Document.valid_until < today
            )
        )
    )
    for doc in docs:
        doc.status = DocumentStatus.EXPIRED
        audit.record(db, actor_id=None, action="document.expired", entity_type="document", entity_id=doc.id)
    db.flush()

    for owner_type in (DocumentOwner.DRIVER, DocumentOwner.VEHICLE):
        owner_ids = {d.owner_id for d in docs if d.owner_type is owner_type}
        for owner_id in owner_ids:
            if not dispatch.missing_documents(db, owner_type, owner_id, today):
                continue
            if owner_type is DocumentOwner.DRIVER:
                driver = db.get(Driver, owner_id)
                if driver and driver.status is DriverStatus.APPROVED:
                    driver.status = DriverStatus.PASSIVE
                    driver.is_online = False
                    audit.record(db, actor_id=None, action="driver.auto_passive",
                                 entity_type="driver", entity_id=driver.id)
                    # REV-A-5: elle askıya almadaki gibi yolcu alınmamış işler havuza döner, teklifler geri
                    # çekilir, oturumlar kapanır. Başlamış (yolcu araçta) yolculuk sürücüde kalır; sürücü onu
                    # yeniden giriş yapıp bitirebilir (deps.current_driver).
                    dispatch.release_driver(db, driver, actor_id=None, ip=None, now=now)
            else:
                vehicle = db.get(Vehicle, owner_id)
                if vehicle and vehicle.status is VehicleStatus.ACTIVE:
                    vehicle.status = VehicleStatus.PASSIVE
                    audit.record(db, actor_id=None, action="vehicle.auto_passive",
                                 entity_type="vehicle", entity_id=vehicle.id)
    return len(docs)


def cancel_unpaid_bookings(db: Session, now: datetime) -> int:
    minutes = int(system_settings.get(db, "pending_payment_minutes"))
    bookings = list(
        db.scalars(
            select(Booking).where(
                Booking.status == BookingStatus.PENDING_PAYMENT,
                # Admin girişinde ödeme süresi rezervasyonda yazılıdır (K-54); diğerlerinde genel süre.
                or_(
                    and_(Booking.payment_due_at.is_(None), Booking.created_at < now - timedelta(minutes=minutes)),
                    Booking.payment_due_at < now,
                ),
                # REV-C-1: reddedilmiş başarılı bildirimi olan (kartı çekilmiş olabilecek) rezervasyon
                # operasyon mutabakatı bitmeden otomatik iptal edilmez.
                ~exists().where(Payment.booking_id == Booking.id, payments.rejected_charge_filter()),
            )
            # Aynı anda gelen elle tahsilat veya kart bildirimi rezervasyonu kilitliyorsa bu tur atlanır;
            # kilit bırakıldığında rezervasyon artık ödeme beklemiyorsa iptal edilmez.
            .with_for_update(of=Booking, skip_locked=True)
        ).unique()
    )
    for b in bookings:
        b.status = BookingStatus.CANCELLED
        b.cancelled_at = now
        b.cancel_reason = "ödeme süresi doldu"
        for leg in b.legs:
            leg.status = LegStatus.CANCELLED
            if leg.flight is not None:
                leg.flight.purge_at = now  # PRIV-10: iptal edilen yolculuğun uçuş verisi beklemeden silinir
    return len(bookings)


# REV-A-7: sağlayıcı çağrısı 20 sn zaman aşımlıdır; bu süreden uzun PENDING kalan kart iadesinde süreç
# PENDING commit'i ile sonucun yazılması arasında kesilmiştir (çökme, yeniden başlatma).
STUCK_REFUND_MINUTES = 15


def mark_stuck_refunds_unknown(db: Session, now: datetime) -> int:
    """PENDING'de takılan kart iadelerini belirsiz (UNKNOWN) yapar: sağlayıcıda gerçekleşmiş olabilir,
    mutabakat gerekir. Elle tahsilatın iadesi (MANUAL) muhasebeyi beklediği için PENDING kalır.

    Not: iade kaydında güncellenme zamanı yok; eşik oluşturma zamanına göredir. Yeniden denenen eski bir
    iade sağlayıcı çağrısı sürerken UNKNOWN'a çekilse bile execute_refund sonucu üzerine yazar."""
    cutoff = now - timedelta(minutes=STUCK_REFUND_MINUTES)
    refunds = list(db.scalars(
        select(Refund)
        .join(Payment, Payment.id == Refund.payment_id)
        .where(Refund.status == RefundStatus.PENDING, Refund.created_at < cutoff,
               Payment.provider != PaymentProviderCode.MANUAL)
        .with_for_update(of=Refund, skip_locked=True)
    ))
    for refund in refunds:
        refund.status = RefundStatus.UNKNOWN
        audit.record(db, actor_id=None, action="refund.stuck_pending_unknown", entity_type="refund",
                     entity_id=refund.id, changes={"created_at": refund.created_at,
                                                   "threshold_minutes": STUCK_REFUND_MINUTES})
        log.error("iade PENDING'de takıldı, belirsiz yapıldı; mutabakat gerekli: refund=%s", refund.id)
    return len(refunds)


def purge_otp_challenges(db: Session, now: datetime) -> int:
    result = db.execute(delete(OtpChallenge).where(OtpChallenge.created_at < now - timedelta(days=1)))
    return result.rowcount or 0


def expire_dispatch_offers(db: Session, now: datetime) -> int:
    return dispatch.expire_offers(db, now)


def refresh_flights(db: Session, now: datetime) -> int:
    """K-60: vadesi gelen geliş uçuşlarının tahmini iniş saati (takip kapalıysa hiçbir şey yapmaz)."""
    return flight_tracking.refresh_flights(db, now)


def send_driver_cards(db: Session, now: datetime) -> int:
    """K-62: alıştan bir gün önce müşteriye sürücü kartı (fotoğraf, diller, araç, renk, plaka)."""
    return meeting.send_driver_cards(db, now)


def send_daily_plans(db: Session, now: datetime) -> int:
    """K-63: akşam, ertesi gün işi olan sürücüye özet."""
    return driver_tools.send_daily_plans(db, now)


ALL_JOBS = (
    purge_flight_data,
    refresh_exchange_rate,
    expire_documents,
    cancel_unpaid_bookings,
    purge_otp_challenges,
    expire_dispatch_offers,
    refresh_flights,
    mark_stuck_refunds_unknown,
    send_driver_cards,
    send_daily_plans,
)
