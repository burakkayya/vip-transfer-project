"""Ödeme, iade, finans. Kart verisi tutulmaz, yalnızca sağlayıcı referansları (K-17)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, created_at, str_enum, uuid_pk
from app.models.enums import (
    Currency,
    InvoiceStatus,
    LedgerStatus,
    PaymentProviderCode,
    PaymentStatus,
    PayoutStatus,
    RefundStatus,
)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), index=True)
    provider: Mapped[PaymentProviderCode] = mapped_column(str_enum(PaymentProviderCode))
    # Sağlayıcıya gönderilen sipariş numarası (PayTR merchant_oid).
    merchant_oid: Mapped[str] = mapped_column(String(64), unique=True)
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[Currency] = mapped_column(str_enum(Currency))
    status: Mapped[PaymentStatus] = mapped_column(
        str_enum(PaymentStatus), default=PaymentStatus.PENDING
    )
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    # Sağlayıcı ödeme sayfası adresi: açık ödeme süresi içinde yeniden kullanılır (çift ödeme önlemi, K-46).
    checkout_url: Mapped[str | None] = mapped_column(String(1000))
    paid_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()

    refunds: Mapped[list[Refund]] = relationship(back_populates="payment", lazy="selectin")

    @property
    def refunded_amount(self) -> Decimal:
        return sum(
            (r.amount for r in self.refunds if r.status is not RefundStatus.FAILED),
            Decimal("0"),
        )


class PaymentWebhook(Base):
    __tablename__ = "payment_webhooks"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[PaymentProviderCode] = mapped_column(str_enum(PaymentProviderCode))
    event_type: Mapped[str] = mapped_column(String(50))
    merchant_oid: Mapped[str | None] = mapped_column(String(64), index=True)
    raw_payload: Mapped[dict] = mapped_column(JSON)  # maskelenmiş
    signature_valid: Mapped[bool]
    received_at: Mapped[datetime] = created_at()
    processed_at: Mapped[datetime | None]


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[uuid.UUID] = uuid_pk()
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    reason: Mapped[str] = mapped_column(String(255))
    policy_id: Mapped[int | None] = mapped_column(ForeignKey("cancellation_policies.id"))
    refund_percent: Mapped[int]
    status: Mapped[RefundStatus] = mapped_column(
        str_enum(RefundStatus), default=RefundStatus.PENDING
    )
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = created_at()

    payment: Mapped[Payment] = relationship(back_populates="refunds")


class DriverLedger(Base):
    """Sürücü hakedişi. Sürücüye TL ödenir (odeme.md)."""

    __tablename__ = "driver_ledger"
    __table_args__ = (UniqueConstraint("booking_leg_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), index=True)
    booking_leg_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booking_legs.id"))
    gross_amount: Mapped[Decimal] = mapped_column(Money)
    commission_amount: Mapped[Decimal] = mapped_column(Money)
    net_amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[Currency] = mapped_column(str_enum(Currency))
    net_amount_try: Mapped[Decimal | None] = mapped_column(Money)
    status: Mapped[LedgerStatus] = mapped_column(
        str_enum(LedgerStatus), default=LedgerStatus.PENDING
    )
    payout_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("driver_payouts.id"))
    created_at: Mapped[datetime] = created_at()


class DriverPayout(Base):
    __tablename__ = "driver_payouts"

    id: Mapped[uuid.UUID] = uuid_pk()
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), index=True)
    total_try: Mapped[Decimal] = mapped_column(Money)
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[PayoutStatus] = mapped_column(
        str_enum(PayoutStatus), default=PayoutStatus.PENDING
    )
    paid_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), index=True)
    type: Mapped[str] = mapped_column(String(20), default="e-arsiv")
    gib_ref: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[InvoiceStatus] = mapped_column(
        str_enum(InvoiceStatus), default=InvoiceStatus.PENDING
    )
    issued_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()
