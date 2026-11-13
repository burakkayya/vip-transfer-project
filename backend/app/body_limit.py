"""API-07: belge yükleme ucunun gövde üst sınırı, gövde okunurken uygulanır.

Starlette multipart gövdeyi uç fonksiyonu çalışmadan önce geçici dosyaya yazar; uçtaki `file.read(MAX+1)`
kontrolü diske yazılmasını engellemez. Bu ASGI katmanı `Content-Length` sınırı aşıyorsa gövdeyi hiç
okumadan, başlık yoksa (chunked) okunan bayt sınırı geçtiği anda isteği keser ve 413 döner.
"""

from __future__ import annotations

import json

from app.config import get_settings

UPLOAD_PATHS = frozenset({"/api/v1/driver/documents"})
_BODY = json.dumps(
    {"error": {"code": "payload_too_large", "message": "dosya en fazla 10 MB olabilir"}}
).encode()


class _TooLarge(Exception):
    pass


class UploadBodyLimit:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") not in UPLOAD_PATHS:
            await self.app(scope, receive, send)
            return
        limit = get_settings().document_upload_max_body_bytes
        for name, value in scope.get("headers") or []:
            if name == b"content-length":
                try:
                    too_big = int(value) > limit
                except ValueError:
                    too_big = True
                if too_big:
                    await _reject(send)
                    return

        received = 0
        exceeded = False
        replied = False

        async def limited_receive():
            nonlocal received, exceeded
            if exceeded:
                raise _TooLarge
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _TooLarge
            return message

        async def guarded_send(message):
            # Sınır aşıldıysa alt katmanın ürettiği yanıt (ör. FastAPI'nin "gövde ayrıştırılamadı" 400'ü)
            # yerine tek tip 413 gider.
            nonlocal replied
            if exceeded:
                if not replied:
                    replied = True
                    await _reject(send)
                return
            replied = replied or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _TooLarge:
            pass
        if exceeded and not replied:
            await _reject(send)


async def _reject(send) -> None:
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(_BODY)).encode()),
                    (b"connection", b"close")],
    })
    await send({"type": "http.response.body", "body": _BODY})
