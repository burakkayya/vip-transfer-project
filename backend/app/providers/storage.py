"""Belge depolama. Dosyalar şifrelenerek yazılır (yasal_ve_guvenlik.md).

MVP'de yerel disk; üretimde Türkiye'deki S3 uyumlu depolamaya geçilecek
(teknoloji.md). Arayüz aynı kalır.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import get_settings
from app.security.crypto import decrypt_bytes, encrypt_bytes


class Storage(Protocol):
    def put(self, prefix: str, data: bytes) -> str: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


@dataclass
class LocalEncryptedStorage:
    root: Path

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError("geçersiz depolama anahtarı")
        return path

    def put(self, prefix: str, data: bytes) -> str:
        key = f"{prefix}/{secrets.token_hex(16)}"
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encrypt_bytes(data))
        return key

    def get(self, key: str) -> bytes:
        return decrypt_bytes(self._path(key).read_bytes())

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


@lru_cache
def get_storage() -> Storage:
    return LocalEncryptedStorage(Path(get_settings().storage_dir))
