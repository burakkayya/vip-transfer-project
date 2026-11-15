"""K-75: genel komisyon %20

Var olan veritabanında açık genel kural kapatılır (valid_to=şimdi) ve %20 yeni sürüm eklenir. Kurallar
sürümlüdür: eski rezervasyonlar kendi dondurulmuş oranıyla (commission_rate) kalır. Boş veritabanında bir şey
yapılmaz; seed %20 ekler. İleri tarihli (planlanmış) genel kurala dokunulmaz. Bölge ve araç tipi kuralları değişmez.
Yeni iller (K-75) bölge verisidir: migration'dan sonra `python -m app.cli seed` çalıştırılmalıdır.

Revision ID: 0014
Revises: 0013
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        WITH closed AS (
            UPDATE commission_rules SET valid_to = now()
            WHERE scope = 'genel' AND is_active AND valid_from <= now()
              AND (valid_to IS NULL OR valid_to > now()) AND rate <> 0.20
            RETURNING id
        )
        INSERT INTO commission_rules (scope, scope_ref_id, rate, valid_from, valid_to, is_active)
        SELECT 'genel', NULL, 0.20, now(),
               -- Planlanmış genel kural varsa %20 onun başlangıcında biter; plan geçerli kalır.
               (SELECT min(valid_from) FROM commission_rules WHERE scope = 'genel' AND is_active AND valid_from > now()),
               true
        WHERE EXISTS (SELECT 1 FROM closed)
    """)


def downgrade() -> None:
    # Veri sürümü geri alınmaz: oran admin panelinden yeni kural eklenerek değiştirilir (K-02).
    pass
