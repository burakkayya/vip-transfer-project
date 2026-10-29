"""Türkiye takvimi. Belge geçerlilik tarihleri ve "bugün" Türkiye saatine göre hesaplanır
(UTC'de gece 21:00-24:00 arası Türkiye'de ertesi gündür)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Europe/Istanbul")


def local_date(now: datetime) -> date:
    return now.astimezone(LOCAL_TZ).date()
