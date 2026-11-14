"""Sürücü araçları uçları (K-63): "yolcu gelmedi", çıkış önerisi, günlük plan."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import CurrentDriver, DbSession, Now
from app.api.driver import TripOut, _trip_out
from app.api.schemas import MoneyStr
from app.api.trips import JobOut, _job_out
from app.errors import NotFound
from app.localtime import local_date
from app.models import BookingLeg
from app.models.enums import LegStatus
from app.providers.routing import Point
from app.services import driver_tools, live_location

router = APIRouter(prefix="/driver", tags=["driver"])


def _own_leg(db, driver, leg_id: uuid.UUID, *, lock: bool = False) -> BookingLeg:
    leg = db.get(BookingLeg, leg_id, with_for_update={"of": BookingLeg} if lock else None)
    if leg is None or leg.driver_id != driver.id:
        raise NotFound("yolculuk bulunamadı")
    return leg


class PointIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


@router.post("/trips/{leg_id}/no-show", response_model=TripOut)
def no_show(leg_id: uuid.UUID, body: PointIn, driver: CurrentDriver, db: DbSession, now: Now):
    """Ücretsiz bekleme dolduysa ve sürücü alış noktasındaysa yolcu gelmedi kaydı (konum ve zamanla)."""
    leg = _own_leg(db, driver, leg_id, lock=True)
    driver_tools.mark_no_show(db, driver, leg, Point(Decimal(str(body.lat)), Decimal(str(body.lng))), now)
    db.commit()
    live_location.clear(leg)
    return _trip_out(leg, with_route=True)


class DepartureOut(BaseModel):
    target_at: datetime
    drive_minutes: int
    leave_at: datetime
    based_on_flight: bool


@router.get("/trips/{leg_id}/departure", response_model=DepartureOut)
def departure(leg_id: uuid.UUID, driver: CurrentDriver, db: DbSession,
              lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    leg = _own_leg(db, driver, leg_id)
    d = driver_tools.departure(leg, Point(Decimal(str(lat)), Decimal(str(lng))))
    return DepartureOut(**d.__dict__)


class PlanOut(BaseModel):
    day: date
    trips: list[TripOut]
    earnings: dict[str, MoneyStr]
    earnings_try: MoneyStr | None
    return_jobs: list[JobOut]


@router.get("/plan", response_model=PlanOut)
def plan(driver: CurrentDriver, db: DbSession, now: Now, day: date | None = None):
    """Seçilen günün planı (varsayılan yarın): işler, tahmini kazanç, dönüş işi önerileri."""
    today = local_date(now)
    day = day or today + timedelta(days=1)
    if not today - timedelta(days=1) <= day <= today + timedelta(days=14):
        day = today + timedelta(days=1)
    legs = driver_tools.day_legs(db, driver, day)
    by_currency, total_try = driver_tools.earnings(db, legs, now)
    upcoming = [leg for leg in legs if leg.status is not LegStatus.COMPLETED]
    suggestions = driver_tools.return_suggestions(db, driver, upcoming, now)
    return PlanOut(
        day=day,
        trips=[_trip_out(leg) for leg in legs],
        earnings=by_currency,
        earnings_try=total_try,
        return_jobs=[_job_out(db, job, driver, at=None, detail=False, now=now) for job in suggestions],
    )
