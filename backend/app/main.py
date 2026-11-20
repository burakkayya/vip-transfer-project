"""FastAPI uygulaması: `uvicorn app.main:app --reload`"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api import admin, auth, customer, driver, driver_tools, meeting, payments, public, trips
from app.body_limit import UploadBodyLimit
from app.config import DEV_ENVS, get_settings
from app.errors import DomainError

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    s = get_settings()
    dev_tools = s.env in DEV_ENVS  # izin listesi: yeni bir ortam eklenirse varsayılan olarak kapalı kalır
    app = FastAPI(
        title="getawaytransfers.com API",
        version="0.1.0",
        docs_url="/docs" if dev_tools else None,
        redoc_url=None,
        openapi_url="/openapi.json" if dev_tools else None,
    )
    # API-07: yükleme gövdesi sınırı akış sırasında (en içteki middleware; güvenlik başlıkları 413'e de eklenir).
    app.add_middleware(UploadBodyLimit)
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
        headers = None
        retry_after = getattr(exc, "retry_after", None)
        if retry_after is not None:
            body["error"]["retry_after"] = retry_after
            headers = {"Retry-After": str(retry_after)}
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)

    @app.exception_handler(OperationalError)
    async def _db_operational_error(request: Request, exc: OperationalError):
        # BIZ-08: eşzamanlı işlemlerde kilitlenme (40P01) ya da serileştirme hatası (40001) kullanıcıya 500
        # değil, yeniden denenebilir 409 olarak döner. Diğer veritabanı hataları olduğu gibi yükselir.
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        if sqlstate in ("40P01", "40001"):
            log.warning("veritabanı eşzamanlılık çakışması (%s): %s %s", sqlstate, request.method, request.url.path)
            return JSONResponse(status_code=409, content={"error": {
                "code": "concurrent_update", "message": "işlem aynı anda başka bir işlemle çakıştı, tekrar deneyin"}})
        raise exc

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
    if dev_tools:
        # Sahte ödeme uçları (INF-01) yalnızca dev/test'te kayıtlıdır.
        app.include_router(payments.fake_router, prefix=api)
    app.include_router(trips.driver_router, prefix=api)
    app.include_router(driver_tools.router, prefix=api)
    app.include_router(trips.customer_router, prefix=api)
    app.include_router(customer.ws_router, prefix=api)
    app.include_router(meeting.customer_router, prefix=api)
    app.include_router(meeting.public_router, prefix=api)
    app.include_router(admin.router, prefix=api)
    return app


app = create_app()
