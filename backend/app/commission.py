"""Komisyon ve sürücü payı (K-02, is_modeli.md).

Örnek: 60 € fiyat, %25 komisyon -> 15 € komisyon, 45 € sürücü payı.
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
