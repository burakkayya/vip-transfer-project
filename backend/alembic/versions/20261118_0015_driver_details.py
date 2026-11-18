"""K-78: sürücü detayları ve araç detayları

Sürücüye WhatsApp (isteğe bağlı, şifreli) ve çalıştığı il eklenir. Zorunlu belge listeleri sistem ayarında
saklıysa ve eski varsayılanla aynıysa yeni listeye geçirilir (admin'in elle değiştirdiği listeye dokunulmaz).
Yeni belge türleri düz metin enum olduğundan şema değişikliği gerektirmez.

Geri alma veri açısından tek yönlüdür: yeni türlerdeki belge satırları (kimlik, D2, araç fotoğrafları) silinmez;
kod da 0015 öncesine alınırsa bu satırlar okunamaz. Geri almadan önce bu türler elle temizlenmeli.

Revision ID: 0015
Revises: 0014
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = {
    "required_driver_documents": ["surucu_belgesi", "src_belgesi", "adli_sicil"],
    "required_vehicle_documents": ["arac_ruhsati", "arac_sigortasi", "arac_muayene", "turizm_tasimacilik_yetki"],
}
NEW = {
    "required_driver_documents": ["kimlik", "surucu_belgesi", "adli_sicil", "d2_yetki_belgesi", "tursab_belgesi"],
    "required_vehicle_documents": ["arac_foto_dis", "arac_foto_on_koltuk", "arac_foto_arka_koltuk", "arac_foto_bagaj",
                                   "arac_ruhsati", "arac_muayene", "arac_sigortasi"],
}


def _swap(src: dict, dst: dict) -> None:
    bind = op.get_bind()
    for key, old in src.items():
        row = bind.execute(sa.text("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
        if row is None:
            continue
        value = row[0] if not isinstance(row[0], str) else json.loads(row[0])
        if sorted(value) == sorted(old):
            bind.execute(sa.text("UPDATE system_settings SET value = CAST(:v AS JSON) WHERE key = :k"),
                         {"k": key, "v": json.dumps(dst[key])})


def upgrade() -> None:
    op.add_column("drivers", sa.Column("whatsapp_phone", sa.Text(), nullable=True))
    op.add_column("drivers", sa.Column("operating_province", sa.String(20), nullable=True))
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)
    op.drop_column("drivers", "operating_province")
    op.drop_column("drivers", "whatsapp_phone")
