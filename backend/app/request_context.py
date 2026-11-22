"""K-83: istek bağlamı (istek kimliği, platform, uygulama sürümü, aktör).

Bağlam `contextvars` ile tutulur: aynı istek içinde log satırları, olay kayıtları ve yolculuk geçmişi aynı
`request_id`'yi paylaşır. İstemciden gelen değerler yalnızca izin listesi ve biçim denetiminden geçerse kullanılır.
"""

from __future__ import annotations

import re
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field

# Gelen kimlik: BFF/istemci üretimi UUID ya da kısa harf-rakam dizisi. Başka her şey yok sayılır (log enjeksiyonu).
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_VERSION_RE = re.compile(r"^[0-9A-Za-z.+-]{1,30}$")
PLATFORMS = frozenset({"web", "admin", "ios", "android"})
APPS = frozenset({"customer", "driver", "admin", "web"})


@dataclass
class RequestContext:
    """Değiştirilebilir: FastAPI eşzamanlı bağımlılıkları iş parçacığında bağlamın kopyasıyla çalıştırır; nesne
    paylaşıldığı için bağımlılıkta eklenen aktör ara katmanda ve hata işleyicide de görünür."""

    request_id: str | None = None
    method: str | None = None
    route: str | None = None  # yol şablonu (/bookings/{code}); gerçek yol kişisel kod taşıyabilir
    platform: str | None = None
    app: str | None = None
    app_version: str | None = None
    actor_type: str | None = None  # customer | driver | staff
    actor_id: str | None = None
    extra: dict = field(default_factory=dict)


_current: ContextVar[RequestContext | None] = ContextVar("getaway_request_context", default=None)


def current() -> RequestContext:
    """İstek dışında (zamanlanmış iş, test) boş bir bağlam döner; paylaşılan varsayılan nesne değiştirilmez."""
    return _current.get() or RequestContext()


def set_context(ctx: RequestContext):
    return _current.set(ctx)


def reset(token) -> None:
    _current.reset(token)


def update(**changes) -> None:
    ctx = _current.get()
    if ctx is None:
        return
    for key, value in changes.items():
        setattr(ctx, key, value)


def clean_request_id(value: str | None) -> str:
    if value and _REQUEST_ID_RE.match(value):
        return value
    return uuid.uuid4().hex


def clean_platform(value: str | None) -> str | None:
    value = (value or "").strip().lower()
    return value if value in PLATFORMS else None


def clean_app(value: str | None) -> str | None:
    value = (value or "").strip().lower()
    return value if value in APPS else None


def clean_version(value: str | None) -> str | None:
    value = (value or "").strip()
    return value if _VERSION_RE.match(value) else None
