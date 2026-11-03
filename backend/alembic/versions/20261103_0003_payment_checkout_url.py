"""payments.checkout_url

Açık ödemenin sağlayıcı sayfası saklanır; süre dolmadan gelen yeni başlatma isteği aynı sayfayı alır ve ikinci
ödeme kaydı açılmaz (K-46, çift ödeme önlemi).

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("checkout_url", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("payments", "checkout_url")
