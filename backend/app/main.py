"""FastAPI uygulaması: `uvicorn app.main:app --reload`"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api import admin, auth, client_errors, customer, driver, driver_tools, meeting, payments, public, trips
from app import logging_setup, readiness, request_context
from app.body_limit import UploadBodyLimit
from app.config import DEV_ENVS, get_settings
from app.errors import DomainError
from app.services import incidents

log = logging.getLogger(__name__)
access_log = logging.getLogger("app.access")


def _route_template(request: Request) -> str | None:
    """Yol şablonu (/api/v1/bookings/{code}); gerçek yol rezervasyon kodu ya da jeton taşıyabilir."""
    route = request.scope.get("route")
    template = getattr(route, "path_format", None) or getattr(route, "path", None)
    if not template:
        return None
    # FastAPI, include_router önekini rota nesnesine yazmayabilir: önek gerçek yoldan türetilir.
    params = request.scope.get("path_params") or {}
    concrete = template
    for name, value in params.items():
        concrete = concrete.replace("{" + name + "}", str(value))
    path = request.url.path
    if path.endswith(concrete):
        return path[: len(path) - len(concrete)] + template
    return template


def create_app() -> FastAPI:
    s = get_settings()
    logging_setup.configure(s.log_format)
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
    async def _request_context(request: Request, call_next):
        """K-83: istek kimliği, platform ve aktör bağlamı; erişim logu (yol şablonu, sorgu dizesi yok);
        yakalanmamış hata olay olarak kaydedilir ve istemciye hata kodu (request_id) döner."""
        ctx = request_context.RequestContext(
            request_id=request_context.clean_request_id(request.headers.get("x-request-id")),
            method=request.method,
            platform=request_context.clean_platform(request.headers.get("x-client-platform")),
            app=request_context.clean_app(request.headers.get("x-client-app")),
            app_version=request_context.clean_version(request.headers.get("x-client-version")),
        )
        token = request_context.set_context(ctx)
        started = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:  # noqa: BLE001 - yakalanmamış her hata 500 ve olay
                ctx.route = _route_template(request)
                await run_in_threadpool(incidents.report_exception, exc, context={"status": 500})
                response = JSONResponse(status_code=500, content={"error": {
                    "code": "internal_error", "message": "beklenmeyen bir hata oluştu",
                    "request_id": ctx.request_id}})
            ctx.route = _route_template(request)
            response.headers["X-Request-ID"] = ctx.request_id
            access_log.info(
                "%s %s %s", request.method, ctx.route or "-", response.status_code,
                extra={"status": response.status_code,
                       "duration_ms": round((time.perf_counter() - started) * 1000, 1)},
            )
            return response
        finally:
            request_context.reset(token)

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if "frame-ancestors" not in response.headers.get("content-security-policy", ""):
            response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    # CORS en dışta: ara katmanların ürettiği yanıtlar (ör. 500 ve request_id) da CORS başlığı taşır.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        # K-83: istemci bilgisi ve istek kimliği (mobil web önizlemesi tarayıcıdan doğrudan çağırır).
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Client-Platform", "X-Client-App",
                       "X-Client-Version"],
        expose_headers=["X-Request-ID"],
    )

    @app.get("/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    @app.get("/ready", include_in_schema=False)
    def ready(request: Request):
        # MON-15 (K-81): yalnızca iç ağdan; dışarıya yolun varlığı bile gösterilmez.
        if not readiness.is_internal_request(request):
            return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "bulunamadı"}})
        checks = readiness.check()
        ok = all(checks.values())
        return JSONResponse(status_code=200 if ok else 503,
                            content={"status": "ready" if ok else "not_ready", "checks": checks})

    api = "/api/v1"
    for module in (public, auth, customer, payments, driver, client_errors):
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
