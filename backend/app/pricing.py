"""Fiyatlandırma çekirdeği.

Formül (fiyatlandirma.md, K-03 / K-04):

    ham_fiyat  = mesafe_km x birim_fiyat x araç_tipi_çarpanı
    ham_fiyat  = max(ham_fiyat, minimum_ücret)
    indirimli  = ham_fiyat - gidiş_dönüş_indirimi (varsa)
    fiyat      = rounding_step'in katına yukarı yuvarlama(indirimli)

Tüm parasal hesaplar Decimal ile yapılır; float kullanılmaz.
Bu modül saf fonksiyonlardan oluşur (I/O yok) ki test edilebilir olsun.
Parametreler `pricing_rules` ve `round_trip_discounts` tablolarından
gelecek şekilde tasarlandı; burada varsayılan değerler verilmiştir.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal
from enum import Enum

MONEY_QUANT = Decimal("0.01")


class DiscountType(str, Enum):
    PERCENT = "yuzde"
    FIXED = "sabit"


@dataclass(frozen=True)
class PricingRule:
    """Bir araç tipi için fiyat parametreleri."""

    base_price_per_km: Decimal = Decimal("1.10")
    minimum_price: Decimal = Decimal("30")
    rounding_step: Decimal = Decimal("5")
    vehicle_multiplier: Decimal = Decimal("1.00")


@dataclass(frozen=True)
class RoundTripDiscount:
    discount_type: DiscountType
    value: Decimal


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANT)


def raw_price(distance_km: Decimal, rule: PricingRule) -> Decimal:
    """Minimum kontrolü öncesi ham fiyat."""
    if distance_km < 0:
        raise ValueError("distance_km negatif olamaz")
    return _money(distance_km * rule.base_price_per_km * rule.vehicle_multiplier)


def apply_minimum(price: Decimal, rule: PricingRule) -> Decimal:
    return max(price, rule.minimum_price)


def apply_round_trip_discount(
    price: Decimal, discount: RoundTripDiscount | None
) -> Decimal:
    """Gidiş-dönüş indirimini uygular. Sonuç negatif olamaz."""
    if discount is None:
        return price
    if discount.discount_type is DiscountType.PERCENT:
        if not Decimal("0") <= discount.value <= Decimal("100"):
            raise ValueError("yüzde indirimi 0-100 arasında olmalı")
        reduction = price * discount.value / Decimal("100")
    elif discount.discount_type is DiscountType.FIXED:
        if discount.value < 0:
            raise ValueError("sabit indirim negatif olamaz")
        reduction = discount.value
    else:  # pragma: no cover - enum tamamlandı
        raise ValueError(f"bilinmeyen indirim tipi: {discount.discount_type}")
    return max(_money(price - reduction), Decimal("0"))


def round_up_to_step(price: Decimal, step: Decimal) -> Decimal:
    """Fiyatı `step`'in katına yukarı yuvarlar (örn. 167,30 -> 170)."""
    if step <= 0:
        raise ValueError("rounding_step pozitif olmalı")
    multiples = (price / step).to_integral_value(rounding=ROUND_CEILING)
    return _money(multiples * step)


def quote_price(
    distance_km: Decimal,
    rule: PricingRule,
    discount: RoundTripDiscount | None = None,
) -> Decimal:
    """Müşteriye gösterilecek nihai fiyatı hesaplar."""
    price = raw_price(distance_km, rule)
    price = apply_minimum(price, rule)
    price = apply_round_trip_discount(price, discount)
    return round_up_to_step(price, rule.rounding_step)


@dataclass(frozen=True)
class LegQuote:
    total: Decimal
    leg_prices: tuple[Decimal, ...]


def quote_legs(
    distances_km: list[Decimal],
    rule: PricingRule,
    discount: RoundTripDiscount | None = None,
) -> LegQuote:
    """Tek yön (1 bacak) veya gidiş-dönüş (2 bacak) fiyatı.

    Her bacağa minimum ücret ayrı uygulanır, gidiş-dönüş indirimi toplam üzerinden
    düşülür, sonuç yuvarlanır. Toplam, sürücü hakedişi için bacaklara ham
    fiyatları oranında dağıtılır; kuruş farkı son bacağa yazılır.
    """
    if not 1 <= len(distances_km) <= 2:
        raise ValueError("bir veya iki bacak desteklenir")
    if len(distances_km) == 1 and discount is not None:
        raise ValueError("tek yönde gidiş-dönüş indirimi uygulanamaz")
    raws = [apply_minimum(raw_price(d, rule), rule) for d in distances_km]
    raw_total = sum(raws, Decimal("0"))
    total = round_up_to_step(apply_round_trip_discount(raw_total, discount), rule.rounding_step)
    leg_prices = [_money(total * r / raw_total) for r in raws[:-1]]
    leg_prices.append(total - sum(leg_prices, Decimal("0")))
    return LegQuote(total=total, leg_prices=tuple(leg_prices))
