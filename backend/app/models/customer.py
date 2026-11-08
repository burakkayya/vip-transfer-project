"""Müşteri: customers, consents, data_requests. Pasaport bilgisi tutulmaz (K-17)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, str_enum, uuid_pk
from app.models.enums import (
    ConsentType,
    Currency,
    DataRequestStatus,
    DataRequestType,
)
from app.models.identity import User
from app.security.crypto import EncryptedString


class Customer(Base):
    """Telefon users tablosunda (şifreli + kör indeks) tutulur, burada tekrarlanmaz."""

    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )
    full_name: Mapped[str | None] = mapped_column(EncryptedString)
    email: Mapped[str | None] = mapped_column(EncryptedString)
    country_code: Mapped[str | None] = mapped_column(String(2))
    locale: Mapped[str] = mapped_column(String(5), default="tr")
    currency: Mapped[Currency] = mapped_column(str_enum(Currency), default=Currency.EUR)
    verified_at: Mapped[datetime | None]
    deleted_at: Mapped[datetime | None]
    # Mobil push jetonu (FCM/APNs cihaz jetonu). Yalnızca bildirim için kullanılır.
    push_token: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at()

    user: Mapped[User] = relationship(lazy="joined")


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[uuid.UUID] = uuid_pk()
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    consent_type: Mapped[ConsentType] = mapped_column(str_enum(ConsentType))
    version: Mapped[str] = mapped_column(String(20))
    accepted: Mapped[bool] = mapped_column(default=True)
    accepted_at: Mapped[datetime] = created_at()
    ip: Mapped[str | None] = mapped_column(String(45))


class DataRequest(Base):
    __tablename__ = "data_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    request_type: Mapped[DataRequestType] = mapped_column(str_enum(DataRequestType))
    status: Mapped[DataRequestStatus] = mapped_column(
        str_enum(DataRequestStatus), default=DataRequestStatus.OPEN
    )
    note: Mapped[str | None] = mapped_column(String(1000))
    due_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()
