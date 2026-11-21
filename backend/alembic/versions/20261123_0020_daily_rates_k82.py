"""K-82: kesin günlük kiralama fiyatları

Tam gün (10 saat, günde 200 km dahil): Standart Vito (minivan) 250 €, VIP Vito (vip_van) 275 €, Standart Sprinter
(minibus) 300 €, VIP Sprinter (vip_minibus) 375 €. Fiyatlar sürümlüdür (K-79): eski sürüm düzenlenmez, her araç tipi
için yeni sürüm eklenir; yarım gün ve aşım ücretleri o anki geçerli sürümden aynen taşınır. Mevcut rezervasyonlar
dondurdukları sürümde kalır. Araç tipi ya da fiyat sürümü olmayan (boş) veritabanında bir şey yapılmaz; seed yeni
fiyatlarla ekler.

Geri alma: bu migration'ın eklediği (seed'in başlangıç tarihli sürümleri hariç) ve hiçbir rezervasyonun bağlı olmadığı sürümler silinir, rezervasyon bağlı
olanlar pasife alınır; böylece bir önceki sürüm yeniden geçerli olur.

Revision ID: 0020
Revises: 0019
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FULL_DAY = {"minivan": 250, "vip_van": 275, "minibus": 300, "vip_minibus": 375}
FULL_DAY_KM = 200
FULL_DAY_HOURS = 10


def upgrade() -> None:
    conn = op.get_bind()
    for code, price in FULL_DAY.items():
        current = conn.execute(sa.text("""
            SELECT r.* FROM daily_rates r JOIN vehicle_types v ON v.id = r.vehicle_type_id
            WHERE v.code = :code AND v.is_active AND r.is_active AND r.valid_from <= now()
              AND (r.valid_to IS NULL OR r.valid_to > now())
            ORDER BY r.valid_from DESC, r.id DESC LIMIT 1"""), {"code": code}).mappings().first()
        if current is None:
            continue
        if current["full_day_price"] == price and current["full_day_km"] == FULL_DAY_KM:
            continue  # zaten güncel
        half_km = min(current["half_day_km"], FULL_DAY_KM)
        half_hours = min(current["half_day_hours"], FULL_DAY_HOURS - 1)
        half_price = min(current["half_day_price"], price)
        conn.execute(sa.text("""
            INSERT INTO daily_rates (vehicle_type_id, full_day_price, half_day_price, full_day_hours, half_day_hours,
                                     full_day_km, half_day_km, extra_hour_price, extra_km_price, valid_from,
                                     valid_to, is_active)
            VALUES (:vt, :full, :half, :fh, :hh, :fkm, :hkm, :xh, :xkm, now(), NULL, true)"""),
            {"vt": current["vehicle_type_id"], "full": price, "half": half_price, "fh": FULL_DAY_HOURS,
             "hh": half_hours, "fkm": FULL_DAY_KM, "hkm": half_km, "xh": current["extra_hour_price"],
             "xkm": current["extra_km_price"]})


def downgrade() -> None:
    conn = op.get_bind()
    for code, price in FULL_DAY.items():
        ids = list(conn.execute(sa.text("""
            SELECT r.id FROM daily_rates r JOIN vehicle_types v ON v.id = r.vehicle_type_id
            WHERE v.code = :code AND r.full_day_price = :price AND r.full_day_km = :km
              AND r.valid_from > '2026-01-01T00:00:00+00:00'"""),  # seed sürümleri (EPOCH) dokunulmaz
            {"code": code, "price": price, "km": FULL_DAY_KM}).scalars())
        for rid in ids:
            used = conn.execute(sa.text("SELECT 1 FROM bookings WHERE daily_rate_id = :id LIMIT 1"), {"id": rid}).first()
            if used:
                conn.execute(sa.text("UPDATE daily_rates SET is_active = false WHERE id = :id"), {"id": rid})
            else:
                conn.execute(sa.text("DELETE FROM daily_rates WHERE id = :id"), {"id": rid})
