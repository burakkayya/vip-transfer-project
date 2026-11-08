"""Sohbet mesajında gönderen sürücü ve bitiş olayları indeksi (K-55)

trip_messages.driver_id: iş başka sürücüye devredilse de şikâyet incelemesinde mesajı yazan sürücü görünür.
Eski sürücü mesajları bacağın o anki sürücüsüyle doldurulur (yeniden atama yapılmadıysa doğrudur).
trip_events (event_type, occurred_at) indeksi: müşteri bitirişleri listesi.

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trip_messages", sa.Column("driver_id", postgresql.UUID(as_uuid=True),
                                             sa.ForeignKey("drivers.id"), nullable=True))
    op.execute(
        "UPDATE trip_messages m SET driver_id = l.driver_id FROM booking_legs l "
        "WHERE m.booking_leg_id = l.id AND m.sender = 'driver' AND m.driver_id IS NULL"
    )
    op.create_index("ix_trip_events_type_occurred", "trip_events", ["event_type", "occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_trip_events_type_occurred", table_name="trip_events")
    op.drop_column("trip_messages", "driver_id")
