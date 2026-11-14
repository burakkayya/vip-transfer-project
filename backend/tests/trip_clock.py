"""Yolculuk zaman kuralları (BIZ-02, F1-8) için test yardımcıları.

Akış testlerinin çoğu (bildirim, sohbet, hakediş) 72 saat sonraki bir işi hemen yürütür; zaman kuralları
bu testlerin konusu değildir. `relaxed_trip_clock` fikstürü bu testlerde zaman ve hız kurallarını gevşetir.
Kuralların kendisi `test_dispatch_ws_phase1.py`'de sınanır.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


@pytest.fixture
def relaxed_trip_clock(monkeypatch):
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "trip_depart_window_minutes", 10**6)
    monkeypatch.setattr(s, "trip_start_early_minutes", 10**6)
    monkeypatch.setattr(s, "trip_min_duration_ratio", 0.0)
    monkeypatch.setattr(s, "trip_max_speed_kmh", 10**6)


def make_due(db, leg_id, minutes_from_now: float = 0) -> None:
    """Bacağın alış zamanını şimdiye (veya verilen dakika sonrasına) çeker."""
    from app.models import BookingLeg

    leg = db.get(BookingLeg, uuid.UUID(str(leg_id)))
    leg.pickup_at = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    db.commit()


def backdate_start(db, leg_id, minutes: float) -> None:
    """"Başladı" olayını verilen dakika kadar geriye alır (yolculuk o kadar süredir sürüyormuş gibi)."""
    from app.models import TripEvent
    from app.models.enums import TripEventType

    db.expire_all()
    ev = db.scalar(select(TripEvent).where(TripEvent.booking_leg_id == uuid.UUID(str(leg_id)),
                                           TripEvent.event_type == TripEventType.STARTED))
    ev.occurred_at = ev.occurred_at - timedelta(minutes=minutes)
    db.commit()
