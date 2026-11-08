"""Admin'in manuel rezervasyonu ve elle tahsilat (K-54)

bookings: source, channel, created_by_id, payment_due_at, system_total_amount, price_override_reason.
payments: manual_method, recorded_by_id, note. Enum değerleri düz metin (str_enum) olduğu için
yeni değerler (`elle`, `admin`) şema değişikliği gerektirmez.

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("source", sa.String(length=16), nullable=False, server_default="musteri"))
    op.add_column("bookings", sa.Column("channel", sa.String(length=16), nullable=True))
    op.add_column("bookings", sa.Column("created_by_id", postgresql.UUID(as_uuid=True),
                                        sa.ForeignKey("users.id"), nullable=True))
    op.add_column("bookings", sa.Column("payment_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bookings", sa.Column("system_total_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("bookings", sa.Column("price_override_reason", sa.String(length=500), nullable=True))
    op.create_index("ix_bookings_source", "bookings", ["source"])

    op.add_column("payments", sa.Column("manual_method", sa.String(length=16), nullable=True))
    op.add_column("payments", sa.Column("recorded_by_id", postgresql.UUID(as_uuid=True),
                                        sa.ForeignKey("users.id"), nullable=True))
    op.add_column("payments", sa.Column("note", sa.String(length=500), nullable=True))


def downgrade() -> None:
    # VERİ KAYBI: kanal, oluşturan personel, ödeme son anı, fiyat gerekçesi ve elle tahsilat yöntemi/notu silinir.
    # `payments.provider = 'elle'` satırları kalır ve 0004 kodu bu değeri tanımaz. Üretimde geri almadan önce bu
    # veriler dışa aktarılmalı ve elle tahsilat satırları taşınmalıdır (test veritabanı her koşuda sıfırlanır).
    op.drop_column("payments", "note")
    op.drop_column("payments", "recorded_by_id")
    op.drop_column("payments", "manual_method")
    op.drop_index("ix_bookings_source", table_name="bookings")
    op.drop_column("bookings", "price_override_reason")
    op.drop_column("bookings", "system_total_amount")
    op.drop_column("bookings", "payment_due_at")
    op.drop_column("bookings", "created_by_id")
    op.drop_column("bookings", "channel")
    op.drop_column("bookings", "source")
