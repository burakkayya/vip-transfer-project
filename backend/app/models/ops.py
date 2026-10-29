"""Operasyon ve sistem."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, str_enum, uuid_pk
from app.models.enums import NotificationChannel, NotificationStatus


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    recipient_type: Mapped[str] = mapped_column(String(20))
    recipient_id: Mapped[uuid.UUID] = mapped_column(index=True)
    channel: Mapped[NotificationChannel] = mapped_column(str_enum(NotificationChannel))
    template_code: Mapped[str] = mapped_column(String(50))
    status: Mapped[NotificationStatus] = mapped_column(
        str_enum(NotificationStatus), default=NotificationStatus.QUEUED
    )
    error: Mapped[str | None] = mapped_column(String(255))
    sent_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class NotificationTemplate(Base):
    __tablename__ = "notification_templates"
    __table_args__ = (UniqueConstraint("code", "locale", "channel"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50))
    locale: Mapped[str] = mapped_column(String(5))
    channel: Mapped[NotificationChannel] = mapped_column(str_enum(NotificationChannel))
    subject: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)


class AuditLog(Base):
    """Yalnızca eklenebilir. UPDATE/DELETE veritabanı tetikleyicisiyle engellenir."""

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), index=True)
    changes: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = created_at()
