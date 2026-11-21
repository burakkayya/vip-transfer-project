"""K-81: sürücü profil fotoğrafı admin onayından geçmeden müşteriye gösterilmez

`drivers.photo_status` (beklemede | onaylandi | reddedildi), `photo_reject_reason`, `photo_reviewed_at`,
`photo_reviewed_by`. Fotoğrafı olan mevcut sürücüler "beklemede" başlar: onaylanana kadar müşteri kartında ve takip
bağlantısında fotoğraf görünmez.

Revision ID: 0019
Revises: 0018
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("photo_status", sa.String(12), nullable=True))
    op.add_column("drivers", sa.Column("photo_reject_reason", sa.String(255), nullable=True))
    op.add_column("drivers", sa.Column("photo_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("drivers", sa.Column("photo_reviewed_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True))
    op.execute("UPDATE drivers SET photo_status = 'beklemede' WHERE photo_key IS NOT NULL")
    op.create_check_constraint(
        op.f("ck_drivers_photo_status_values"), "drivers",
        "photo_status IS NULL OR photo_status IN ('beklemede', 'onaylandi', 'reddedildi')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_drivers_photo_status_values"), "drivers", type_="check")
    op.drop_column("drivers", "photo_reviewed_by")
    op.drop_column("drivers", "photo_reviewed_at")
    op.drop_column("drivers", "photo_reject_reason")
    op.drop_column("drivers", "photo_status")
