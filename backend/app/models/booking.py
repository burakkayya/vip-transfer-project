"""Rezervasyon ve eşleştirme."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, Numeric, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, Rate, created_at, str_enum, uuid_pk
from app.models.customer import Customer
from app.models.enums import (
    BookingChannel,
    BookingSource,
    BookingStatus,
    BookingType,
    Currency,
    FlightDirection,
    LegStatus,
    OfferStatus,
    TripEventType,
)
from app.models.fleet import Driver, Vehicle, VehicleType
from app.models.pricing import Region
from app.security.crypto import EncryptedString


class Booking(Base):
    """Fiyat, kur, komisyon oranı ve iptal politikası rezervasyon anında dondurulur."""

    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint("passenger_count > 0", name="positive_passengers"),
        CheckConstraint("luggage_count >= 0", name="non_negative_luggage"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_code: Mapped[str] = mapped_column(String(12), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), index=True)
    booking_type: Mapped[BookingType] = mapped_column(str_enum(BookingType))
    status: Mapped[BookingStatus] = mapped_column(
        str_enum(BookingStatus), default=BookingStatus.PENDING_PAYMENT, index=True
    )
    vehicle_type_id: Mapped[int] = mapped_column(ForeignKey("vehicle_types.id"))
    passenger_count: Mapped[int]
    luggage_count: Mapped[int] = mapped_column(default=0)
    is_round_trip: Mapped[bool] = mapped_column(default=False)
    passenger_name: Mapped[str] = mapped_column(EncryptedString)
    note: Mapped[str | None] = mapped_column(EncryptedString)
    locale: Mapped[str] = mapped_column(String(5), default="tr")
    # K-62 ekstralar: çocuk koltuğu sayısı, yolda market molası.
    child_seat_count: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    market_stop: Mapped[bool] = mapped_column(default=False, server_default="false")
    # K-62 girişsiz takip bağlantısı; müşteri paylaşınca oluşur, kaldırınca silinir.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True)

    # Dondurulmuş fiyatlandırma girdileri
    pricing_rule_id: Mapped[int] = mapped_column(ForeignKey("pricing_rules.id"))
    round_trip_discount_id: Mapped[int | None] = mapped_column(
        ForeignKey("round_trip_discounts.id")
    )
    cancellation_policy_id: Mapped[int] = mapped_column(
        ForeignKey("cancellation_policies.id")
    )
    commission_rule_id: Mapped[int] = mapped_column(ForeignKey("commission_rules.id"))
    commission_rate: Mapped[Decimal] = mapped_column(Rate)
    exchange_rate_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("exchange_rates.id")
    )

    # Tutarlar: quoted_price yolculuk ücreti, guarantee_fee garanti, total_amount tahsil edilen.
    price_eur: Mapped[Decimal] = mapped_column(Money)
    quoted_price: Mapped[Decimal] = mapped_column(Money)
    guarantee_fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    total_amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[Currency] = mapped_column(str_enum(Currency))
    quoted_at: Mapped[datetime]

    cancelled_at: Mapped[datetime | None]
    cancel_reason: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = created_at()

    # K-54 admin girişi: kaynak, kanal, oluşturan personel; ödeme son anı (boşsa pending_payment_minutes);
    # fiyat elle değiştirildiyse sistemin hesapladığı tutar ve gerekçe.
    source: Mapped[BookingSource] = mapped_column(
        str_enum(BookingSource, 16), default=BookingSource.CUSTOMER, server_default=BookingSource.CUSTOMER.value,
        index=True,
    )
    channel: Mapped[BookingChannel | None] = mapped_column(str_enum(BookingChannel, 16))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    payment_due_at: Mapped[datetime | None]
    system_total_amount: Mapped[Decimal | None] = mapped_column(Money)
    price_override_reason: Mapped[str | None] = mapped_column(String(500))

    customer: Mapped[Customer] = relationship(lazy="joined")
    vehicle_type: Mapped[VehicleType] = relationship(lazy="joined")
    legs: Mapped[list[BookingLeg]] = relationship(
        back_populates="booking",
        lazy="selectin",
        order_by="BookingLeg.leg_order",
        cascade="all, delete-orphan",
    )

    @property
    def has_guarantee(self) -> bool:
        return self.guarantee_fee > 0

    @property
    def first_pickup_at(self) -> datetime:
        return self.legs[0].pickup_at


class BookingLeg(Base):
    __tablename__ = "booking_legs"
    __table_args__ = (UniqueConstraint("booking_id", "leg_order"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), index=True
    )
    leg_order: Mapped[int]
    status: Mapped[LegStatus] = mapped_column(
        str_enum(LegStatus), default=LegStatus.PENDING, index=True
    )
    pickup_region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"))
    dropoff_region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"))
    pickup_address: Mapped[str | None] = mapped_column(EncryptedString)
    dropoff_address: Mapped[str | None] = mapped_column(EncryptedString)
    pickup_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    pickup_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    dropoff_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    dropoff_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    pickup_at: Mapped[datetime] = mapped_column(index=True)
    distance_km: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    duration_minutes: Mapped[int | None]
    leg_price: Mapped[Decimal] = mapped_column(Money)

    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drivers.id"), index=True)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id"))
    assigned_at: Mapped[datetime | None]
    # K-62 yolcunun tek dokunuşla bildirdiği durum (indi, bagajda, çıkıyor) ve zamanı.
    passenger_status: Mapped[str | None] = mapped_column(String(12))
    passenger_status_at: Mapped[datetime | None]
    # K-62 bir kez gönderilen müşteri bildirimleri: buluşma rehberi, sürücü kartı.
    meeting_guide_sent_at: Mapped[datetime | None]
    driver_card_sent_at: Mapped[datetime | None]
    # K-63 kanıtlı bekleme: sürücünün "Vardım" anı ve "Yolcu gelmedi" kaydı.
    arrived_at: Mapped[datetime | None]
    no_show_at: Mapped[datetime | None]

    booking: Mapped[Booking] = relationship(back_populates="legs")
    pickup_region: Mapped[Region] = relationship(foreign_keys=[pickup_region_id], lazy="joined")
    dropoff_region: Mapped[Region] = relationship(foreign_keys=[dropoff_region_id], lazy="joined")
    driver: Mapped[Driver | None] = relationship(lazy="joined")
    vehicle: Mapped[Vehicle | None] = relationship(lazy="joined")
    flight: Mapped[FlightInfo | None] = relationship(
        back_populates="leg", lazy="selectin", cascade="all, delete-orphan", uselist=False
    )


class FlightInfo(Base):
    """K-18: yolculuktan 24 saat sonra silinir (purge_at, zamanlanmış görev)."""

    __tablename__ = "flight_infos"

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("booking_legs.id", ondelete="CASCADE"), unique=True
    )
    flight_no: Mapped[str] = mapped_column(String(10))
    direction: Mapped[FlightDirection] = mapped_column(str_enum(FlightDirection))
    scheduled_at: Mapped[datetime | None]
    estimated_at: Mapped[datetime | None]
    # K-60: uçuş takibi. status sade durum (providers.flights), checked_at son sorgu,
    # provider_scheduled_at sağlayıcının planlanan inişi (scheduled_at müşterinin girdiği değer kalır),
    # notified_at sürücüye bildirilen son tahmini iniş (aynı kayma için tekrar bildirim gitmez),
    # check_count uçuş başına sorgu, miss_count art arda "bulunamadı".
    status: Mapped[str | None] = mapped_column(String(20))
    checked_at: Mapped[datetime | None]
    provider_scheduled_at: Mapped[datetime | None]
    notified_at: Mapped[datetime | None]
    check_count: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    miss_count: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    actual_at: Mapped[datetime | None]
    purge_at: Mapped[datetime] = mapped_column(index=True)

    leg: Mapped[BookingLeg] = relationship(back_populates="flight")


class DispatchOffer(Base):
    __tablename__ = "dispatch_offers"
    __table_args__ = (UniqueConstraint("booking_leg_id", "driver_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("booking_legs.id", ondelete="CASCADE"), index=True
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), index=True)
    status: Mapped[OfferStatus] = mapped_column(str_enum(OfferStatus), default=OfferStatus.SENT)
    offered_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime]
    responded_at: Mapped[datetime | None]

    leg: Mapped[BookingLeg] = relationship(lazy="joined")


class TripEvent(Base):
    __tablename__ = "trip_events"
    # K-55: müşteri bitirişleri listesi bitiş olaylarını zamana göre sıralar.
    __table_args__ = (Index("ix_trip_events_type_occurred", "event_type", "occurred_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("booking_legs.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[TripEventType] = mapped_column(str_enum(TripEventType))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    occurred_at: Mapped[datetime] = created_at()
    # K-63: sürücünün olay anındaki konumu (kanıt; vardım, yolcu gelmedi, bitti).
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))


class TripMessage(Base):
    """Müşteri ile sürücü arasındaki yolculuk sohbeti (K-50).

    Yalnızca bacağa atanmış sürücü ile rezervasyon sahibi yazışır; telefon numarası paylaşılmaz.
    Metin kişisel veri içerebileceği için şifreli tutulur; yolculuktan 30 gün sonra silinir.
    """

    __tablename__ = "trip_messages"
    __table_args__ = (Index("ix_trip_messages_leg_created", "booking_leg_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_legs.id", ondelete="CASCADE"))
    sender: Mapped[str] = mapped_column(String(10))  # customer | driver
    # Sürücü mesajında gönderen sürücü (K-55); 0006 öncesi mesajlarda boş.
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drivers.id"))
    body: Mapped[str] = mapped_column(EncryptedString)
    # K-62 otomatik çeviri: alıcının diline çevrilmiş metin (çeviri kapalıysa ya da aynı dilse boş).
    translated_body: Mapped[str | None] = mapped_column(EncryptedString)
    translated_lang: Mapped[str | None] = mapped_column(String(5))
    created_at: Mapped[datetime] = created_at()
    read_at: Mapped[datetime | None]


class TripUpdate(Base):
    """Uygulama içi bildirim akışı (sürücü kabul etti, yolda, yaklaşıyor, yeni mesaj...).

    Uygulama bu akışı yoklayıp yerel bildirim gösterir; push sağlayıcısı (FCM) açıkken aynı
    metin push olarak da gider. Metin şablondan, gönderim anında alıcının dilinde üretilir.
    """

    __tablename__ = "trip_updates"
    __table_args__ = (Index("ix_trip_updates_recipient_created", "recipient_type", "recipient_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_legs.id", ondelete="CASCADE"), index=True)
    recipient_type: Mapped[str] = mapped_column(String(10))  # customer | driver
    recipient_id: Mapped[uuid.UUID]
    code: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = created_at()


class MeetingGuide(Base):
    """K-62 havalimanı buluşma rehberi: terminal başına fotoğraflı adımlar, müşterinin dilinde.

    `steps`: [{"texts": {"tr": "...", "en": "...", ...}, "photo_key": "..." | null}, ...]
    """

    __tablename__ = "meeting_guides"
    __table_args__ = (UniqueConstraint("region_id", "terminal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"), index=True)
    terminal: Mapped[str] = mapped_column(String(40), default="", server_default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    updated_at: Mapped[datetime] = created_at()

    region: Mapped[Region] = relationship(lazy="joined")


class TripRating(Base):
    """K-62 yolculuk sonrası puan ve isteğe bağlı bahşiş. Bahşişin tamamı sürücüye gider."""

    __tablename__ = "trip_ratings"
    __table_args__ = (CheckConstraint("stars between 1 and 5", name="stars_range"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("booking_legs.id", ondelete="CASCADE"), unique=True
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), index=True)
    stars: Mapped[int] = mapped_column(SmallInteger)
    comment: Mapped[str | None] = mapped_column(EncryptedString)
    tip_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    currency: Mapped[Currency] = mapped_column(str_enum(Currency))
    # yok | beklemede | odendi | basarisiz
    tip_status: Mapped[str] = mapped_column(String(12), default="yok", server_default="yok")
    tip_payment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payments.id"), index=True)
    created_at: Mapped[datetime] = created_at()
