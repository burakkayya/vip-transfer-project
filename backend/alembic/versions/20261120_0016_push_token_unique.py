"""Push jetonu tek hesaba ait: customers ve drivers için kısmi benzersiz indeks

Uygulama bir jetonu yeni hesaba bağlarken eski sahiplerden siler (notifications.bind_push_token); eşzamanlı
iki bağlama yarışında aynı jeton iki hesapta kalabiliyordu. İndeksten önce olası tekrarlar temizlenir:
her jeton için yalnızca bir satır (müşterilerde ve sürücülerde ayrı ayrı) jetonu korur. Müşteri ile sürücü
arasındaki çapraz tekrar indeksle engellenemez; uygulama devri bunu yapar.

Revision ID: 0016
Revises: 0015
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("customers", "drivers")


def upgrade() -> None:
    for table in TABLES:
        op.execute(
            f"""
            UPDATE {table} t SET push_token = NULL
            FROM (
                SELECT id, row_number() OVER (PARTITION BY push_token ORDER BY id) AS rn
                FROM {table} WHERE push_token IS NOT NULL
            ) d
            WHERE t.id = d.id AND d.rn > 1
            """
        )
        op.create_index(
            f"uq_{table}_push_token", table, ["push_token"], unique=True,
            postgresql_where="push_token IS NOT NULL",
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"uq_{table}_push_token", table_name=table)
