"""K-79: günlük kiralamada sürücünün gün sonu km kaydı

`booking_legs.day_km_used` (sürücünün beyan ettiği o günkü km) ve `day_reported_at`. Saat, yolculuk olaylarından
(başladı, bitti) hesaplanır. Aşım ücreti bu kayda göre yalnızca bilgi olarak gösterilir; tahsil akışı yoktur.

Revision ID: 0018
Revises: 0017
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("booking_legs", sa.Column("day_km_used", sa.Integer(), nullable=True))
    op.add_column("booking_legs", sa.Column("day_reported_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(op.f("ck_booking_legs_day_km_used_range"), "booking_legs",
                               "day_km_used IS NULL OR (day_km_used >= 0 AND day_km_used <= 3000)")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_booking_legs_day_km_used_range"), "booking_legs", type_="check")
    op.drop_column("booking_legs", "day_reported_at")
    op.drop_column("booking_legs", "day_km_used")
