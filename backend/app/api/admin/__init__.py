from fastapi import APIRouter

from app.api.admin import (
    catalog,
    finance,
    fleet,
    manual_bookings,
    operations,
    people,
    popular_places,
    trip_review,
)

router = APIRouter(prefix="/admin")
for module in (operations, manual_bookings, trip_review, fleet, catalog, popular_places, finance, people):
    router.include_router(module.router)
