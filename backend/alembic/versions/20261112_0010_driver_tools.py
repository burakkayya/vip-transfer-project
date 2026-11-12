"""Sürücü araçları (K-63): kanıtlı bekleme (olay konumu, varış ve gelmedi zamanı)

Revision ID: 0010
Revises: 0009
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trip_events", sa.Column("latitude", sa.Numeric(9, 6), nullable=True))
    op.add_column("trip_events", sa.Column("longitude", sa.Numeric(9, 6), nullable=True))
    op.add_column("booking_legs", sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("booking_legs", sa.Column("no_show_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("booking_legs", "no_show_at")
    op.drop_column("booking_legs", "arrived_at")
    op.drop_column("trip_events", "longitude")
    op.drop_column("trip_events", "latitude")
