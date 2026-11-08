from fastapi import APIRouter

from app.api.admin import catalog, finance, fleet, manual_bookings, operations, people

router = APIRouter(prefix="/admin")
for module in (operations, manual_bookings, fleet, catalog, finance, people):
    router.include_router(module.router)
