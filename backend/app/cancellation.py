"""İptal ve iade hesabı (K-14, fiyatlandirma.md).

    48 saat ve üzeri  -> %100
    24-48 saat arası  -> %50
    24 saatten az     -> %0

Garanti seçildiyse politika devre dışı kalır ve yolculuk ücretinin tamamı iade
edilir; garanti ücreti hiçbir durumda iade edilmez.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_DOWN, Decimal

MONEY_QUANT = Decimal("0.01")


@dataclass(frozen=True)
class Tier:
    hours_before_pickup: int
    refund_percent: int


DEFAULT_TIERS: tuple[Tier, ...] = (Tier(48, 100), Tier(24, 50), Tier(0, 0))


@dataclass(frozen=True)
class RefundQuote:
    hours_left: Decimal
    refund_percent: int
    refund_amount: Decimal
    guarantee_applied: bool


def refund_percent(hours_left: Decimal, tiers: tuple[Tier, ...] | list[Tier]) -> int:
    """Kalan saate uyan en yüksek eşikli kademenin oranı. Hiçbiri uymazsa 0."""
    for tier in sorted(tiers, key=lambda t: t.hours_before_pickup, reverse=True):
        if hours_left >= tier.hours_before_pickup:
            return tier.refund_percent
    return 0


def quote_refund(
    trip_price: Decimal,
    pickup_at: datetime,
    now: datetime,
    tiers: tuple[Tier, ...] | list[Tier],
    has_guarantee: bool = False,
) -> RefundQuote:
    if pickup_at.tzinfo is None or now.tzinfo is None:
        raise ValueError("zaman bilgisi saat dilimli olmalı")
    seconds = Decimal((pickup_at - now).total_seconds())
    hours_left = seconds / Decimal(3600)
    if has_guarantee and hours_left > 0:
        percent = 100
    elif hours_left <= 0:
        percent = 0  # yolculuk saati geçtiyse iade yok
    else:
        percent = refund_percent(hours_left, tiers)
    # Şirket aleyhine kuruş farkı oluşmasın diye aşağı yuvarlanır.
    amount = (trip_price * percent / Decimal(100)).quantize(MONEY_QUANT, rounding=ROUND_DOWN)
    return RefundQuote(
        hours_left=hours_left.quantize(MONEY_QUANT),
        refund_percent=percent,
        refund_amount=amount,
        guarantee_applied=has_guarantee and hours_left > 0,
    )
