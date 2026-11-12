"""Güvenlik F0-2 / F0-3 (AUTH-01, AUTH-04, AUTH-07): personel deneme sayacı, kilit, MFA jti,
TOTP son adım; otp_challenges IP ve zaman indeksleri

Revision ID: 0008
Revises: 0007
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("failed_login_count", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("failed_login_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("mfa_jti", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("users", sa.Column("mfa_attempts", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    op.create_index("ix_otp_challenges_ip_created_at", "otp_challenges", ["ip", "created_at"])
    op.create_index("ix_otp_challenges_created_at", "otp_challenges", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_otp_challenges_created_at", table_name="otp_challenges")
    op.drop_index("ix_otp_challenges_ip_created_at", table_name="otp_challenges")
    op.drop_column("users", "totp_last_step")
    op.drop_column("users", "mfa_attempts")
    op.drop_column("users", "mfa_jti")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_started_at")
    op.drop_column("users", "failed_login_count")
