"""SMS gönderimi (Netgsm veya Verimor, teknoloji.md)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    def send(self, phone: str, text: str) -> None: ...


@dataclass
class ConsoleSms:
    """Geliştirme ve test: mesajı loglar ve bellekte tutar (testler kodu buradan okur)."""

    outbox: list[tuple[str, str]] = field(default_factory=list)

    def send(self, phone: str, text: str) -> None:
        self.outbox.append((phone, text))
        log.warning("SMS (console) -> %s: %s", phone, text)


@dataclass
class NetgsmSms:
    """Netgsm HTTP GET API. Canlıya almadan önce güncel API belgesiyle doğrulanmalı,
    uluslararası numaralara gönderim yetkisi hesapta açık olmalı (acik_konular.md)."""

    usercode: str
    password: str
    header: str
    url: str = "https://api.netgsm.com.tr/sms/send/get"

    def send(self, phone: str, text: str) -> None:
        params = {
            "usercode": self.usercode,
            "password": self.password,
            "gsmno": phone.lstrip("+"),
            "message": text,
            "msgheader": self.header,
            "dil": "TR",
        }
        try:
            resp = httpx.get(self.url, params=params, timeout=10)
        except httpx.HTTPError as exc:
            raise ServiceUnavailable("SMS gönderilemedi") from exc
        # Başarılı yanıt "00 <bulkid>" ile başlar.
        if not resp.text.startswith("00"):
            log.error("Netgsm hata kodu: %s", resp.text[:20])
            raise ServiceUnavailable("SMS gönderilemedi")


@lru_cache
def get_sms_sender() -> SmsSender:
    s = get_settings()
    if s.sms_provider == "netgsm":
        return NetgsmSms(s.netgsm_usercode, s.netgsm_password, s.netgsm_header)
    if s.sms_provider == "console":
        return ConsoleSms()
    raise RuntimeError(f"desteklenmeyen SMS sağlayıcısı: {s.sms_provider}")
