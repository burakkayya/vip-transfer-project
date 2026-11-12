"""FastAPI uygulaması: `uvicorn app.main:app --reload`"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, auth, customer, driver, driver_tools, meeting, payments, public, trips
from app.config import get_settings
from app.errors import DomainError

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="getawaytransfers.com API",
        version="0.1.0",
        docs_url=None if s.env == "prod" else "/docs",
        redoc_url=None,
        openapi_url=None if s.env == "prod" else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(DomainError)
    async def _domain_error(request: Request, exc: DomainError):
        body = {"error": {"code": exc.code, "message": exc.message}}
        if exc.details is not None:
            body["error"]["details"] = exc.details
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": "geçersiz istek", "details": details}},
        )

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if "frame-ancestors" not in response.headers.get("content-security-policy", ""):
            response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.get("/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    api = "/api/v1"
    for module in (public, auth, customer, payments, driver):
        app.include_router(module.router, prefix=api)
    app.include_router(trips.driver_router, prefix=api)
    app.include_router(driver_tools.router, prefix=api)
    app.include_router(trips.customer_router, prefix=api)
    app.include_router(customer.ws_router, prefix=api)
    app.include_router(meeting.customer_router, prefix=api)
    app.include_router(meeting.public_router, prefix=api)
    app.include_router(admin.router, prefix=api)
    return app


app = create_app()
