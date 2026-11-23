from fastapi import APIRouter

from app.api.admin import (
    catalog,
    finance,
    fleet,
    incidents,
    manual_bookings,
    meeting_guides,
    operations,
    people,
    popular_places,
    trip_review,
)

router = APIRouter(prefix="/admin")
for module in (operations, manual_bookings, meeting_guides, trip_review, fleet, catalog, popular_places, finance, people,
               incidents):
    router.include_router(module.router)
