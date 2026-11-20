"""Alan hataları. API katmanı bunları {"error": {"code", "message"}} biçiminde döner."""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, code: str | None = None, details: Any = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details


class NotFound(DomainError):
    status_code = 404
    code = "not_found"


class Conflict(DomainError):
    status_code = 409
    code = "conflict"


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"


class Unauthorized(DomainError):
    status_code = 401
    code = "unauthorized"


class TooManyRequests(DomainError):
    status_code = 429
    code = "too_many_requests"

    def __init__(self, message: str, *, code: str | None = None, details: Any = None,
                 retry_after: int | None = None):
        # retry_after: tekrar denemeden önce beklenecek saniye; yanıtta `Retry-After` başlığı ve
        # `error.retry_after` alanı olarak döner (istemci kalan süreyi gösterir).
        super().__init__(message, code=code, details=details)
        self.retry_after = max(1, int(retry_after)) if retry_after is not None else None


class ServiceUnavailable(DomainError):
    status_code = 503
    code = "service_unavailable"
