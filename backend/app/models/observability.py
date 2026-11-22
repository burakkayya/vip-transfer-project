"""K-83: olaylar (incident), olay tekrarları ve rezervasyon bazında yolculuk geçmişi.

Saklama süreleri `app/retention.py`'dedir. Kişisel veri taşıyabilecek alanlar (ayrıntı, bağlam, konum) maskelenip
şifreli tutulur.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, uuid_pk
from app.security.crypto import EncryptedString


class Incident(Base):
    """Aynı hatanın tekrarları tek kayıtta toplanır (parmak izi). Durum: open | acknowledged | resolved."""

    __tablename__ = "incidents"
    __table_args__ = (Index("ix_incidents_status_last_seen", "status", "last_seen_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    level: Mapped[str] = mapped_column(String(10))  # warning | error | critical
    source: Mapped[str] = mapped_column(String(20), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    code: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200))
    # Maskelenmiş ayrıntı (kod konumu, istemci yığın izi); yine de kişisel veri kaçabileceği için şifreli.
    detail: Mapped[str | None] = mapped_column(EncryptedString)
    status: Mapped[str] = mapped_column(String(15), default="open")
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime] = created_at()
    last_notified_at: Mapped[datetime | None]
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    acknowledged_at: Mapped[datetime | None]
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None]
    resolution_note: Mapped[str | None] = mapped_column(EncryptedString)


class IncidentOccurrence(Base):
    """Bir tekrarın senaryosu: istek, aktör, ilgili rezervasyon, platform. Bağlam şifreli JSON metnidir."""

    __tablename__ = "incident_occurrences"
    __table_args__ = (
        Index("ix_incident_occurrences_incident_occurred", "incident_id", "occurred_at"),
        Index("ix_incident_occurrences_occurred_at", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"))
    occurred_at: Mapped[datetime] = created_at()
    request_id: Mapped[str | None] = mapped_column(String(64), index=True)
    # Yabancı anahtar yok (bilerek): olay ayrı bir bağlantıda yazılır; isteğin işlemi rezervasyonu kilitlemişken
    # anahtar denetimi o kilidi bekler ve istek kendi olay kaydını beklerken kilitlenirdi.
    booking_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    context: Mapped[str | None] = mapped_column(EncryptedString)


class BookingActivity(Base):
    """Rezervasyonun adım adım geçmişi. Yalnızca eklenebilir: UPDATE/DELETE tetikleyiciyle engellenir; yalnızca
    saklama görevi (işlem içi `getaway.retention_purge` bayrağıyla) siler ya da konumu boşaltır."""

    __tablename__ = "booking_activities"
    __table_args__ = (
        Index("ix_booking_activities_booking_occurred", "booking_id", "occurred_at"),
        Index("ix_booking_activities_occurred_at", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"))
    booking_leg_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("booking_legs.id", ondelete="CASCADE"))
    occurred_at: Mapped[datetime] = created_at()
    actor_type: Mapped[str] = mapped_column(String(10))  # customer | driver | staff | system
    actor_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    event: Mapped[str] = mapped_column(String(60))
    platform: Mapped[str | None] = mapped_column(String(10))  # web | ios | android | admin | system
    app_version: Mapped[str | None] = mapped_column(String(30))
    request_id: Mapped[str | None] = mapped_column(String(64))
    # Kişisel veri içermez (kodlar, tutarlar, durumlar); yine de anahtar maskesinden geçer.
    data: Mapped[dict | None] = mapped_column(JSON)
    # "enlem,boylam"; yalnızca önemli anlarda (vardı, yolcu alındı, bitti, gelmedi). 180 gün sonra boşaltılır.
    location: Mapped[str | None] = mapped_column(EncryptedString)
