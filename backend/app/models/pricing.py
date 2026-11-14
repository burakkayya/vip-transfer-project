"""Bölge ve fiyat kuralları. Kurallar silinmez, yeni sürüm eklenir; eski rezervasyonlar
hangi kural sürümüyle hesaplandıysa ona bağlı kalır."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from geoalchemy2 import Geography
from sqlalchemy import CheckConstraint, Computed, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, Rate, created_at, str_enum
from app.models.enums import CommissionScope, DiscountType, RegionType


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    province: Mapped[str] = mapped_column(String(30))  # antalya, mugla
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[RegionType] = mapped_column(str_enum(RegionType))
    iata_code: Mapped[str | None] = mapped_column(String(3))
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    # PostGIS sorguları için enlem/boylamdan türetilir.
    location = mapped_column(
        Geography("POINT", srid=4326, spatial_index=True),
        Computed(
            "ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography",
            persisted=True,
        ),
    )
    is_active: Mapped[bool] = mapped_column(default=True)


class PopularPlace(Base):
    """Sık seçilen otel, marina ve buluşma noktaları (K-61). Liste bize aittir: adı ve konumu admin girer
    ya da onaylar. Adres aramasında önce buradan önerilir; kısa sorguda ücretli API'ye gidilmez."""

    __tablename__ = "popular_places"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    subtitle: Mapped[str] = mapped_column(String(200), default="")
    # Arama metni: ad + açıklama, Türkçe karakterleri sadeleştirilmiş (providers.places.normalize).
    search_text: Mapped[str] = mapped_column(String(400), index=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"))
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    # Aynı yer Google sonucunda da çıkarsa çift gösterilmesin diye saklanır.
    google_place_id: Mapped[str | None] = mapped_column(String(300), unique=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = created_at()

    region: Mapped[Region] = relationship()


class PricingRule(Base):
    __tablename__ = "pricing_rules"
    __table_args__ = (
        CheckConstraint("base_price_per_km > 0", name="positive_km_price"),
        CheckConstraint("minimum_price >= 0", name="non_negative_minimum"),
        CheckConstraint("rounding_step > 0", name="positive_step"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_type_id: Mapped[int] = mapped_column(ForeignKey("vehicle_types.id"), index=True)
    base_price_per_km: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("1.10"))
    minimum_price: Mapped[Decimal] = mapped_column(Money, default=Decimal("30"))
    rounding_step: Mapped[Decimal] = mapped_column(Money, default=Decimal("5"))
    valid_from: Mapped[datetime]
    valid_to: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = created_at()


class RoundTripDiscount(Base):
    __tablename__ = "round_trip_discounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[DiscountType] = mapped_column(str_enum(DiscountType))
    value: Mapped[Decimal] = mapped_column(Money)
    valid_from: Mapped[datetime]
    valid_to: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = created_at()


class CancellationPolicy(Base):
    """Kademeli iptal politikası başlığı. Kademeler cancellation_policy_tiers'ta.

    Belgedeki tek tablo, rezervasyonun tek bir politika kimliğini dondurabilmesi için
    başlık + kademe olarak ikiye ayrıldı.
    """

    __tablename__ = "cancellation_policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    valid_from: Mapped[datetime]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = created_at()

    tiers: Mapped[list[CancellationPolicyTier]] = relationship(
        lazy="selectin",
        order_by="CancellationPolicyTier.hours_before_pickup.desc()",
        cascade="all, delete-orphan",
    )


class CancellationPolicyTier(Base):
    __tablename__ = "cancellation_policy_tiers"
    __table_args__ = (
        CheckConstraint("refund_percent BETWEEN 0 AND 100", name="percent_range"),
        CheckConstraint("hours_before_pickup >= 0", name="non_negative_hours"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    policy_id: Mapped[int] = mapped_column(
        ForeignKey("cancellation_policies.id", ondelete="CASCADE"), index=True
    )
    hours_before_pickup: Mapped[int]
    refund_percent: Mapped[int]


class CommissionRule(Base):
    __tablename__ = "commission_rules"
    __table_args__ = (CheckConstraint("rate >= 0 AND rate < 1", name="rate_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[CommissionScope] = mapped_column(str_enum(CommissionScope))
    scope_ref_id: Mapped[int | None]  # bölge veya araç tipi kimliği
    rate: Mapped[Decimal] = mapped_column(Rate)
    valid_from: Mapped[datetime]
    valid_to: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = created_at()


class ExchangeRate(Base):
    """EUR -> TRY kuru. TRY fiyatı bu kurla hesaplanır, rezervasyonda dondurulur."""

    __tablename__ = "exchange_rates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    base: Mapped[str] = mapped_column(String(3), default="EUR")
    quote: Mapped[str] = mapped_column(String(3), default="TRY")
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    source: Mapped[str] = mapped_column(String(50))  # manuel, tcmb
    valid_from: Mapped[datetime]
    created_at: Mapped[datetime] = created_at()
