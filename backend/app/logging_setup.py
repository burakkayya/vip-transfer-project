"""K-83: yapılandırılmış log.

`json` biçiminde (üretim) her satır tek bir JSON nesnesidir ve istek bağlamını (request_id, yol şablonu, aktör)
taşır. İleti metinleri zaten kişisel veri içermeyecek biçimde yazılır (PRIV-02); burada ek olarak sorgu dizesi
ve gerçek yol hiç yazılmaz, yalnızca yol şablonu.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app import request_context

_CONTEXT_FIELDS = ("request_id", "method", "route", "platform", "app", "app_version", "actor_type", "actor_id")


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        ctx = request_context.current()
        for name in _CONTEXT_FIELDS:
            if not hasattr(record, name):
                setattr(record, name, getattr(ctx, name))
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for name in _CONTEXT_FIELDS + ("status", "duration_ms"):
            value = getattr(record, name, None)
            if value is not None:
                out[name] = value
        if record.exc_info:
            # Yığın izi yerel değişken içermez ama istisna iletisi kişisel veri taşıyabilir: yalnızca tip.
            out["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(out, ensure_ascii=False)


_configured = False


def configure(log_format: str) -> None:
    global _configured
    if _configured:
        return
    _configured = True
    root = logging.getLogger()
    if log_format == "json":
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        handler.addFilter(ContextFilter())
        root.handlers = [handler]
        root.setLevel(logging.INFO)
        # Uvicorn'un erişim logu gerçek yolu ve sorgu dizesini yazar; yerini `app.access` alır.
        logging.getLogger("uvicorn.access").disabled = True
        for name in ("uvicorn", "uvicorn.error"):
            logging.getLogger(name).handlers = []
            logging.getLogger(name).propagate = True
    else:
        for handler in root.handlers:
            handler.addFilter(ContextFilter())
