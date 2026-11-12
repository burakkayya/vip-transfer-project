"""Sohbet çevirisi (K-62). Sağlayıcı Google Cloud Translation (Basic v2); dışarıya yalnızca mesaj metni gider.

Anahtar yoksa (`translation_provider=off`) çeviri kapalıdır: mesajlar olduğu gibi iletilir, akış etkilenmez.
Çeviri hatası mesajı engellemez; çevrilmemiş metin gider.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol

import httpx

from app.config import get_settings
from app.errors import ServiceUnavailable


@dataclass(frozen=True)
class Translation:
    text: str
    source_lang: str | None  # algılanan kaynak dil (ör. "de")


class Translator(Protocol):
    def translate(self, text: str, target: str) -> Translation: ...


@dataclass
class GoogleTranslate:
    api_key: str
    url: str = "https://translation.googleapis.com/language/translate/v2"

    def translate(self, text: str, target: str) -> Translation:
        try:
            # Anahtar adres satırında değil başlıkta: hata metinlerine ve vekil kayıtlarına düşmez.
            resp = httpx.post(self.url, headers={"X-Goog-Api-Key": self.api_key},
                              json={"q": text, "target": target, "format": "text"}, timeout=4)
            resp.raise_for_status()
            item = resp.json()["data"]["translations"][0]
            return Translation(text=html.unescape(str(item["translatedText"])),
                               source_lang=(item.get("detectedSourceLanguage") or None))
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise ServiceUnavailable("çeviri alınamadı") from exc


@dataclass
class FakeTranslator:
    """Yalnızca otomatik testler: metni "[hedef] metin" olarak döner. "tr:" ile başlayan metin Türkçe sayılır."""

    calls: list[tuple[str, str]] = field(default_factory=list)
    fail: bool = False

    def translate(self, text: str, target: str) -> Translation:
        self.calls.append((text, target))
        if self.fail:
            raise ServiceUnavailable("çeviri alınamadı")
        source = text.split(":", 1)[0] if ":" in text[:4] else "xx"
        return Translation(text=f"[{target}] {text}", source_lang=source)


@lru_cache
def get_translator() -> Translator | None:
    s = get_settings()
    if s.translation_provider == "google":
        if not s.translation_api_key:
            raise RuntimeError("GETAWAY_TRANSLATION_API_KEY tanımlı değil")
        return GoogleTranslate(s.translation_api_key)
    if s.translation_provider == "fake":
        return FakeTranslator()
    return None
