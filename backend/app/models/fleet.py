"""Sürücü, araç, belge."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, str_enum, uuid_pk
from app.models.enums import (
    DocumentOwner,
    DocumentStatus,
    DocumentType,
    DriverStatus,
    ReviewDecision,
    VehicleStatus,
)
from app.models.identity import User
from app.security.crypto import EncryptedString


class Driver(Base):
    """Telefon users tablosunda tutulur."""

    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )
    full_name: Mapped[str] = mapped_column(EncryptedString)
    tursab_or_agency_no: Mapped[str | None] = mapped_column(String(50))
    iban: Mapped[str | None] = mapped_column(EncryptedString)
    status: Mapped[DriverStatus] = mapped_column(
        str_enum(DriverStatus), default=DriverStatus.APPLIED
    )
    is_online: Mapped[bool] = mapped_column(default=False)
    push_token: Mapped[str | None] = mapped_column(String(255))
    # K-62 sürücü kartı: profil fotoğrafı (şifreli depoda) ve konuştuğu diller (virgülle, ör. "tr,en").
    photo_key: Mapped[str | None] = mapped_column(EncryptedString)
    photo_content_type: Mapped[str | None] = mapped_column(String(20))
    languages: Mapped[str] = mapped_column(String(40), default="tr", server_default="tr")
    created_at: Mapped[datetime] = created_at()

    user: Mapped[User] = relationship(lazy="joined")

    @property
    def language_list(self) -> list[str]:
        return [x for x in (self.languages or "").split(",") if x]


class VehicleType(Base):
    __tablename__ = "vehicle_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int]
    luggage_capacity: Mapped[int] = mapped_column(default=0)
    price_multiplier: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("1.00"))
    is_active: Mapped[bool] = mapped_column(default=True)


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = uuid_pk()
    plate: Mapped[str] = mapped_column(String(20), unique=True)
    vehicle_type_id: Mapped[int] = mapped_column(ForeignKey("vehicle_types.id"))
    brand: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(50))
    year: Mapped[int | None]
    capacity: Mapped[int]
    # K-62 müşterinin aracı kalabalıkta tanıması için renk.
    color: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[VehicleStatus] = mapped_column(
        str_enum(VehicleStatus), default=VehicleStatus.PENDING
    )
    created_at: Mapped[datetime] = created_at()

    vehicle_type: Mapped[VehicleType] = relationship(lazy="joined")


class DriverVehicleAssignment(Base):
    __tablename__ = "driver_vehicle_assignments"
    __table_args__ = (UniqueConstraint("driver_id", "vehicle_id", "valid_from"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    driver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drivers.id"), index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"), index=True)
    valid_from: Mapped[datetime]
    valid_to: Mapped[datetime | None]

    vehicle: Mapped[Vehicle] = relationship(lazy="joined")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_type: Mapped[DocumentOwner] = mapped_column(str_enum(DocumentOwner))
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    doc_type: Mapped[DocumentType] = mapped_column(str_enum(DocumentType, 40))
    storage_key: Mapped[str] = mapped_column(EncryptedString)
    content_type: Mapped[str] = mapped_column(String(100))
    valid_until: Mapped[date | None]
    status: Mapped[DocumentStatus] = mapped_column(
        str_enum(DocumentStatus), default=DocumentStatus.PENDING
    )
    created_at: Mapped[datetime] = created_at()


class DocumentReview(Base):
    __tablename__ = "document_reviews"

    id: Mapped[uuid.UUID] = uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[ReviewDecision] = mapped_column(str_enum(ReviewDecision))
    note: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = created_at()
