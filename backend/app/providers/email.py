"""K-83: e-posta gönderimi (olay bildirimi). Kişisel veri içeren e-posta bu katmandan gönderilmez.

- console: geliştirme ve test; gönderilmez, bellekte tutulur ve yalnızca konu loglanır.
- smtp: üretim; STARTTLS (587) ya da SMTPS (465). Sertifika doğrulanır.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from functools import lru_cache
from typing import Protocol

from app.config import get_settings

log = logging.getLogger(__name__)


class EmailError(Exception):
    pass


class EmailSender(Protocol):
    def send(self, to: list[str], subject: str, body: str) -> None: ...


@dataclass
class ConsoleEmail:
    outbox: list[tuple[list[str], str, str]] = field(default_factory=list)

    def send(self, to: list[str], subject: str, body: str) -> None:
        self.outbox.append((list(to), subject, body))
        log.warning("E-posta (console) %d alıcı: %s", len(to), subject)


@dataclass
class SmtpEmail:
    host: str
    port: int
    username: str
    password: str
    sender: str
    use_ssl: bool
    timeout: float = 10

    def send(self, to: list[str], subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self.sender
        msg["To"] = ", ".join(to)
        msg["Subject"] = subject
        msg.set_content(body)
        context = ssl.create_default_context()
        try:
            if self.use_ssl:
                with smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=context) as smtp:
                    self._deliver(smtp, msg)
            else:
                with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
                    smtp.starttls(context=context)
                    self._deliver(smtp, msg)
        except (smtplib.SMTPException, OSError) as exc:
            # İleti sunucu yanıtı içerebilir; yalnızca tip yazılır.
            raise EmailError(type(exc).__name__) from exc

    def _deliver(self, smtp: smtplib.SMTP, msg: EmailMessage) -> None:
        if self.username:
            smtp.login(self.username, self.password)
        smtp.send_message(msg)


@lru_cache
def get_email_sender() -> EmailSender:
    s = get_settings()
    if s.email_provider == "smtp":
        return SmtpEmail(s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password, s.smtp_from, s.smtp_use_ssl)
    return ConsoleEmail()
