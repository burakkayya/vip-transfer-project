"""Güvenlik F1-4 (AUTH-08): refresh jetonu yeniden kullanım tespiti için önceki jeton özeti
ve dönüş zamanı

Revision ID: 0009
Revises: 0008
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("previous_refresh_hash", sa.String(64), nullable=True))
    op.add_column("sessions", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sessions_previous_refresh_hash", "sessions", ["previous_refresh_hash"])


def downgrade() -> None:
    op.drop_index("ix_sessions_previous_refresh_hash", table_name="sessions")
    op.drop_column("sessions", "rotated_at")
    op.drop_column("sessions", "previous_refresh_hash")
