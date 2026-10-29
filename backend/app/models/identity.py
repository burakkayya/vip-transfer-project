"""Kimlik ve yetki: users, roles, user_roles, sessions, otp_challenges."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, str_enum, uuid_pk
from app.models.enums import OtpPurpose, RoleCode, UserKind, UserStatus
from app.security.crypto import BlindIndex, EncryptedString

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    """Giriş yapan her kişi. Müşteri ve sürücü telefonla (OTP), personel e-posta+parola+2FA ile girer."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("kind", "phone_hash", name="uq_users_kind_phone_hash"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[UserKind] = mapped_column(str_enum(UserKind))
    email: Mapped[str | None] = mapped_column(EncryptedString)
    email_hash: Mapped[str | None] = mapped_column(BlindIndex, unique=True)
    phone: Mapped[str | None] = mapped_column(EncryptedString)
    phone_hash: Mapped[str | None] = mapped_column(BlindIndex, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    two_factor_secret: Mapped[str | None] = mapped_column(EncryptedString)
    two_factor_enabled: Mapped[bool] = mapped_column(default=False)
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus), default=UserStatus.ACTIVE
    )
    last_login_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()

    roles: Mapped[list[Role]] = relationship(secondary=user_roles, lazy="selectin")

    @property
    def role_codes(self) -> set[str]:
        return {r.code.value for r in self.roles}


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[RoleCode] = mapped_column(str_enum(RoleCode), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class AuthSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_info: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(45))
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()

    user: Mapped[User] = relationship(lazy="joined")


class OtpChallenge(Base):
    """SMS ile gönderilen tek kullanımlık kod. Kodun kendisi değil, HMAC özeti saklanır."""

    __tablename__ = "otp_challenges"

    id: Mapped[uuid.UUID] = uuid_pk()
    phone_hash: Mapped[str] = mapped_column(BlindIndex, index=True)
    purpose: Mapped[OtpPurpose] = mapped_column(str_enum(OtpPurpose))
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime]
    consumed_at: Mapped[datetime | None]
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = created_at()
