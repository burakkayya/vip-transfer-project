from fastapi import APIRouter

from app.api.admin import catalog, finance, fleet, manual_bookings, operations, people, trip_review

router = APIRouter(prefix="/admin")
for module in (operations, manual_bookings, trip_review, fleet, catalog, finance, people):
    router.include_router(module.router)
