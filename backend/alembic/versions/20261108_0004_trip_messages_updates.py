"""Yolculuk sohbeti, uygulama içi bildirim akışı, müşteri push jetonu

K-50 (sohbet), K-51 (bildirimler). Sohbet metni şifreli (EncryptedString → Text).

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("push_token", sa.String(length=255), nullable=True))
    op.create_table(
        "trip_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("booking_leg_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("booking_legs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender", sa.String(length=10), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trip_messages_leg_created", "trip_messages", ["booking_leg_id", "created_at"])
    op.create_table(
        "trip_updates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("booking_leg_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("booking_legs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_type", sa.String(length=10), nullable=False),
        sa.Column("recipient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.String(length=500), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_trip_updates_booking_leg_id", "trip_updates", ["booking_leg_id"])
    op.create_index("ix_trip_updates_recipient_created", "trip_updates", ["recipient_type", "recipient_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_trip_updates_recipient_created", table_name="trip_updates")
    op.drop_index("ix_trip_updates_booking_leg_id", table_name="trip_updates")
    op.drop_table("trip_updates")
    op.drop_index("ix_trip_messages_leg_created", table_name="trip_messages")
    op.drop_table("trip_messages")
    op.drop_column("customers", "push_token")
