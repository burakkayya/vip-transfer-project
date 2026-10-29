"""Mobil bildirim. FCM'e yalnızca cihaz jetonu ve bildirim metni gider (yasal_ve_guvenlik.md).

FCM HTTP v1 servis hesabı kimlik bilgisi gerektirir; hesap açılınca FcmPush eklenecek.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol

log = logging.getLogger(__name__)


class PushSender(Protocol):
    def send(self, token: str, title: str, body: str, data: dict[str, str]) -> None: ...


@dataclass
class ConsolePush:
    outbox: list[tuple[str, str, str, dict]] = field(default_factory=list)

    def send(self, token: str, title: str, body: str, data: dict[str, str]) -> None:
        self.outbox.append((token, title, body, data))
        log.warning("PUSH (console) -> %s: %s | %s", token[:12], title, body)


@lru_cache
def get_push_sender() -> PushSender:
    return ConsolePush()
