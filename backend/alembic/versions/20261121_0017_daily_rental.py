"""K-29: şoförlü günlük kiralama

`daily_rates` (araç tipi başına sürümlü günlük fiyat, EUR) ve `bookings` üzerinde hizmet türü (`service_type`,
varsayılan transfer), dondurulan fiyat sürümü (`daily_rate_id`) ve paket (`daily_package`). Mevcut rezervasyonlar
transfer olarak kalır. Tahmini başlangıç fiyatları seed ile eklenir (`python -m app.cli seed`).

Geri alma: günlük kiralama rezervasyonları varken geri alınırsa bu rezervasyonlar transfer gibi görünür
(her gün ayrı bacak); geri almadan önce günlük kiralama rezervasyonu olmadığı denetlenmelidir.

Revision ID: 0017
Revises: 0016
"""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_type_id", sa.Integer(), nullable=False),
        sa.Column("full_day_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("half_day_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("full_day_hours", sa.Integer(), nullable=False),
        sa.Column("half_day_hours", sa.Integer(), nullable=False),
        sa.Column("full_day_km", sa.Integer(), nullable=False),
        sa.Column("half_day_km", sa.Integer(), nullable=False),
        sa.Column("extra_hour_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("extra_km_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["vehicle_type_id"], ["vehicle_types.id"],
                                name=op.f("fk_daily_rates_vehicle_type_id_vehicle_types")),
        sa.CheckConstraint("full_day_price > 0 AND half_day_price > 0", name=op.f("ck_daily_rates_positive_prices")),
        sa.CheckConstraint("full_day_hours > half_day_hours AND half_day_hours > 0", name=op.f("ck_daily_rates_hours_order")),
        sa.CheckConstraint("full_day_km >= half_day_km AND half_day_km > 0", name=op.f("ck_daily_rates_km_order")),
    )
    op.create_index("ix_daily_rates_vehicle_type_id", "daily_rates", ["vehicle_type_id"])
    op.add_column("bookings", sa.Column("service_type", sa.String(10), nullable=False, server_default="transfer"))
    op.add_column("bookings", sa.Column("daily_rate_id", sa.Integer(), nullable=True))
    op.create_foreign_key(op.f("fk_bookings_daily_rate_id_daily_rates"), "bookings", "daily_rates",
                          ["daily_rate_id"], ["id"])
    op.add_column("bookings", sa.Column("daily_package", sa.String(6), nullable=True))


def downgrade() -> None:
    # Test süiti her oturumda şemayı sıfırlar (yalnızca _test veritabanında); orada koruma uygulanmaz.
    count = op.get_bind().execute(sa.text("SELECT count(*) FROM bookings WHERE service_type = 'gunluk'")).scalar()
    if count and os.environ.get("GETAWAY_ENV") != "test":
        raise RuntimeError(f"{count} günlük kiralama rezervasyonu var; geri alma bunları transfer gibi gösterir. "
                           "Önce bu kayıtlar elle ele alınmalı.")
    op.drop_column("bookings", "daily_package")
    op.drop_constraint(op.f("fk_bookings_daily_rate_id_daily_rates"), "bookings", type_="foreignkey")
    op.drop_column("bookings", "daily_rate_id")
    op.drop_column("bookings", "service_type")
    op.drop_index("ix_daily_rates_vehicle_type_id", table_name="daily_rates")
    op.drop_table("daily_rates")
