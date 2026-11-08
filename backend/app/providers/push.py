"""Mobil bildirim. FCM'e yalnızca cihaz jetonu ve bildirim metni gider (yasal_ve_guvenlik.md).

- `console` (geliştirme, test): gönderilenleri bellekte tutar ve loglar.
- `fcm`: Firebase Cloud Messaging HTTP v1. Servis hesabı JSON dosyası repo dışında durur, yolu
  `GETAWAY_FCM_CREDENTIALS_FILE` ile verilir. Erişim jetonu servis hesabının özel anahtarıyla imzalanan
  JWT ile alınır (ek kütüphane yok) ve süresi dolana kadar önbellekte tutulur.

Cihaz jetonu artık geçerli değilse (uygulama kaldırıldı, jeton yenilendi) `PushTokenInvalid` fırlatılır;
çağıran jetonu siler.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import httpx
import jwt

from app.config import get_settings

log = logging.getLogger(__name__)

# Android'de bildirimler bu kanaldan gösterilir (mobile/lib/notify.ts TRIP_CHANNEL).
ANDROID_CHANNEL = "trip"
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
TOKEN_URL = "https://oauth2.googleapis.com/token"
TIMEOUT = httpx.Timeout(5.0, connect=3.0)


class PushTokenInvalid(Exception):
    """Cihaz jetonu FCM'de kayıtlı değil; bir daha kullanılmamalı."""


class PushSender(Protocol):
    def send(self, token: str, title: str, body: str, data: dict[str, str]) -> None: ...


@dataclass
class ConsolePush:
    outbox: list[tuple[str, str, str, dict]] = field(default_factory=list)

    def send(self, token: str, title: str, body: str, data: dict[str, str]) -> None:
        self.outbox.append((token, title, body, data))
        log.warning("PUSH (console) -> %s…: %s | %s", token[:8], title, body)


class FcmPush:
    def __init__(self, credentials_file: str) -> None:
        info = json.loads(Path(credentials_file).read_text(encoding="utf-8"))
        if info.get("type") != "service_account":
            raise ValueError("FCM kimlik dosyası bir servis hesabı anahtarı değil")
        self._project = info["project_id"]
        self._email = info["client_email"]
        self._key = info["private_key"]
        self._key_id = info.get("private_key_id")
        self._token_uri = info.get("token_uri") or TOKEN_URL
        self._access: tuple[str, float] | None = None
        self._lock = threading.Lock()

    @property
    def url(self) -> str:
        return f"https://fcm.googleapis.com/v1/projects/{self._project}/messages:send"

    def _access_token(self) -> str:
        with self._lock:
            if self._access and self._access[1] > time.time() + 60:
                return self._access[0]
            now = int(time.time())
            assertion = jwt.encode(
                {"iss": self._email, "scope": FCM_SCOPE, "aud": self._token_uri, "iat": now, "exp": now + 3600},
                self._key,
                algorithm="RS256",
                headers={"kid": self._key_id} if self._key_id else None,
            )
            r = httpx.post(
                self._token_uri,
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                raise RuntimeError(f"FCM erişim jetonu alınamadı ({r.status_code})")
            payload = r.json()
            self._access = (payload["access_token"], time.time() + int(payload.get("expires_in", 3600)))
            return self._access[0]

    def message(self, token: str, title: str, body: str, data: dict[str, str]) -> dict:
        # Ses Android'de kanaldan gelir; "sound" verilirse expo-notifications onu özel ses dosyası sanar.
        android_notification: dict[str, str] = {"channel_id": ANDROID_CHANNEL}
        apns: dict = {"payload": {"aps": {"sound": "default"}}}
        # Aynı olay uygulama içinden yerel bildirim olarak da gösterilebilir; aynı etiket ikinciyi birincinin
        # yerine koyar, kullanıcı tek bildirim görür (Android tag, iOS apns-collapse-id; en fazla 64 bayt).
        if data.get("update_id"):
            android_notification["tag"] = data["update_id"]
            apns["headers"] = {"apns-collapse-id": data["update_id"][:64]}
        return {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": {k: str(v) for k, v in data.items()},
                "android": {"priority": "high", "notification": android_notification},
                "apns": apns,
            }
        }

    def _post(self, payload: dict) -> httpx.Response:
        return httpx.post(self.url, json=payload, headers={"Authorization": f"Bearer {self._access_token()}"},
                          timeout=TIMEOUT)

    def send(self, token: str, title: str, body: str, data: dict[str, str]) -> None:
        payload = self.message(token, title, body, data)
        r = self._post(payload)
        if r.status_code == 401:
            # Erişim jetonu süresinden önce geçersiz kılınmış olabilir: yenisiyle bir kez yeniden denenir.
            with self._lock:
                self._access = None
            r = self._post(payload)
        if r.status_code == 200:
            return
        if _is_token_error(r):
            raise PushTokenInvalid(f"FCM jetonu geçersiz ({r.status_code})")
        raise RuntimeError(f"FCM gönderimi başarısız ({r.status_code})")


def _is_token_error(r: httpx.Response) -> bool:
    """Jeton kalıcı olarak kullanılamaz: UNREGISTERED, SENDER_ID_MISMATCH (başka Firebase projesinin jetonu)
    veya jeton biçimi geçersiz (400 INVALID_ARGUMENT, "registration token"). Proje yolu yanlışsa gelen
    düz 404 jeton hatası sayılmaz; yoksa tüm jetonlar silinirdi."""
    try:
        err = r.json().get("error", {})
    except ValueError:
        return False
    codes = {d.get("errorCode") for d in err.get("details", []) if isinstance(d, dict)}
    if codes & {"UNREGISTERED", "SENDER_ID_MISMATCH"}:
        return True
    return (r.status_code == 400 and "INVALID_ARGUMENT" in codes
            and "registration token" in str(err.get("message", "")).lower())


@lru_cache
def get_push_sender() -> PushSender:
    settings = get_settings()
    if settings.push_provider == "fcm":
        return FcmPush(settings.fcm_credentials_file)
    return ConsolePush()
