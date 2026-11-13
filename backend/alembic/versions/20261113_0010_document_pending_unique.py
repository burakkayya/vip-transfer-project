"""REV-B-7: sahip + belge türü başına en fazla bir bekleyen belge (kısmi benzersiz indeks)

Mevcut veride aynı sahip ve tür için birden fazla bekleyen belge varsa migration veri silmez veya değiştirmez;
açıklayıcı hatayla durur. Operasyon yinelenenleri inceleyip (biri dışındakileri onaylayarak/reddederek)
migration'ı yeniden çalıştırmalıdır.

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

INDEX = "uq_documents_one_pending"


def upgrade() -> None:
    duplicates = op.get_bind().execute(
        sa.text(
            "SELECT owner_type, doc_type, count(*) FROM documents WHERE status = 'beklemede' "
            "GROUP BY owner_type, owner_id, doc_type HAVING count(*) > 1"
        )
    ).all()
    if duplicates:
        # Sahip kimliği iletiye yazılmaz; yalnızca tür ve sayı.
        summary = ", ".join(f"{o}/{d}: {n}" for o, d, n in duplicates[:20])
        raise RuntimeError(
            f"documents tablosunda aynı sahip ve tür için birden fazla bekleyen belge var ({len(duplicates)} grup; "
            f"{summary}). Migration veri değiştirmez: yinelenenleri admin panelinden inceleyip her grupta tek "
            "bekleyen belge bırakın, sonra yeniden çalıştırın. Sorgu: SELECT owner_type, owner_id, doc_type, "
            "count(*) FROM documents WHERE status='beklemede' GROUP BY 1,2,3 HAVING count(*) > 1"
        )
    op.create_index(
        INDEX,
        "documents",
        ["owner_type", "owner_id", "doc_type"],
        unique=True,
        postgresql_where=sa.text("status = 'beklemede'"),
    )


def downgrade() -> None:
    op.drop_index(INDEX, table_name="documents")
