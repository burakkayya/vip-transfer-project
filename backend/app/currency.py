"""Para birimi seçimi ve EUR -> TRY dönüşümü (K-13, fiyatlandirma.md).

Türkiye TRY, diğer tüm ülkeler (Avrupa dahil) EUR. Fiyat kuralları EUR'dur; TRY
fiyatı rezervasyon anındaki kurla hesaplanır ve TRY yuvarlama adımına yukarı
yuvarlanır. Kur rezervasyonda dondurulur.
"""

from __future__ import annotations

from decimal import Decimal

from app.models.enums import Currency
from app.pricing import round_up_to_step

# K-32: tüm para birimlerinde fiyatlar 5'in katına yukarı yuvarlanır.
DEFAULT_TRY_ROUNDING_STEP = Decimal("5")


def currency_for_country(country_code: str | None) -> Currency:
    if country_code and country_code.upper() == "TR":
        return Currency.TRY
    return Currency.EUR


def convert_eur_price(
    price_eur: Decimal,
    currency: Currency,
    eur_try_rate: Decimal | None,
    try_rounding_step: Decimal = DEFAULT_TRY_ROUNDING_STEP,
) -> Decimal:
    """EUR fiyatı müşteri para birimine çevirir."""
    if currency is Currency.EUR:
        return price_eur
    if eur_try_rate is None or eur_try_rate <= 0:
        raise ValueError("TRY fiyatı için geçerli EUR/TRY kuru gerekli")
    return round_up_to_step(price_eur * eur_try_rate, try_rounding_step)
