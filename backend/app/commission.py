"""Komisyon ve sürücü payı (K-02, is_modeli.md).

Örnek: 60 € fiyat, %20 komisyon -> 12 € komisyon, 48 € sürücü payı (K-75). Bahşiş de aynı oranla bölünür.
Kural önceliği: araç tipi > bölge > genel (en özel kural kazanır).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.models.enums import CommissionScope

MONEY_QUANT = Decimal("0.01")

_PRIORITY = {
    CommissionScope.VEHICLE_TYPE: 0,
    CommissionScope.REGION: 1,
    CommissionScope.GENERAL: 2,
}


@dataclass(frozen=True)
class CommissionCandidate:
    rule_id: int
    scope: CommissionScope
    scope_ref_id: int | None
    rate: Decimal


@dataclass(frozen=True)
class Split:
    gross: Decimal
    commission: Decimal
    net: Decimal


def select_rule(
    candidates: list[CommissionCandidate],
    vehicle_type_id: int,
    region_id: int,
) -> CommissionCandidate:
    matching = [
        c
        for c in candidates
        if c.scope is CommissionScope.GENERAL
        or (c.scope is CommissionScope.VEHICLE_TYPE and c.scope_ref_id == vehicle_type_id)
        or (c.scope is CommissionScope.REGION and c.scope_ref_id == region_id)
    ]
    if not matching:
        raise LookupError("geçerli komisyon kuralı yok")
    # Aynı kapsamda birden fazla kural varsa en yenisi (en büyük id) kazanır.
    return min(matching, key=lambda c: (_PRIORITY[c.scope], -c.rule_id))


def split(gross: Decimal, rate: Decimal) -> Split:
    if not Decimal("0") <= rate < Decimal("1"):
        raise ValueError("komisyon oranı 0 ile 1 arasında olmalı")
    commission = (gross * rate).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    return Split(gross=gross, commission=commission, net=gross - commission)


def earning_base(leg_price: Decimal, total: Decimal, system_total: Decimal | None, guarantee_fee: Decimal) -> Decimal:
    """BIZ-04 (K-81): admin fiyatı sistem fiyatının üstüne ezdiyse sürücü hakedişi sistem fiyatındaki
    paydan hesaplanır (min(sistem, ezilen)). Aşağı ezmede bacak fiyatı zaten düşüktür. Garanti ücreti
    ezmede değişmediği için oran garanti ücreti hariç fiyatlar üzerinden kurulur."""
    if system_total is None or total <= system_total:
        return leg_price
    price = total - guarantee_fee
    system_price = system_total - guarantee_fee
    if price <= 0 or system_price <= 0:
        return leg_price
    return (leg_price * system_price / price).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def leg_split(leg) -> Split:
    """Bacağın sürücü hakedişi (komisyon sonrası). `leg.booking` yüklü olmalı."""
    b = leg.booking
    base = earning_base(leg.leg_price, b.total_amount, b.system_total_amount, b.guarantee_fee)
    return split(base, b.commission_rate)
