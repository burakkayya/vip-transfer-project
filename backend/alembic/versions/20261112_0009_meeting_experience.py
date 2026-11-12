"""Buluşma deneyimi (K-62): ekstralar, paylaşım bağlantısı, yolcu durumu, sürücü kartı,
sohbet çevirisi, buluşma rehberi, puan ve bahşiş

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
    op.add_column("bookings", sa.Column("child_seat_count", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("bookings", sa.Column("market_stop", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("bookings", sa.Column("share_token", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_bookings_share_token", "bookings", ["share_token"])

    op.add_column("booking_legs", sa.Column("passenger_status", sa.String(12), nullable=True))
    op.add_column("booking_legs", sa.Column("passenger_status_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("booking_legs", sa.Column("meeting_guide_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("booking_legs", sa.Column("driver_card_sent_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("drivers", sa.Column("photo_key", sa.Text(), nullable=True))
    op.add_column("drivers", sa.Column("photo_content_type", sa.String(20), nullable=True))
    op.add_column("drivers", sa.Column("languages", sa.String(40), nullable=False, server_default="tr"))
    op.add_column("vehicles", sa.Column("color", sa.String(30), nullable=True))

    op.add_column("trip_messages", sa.Column("translated_body", sa.Text(), nullable=True))
    op.add_column("trip_messages", sa.Column("translated_lang", sa.String(5), nullable=True))

    op.add_column("payments", sa.Column("purpose", sa.String(10), nullable=False, server_default="booking"))
    op.add_column("driver_ledger", sa.Column("kind", sa.String(10), nullable=False, server_default="trip"))
    op.drop_constraint("uq_driver_ledger_booking_leg_id", "driver_ledger", type_="unique")
    op.create_unique_constraint("uq_driver_ledger_leg_kind", "driver_ledger", ["booking_leg_id", "kind"])

    op.create_table(
        "meeting_guides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id"), nullable=False),
        sa.Column("terminal", sa.String(40), nullable=False, server_default=""),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("region_id", "terminal", name="uq_meeting_guides_region_id"),
    )
    op.create_index("ix_meeting_guides_region_id", "meeting_guides", ["region_id"])

    op.create_table(
        "trip_ratings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("booking_leg_id", sa.Uuid(), sa.ForeignKey("booking_legs.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("driver_id", sa.Uuid(), sa.ForeignKey("drivers.id"), nullable=False),
        sa.Column("stars", sa.SmallInteger(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("tip_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(32), nullable=False),
        sa.Column("tip_status", sa.String(12), nullable=False, server_default="yok"),
        sa.Column("tip_payment_id", sa.Uuid(), sa.ForeignKey("payments.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("stars between 1 and 5", name="ck_trip_ratings_stars_range"),
    )
    op.create_index("ix_trip_ratings_driver_id", "trip_ratings", ["driver_id"])
    op.create_index("ix_trip_ratings_tip_payment_id", "trip_ratings", ["tip_payment_id"])


def downgrade() -> None:
    paid = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM driver_ledger WHERE kind <> 'trip' AND payout_id IS NOT NULL")).scalar()
    if paid:
        raise RuntimeError("ödeme kaydına girmiş bahşiş hakedişi var; geri alma para verisini bozar")
    op.drop_index("ix_trip_ratings_tip_payment_id", table_name="trip_ratings")
    op.drop_index("ix_trip_ratings_driver_id", table_name="trip_ratings")
    op.drop_table("trip_ratings")
    op.drop_index("ix_meeting_guides_region_id", table_name="meeting_guides")
    op.drop_table("meeting_guides")
    op.execute("DELETE FROM driver_ledger WHERE kind <> 'trip'")
    op.drop_constraint("uq_driver_ledger_leg_kind", "driver_ledger", type_="unique")
    op.create_unique_constraint("uq_driver_ledger_booking_leg_id", "driver_ledger", ["booking_leg_id"])
    op.drop_column("driver_ledger", "kind")
    op.drop_column("payments", "purpose")
    op.drop_column("trip_messages", "translated_lang")
    op.drop_column("trip_messages", "translated_body")
    op.drop_column("vehicles", "color")
    op.drop_column("drivers", "languages")
    op.drop_column("drivers", "photo_content_type")
    op.drop_column("drivers", "photo_key")
    for col in ("driver_card_sent_at", "meeting_guide_sent_at", "passenger_status_at", "passenger_status"):
        op.drop_column("booking_legs", col)
    op.drop_constraint("uq_bookings_share_token", "bookings", type_="unique")
    for col in ("share_token", "market_stop", "child_seat_count"):
        op.drop_column("bookings", col)
