from fastapi import APIRouter

from app.api.admin import catalog, finance, fleet, operations, people

router = APIRouter(prefix="/admin")
for module in (operations, fleet, catalog, finance, people):
    router.include_router(module.router)
