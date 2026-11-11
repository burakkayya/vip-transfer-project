"""Uçuş takibi (K-60): flight_infos.status, checked_at, provider_scheduled_at, notified_at, check_count, miss_count

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("flight_infos", sa.Column("status", sa.String(20), nullable=True))
    op.add_column("flight_infos", sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("flight_infos", sa.Column("provider_scheduled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("flight_infos", sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("flight_infos", sa.Column("check_count", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("flight_infos", sa.Column("miss_count", sa.SmallInteger(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("flight_infos", "miss_count")
    op.drop_column("flight_infos", "check_count")
    op.drop_column("flight_infos", "notified_at")
    op.drop_column("flight_infos", "provider_scheduled_at")
    op.drop_column("flight_infos", "checked_at")
    op.drop_column("flight_infos", "status")
