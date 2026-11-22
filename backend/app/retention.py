"""K-83: kişisel veri saklama süreleri (KVKK m.4, GDPR m.5: amaçla sınırlı ve gerektiği kadar).

Tek kaynak budur; `docs/yasal_ve_guvenlik.md` tablosu bununla aynı tutulur. Süreler taslaktır, hukukçu teyidi
bekler. Diğer modüllerdeki mevcut süreler (uçuş K-31, sohbet K-50, SMS kodu) burada yalnızca listelenir; kendi
görevleri onları uygular.

`purge()` günlük çalışır. Değiştirilemez tablolarda (audit_logs, booking_activities) silme, veritabanı
tetikleyicisini yalnızca bu işlemin içinde açılan bayrakla geçer (`SET LOCAL getaway.retention_purge = 'on'`).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, text, update
from sqlalchemy.orm import Session

from app.models import AuditLog, AuthSession, BookingActivity, Incident, IncidentOccurrence, TripEvent

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Rule:
    data: str
    days: int | None  # None: başka bir olaya bağlı (ör. yolculuğun bitişi)
    action: str
    basis: str
    implemented_by: str


POLICY: tuple[Rule, ...] = (
    Rule("Yolculuk geçmişi (booking_activities)", 730, "silinir", "uyuşmazlık ve şikâyet incelemesi",
         "retention.purge"),
    Rule("Olay anındaki konum (booking_activities, trip_events)", 180, "konum boşaltılır",
         "kanıtlı bekleme ve şikâyet; sonrasında gereksiz", "retention.purge"),
    Rule("Denetim kaydı (audit_logs)", 730, "silinir", "5651 erişim kaydı ve güvenlik incelemesi",
         "retention.purge"),
    Rule("Olay tekrarları (incident_occurrences)", 180, "silinir", "teşhis", "retention.purge"),
    Rule("Çözülmüş olay (incidents)", 365, "silinir (son görülmeden)", "teşhis ve tekrar analizi",
         "retention.purge"),
    Rule("Biten oturumlar (sessions, IP içerir)", 90, "silinir (bitişten)", "güvenlik incelemesi",
         "retention.purge"),
    Rule("Uçuş bilgisi", None, "yolculuk bitince silinir", "K-31", "jobs.purge_flight_data"),
    Rule("Sohbet mesajları", 30, "silinir (yolculuktan)", "K-50", "jobs.purge_trip_messages"),
    Rule("SMS doğrulama kodları", 1, "silinir", "kimlik doğrulama", "jobs.purge_otp_challenges"),
    Rule("Rezervasyon, ödeme ve fatura", 3650, "saklanır; silme talebinde kişisel alanlar anonimleşir (K-70)",
         "VUK 253, TTK 82", "privacy.anonymize_customer"),
)


def _days(name: str) -> int:
    for rule in POLICY:
        if rule.data.startswith(name):
            assert rule.days is not None
            return rule.days
    raise KeyError(name)


ACTIVITY_DAYS = _days("Yolculuk geçmişi")
LOCATION_DAYS = _days("Olay anındaki konum")
AUDIT_DAYS = _days("Denetim kaydı")
OCCURRENCE_DAYS = _days("Olay tekrarları")
RESOLVED_INCIDENT_DAYS = _days("Çözülmüş olay")
SESSION_DAYS = _days("Biten oturumlar")


def purge(db: Session, now: datetime) -> int:
    """Süresi dolan kayıtları siler ya da konumu boşaltır; etkilenen satır toplamını döner."""
    db.execute(text("SET LOCAL getaway.retention_purge = 'on'"))
    counts = {
        "booking_activities": db.execute(delete(BookingActivity).where(
            BookingActivity.occurred_at < now - timedelta(days=ACTIVITY_DAYS))).rowcount,
        "activity_location": db.execute(update(BookingActivity).where(
            BookingActivity.location.is_not(None),
            BookingActivity.occurred_at < now - timedelta(days=LOCATION_DAYS)).values(location=None)).rowcount,
        "trip_event_location": db.execute(update(TripEvent).where(
            TripEvent.latitude.is_not(None),
            TripEvent.occurred_at < now - timedelta(days=LOCATION_DAYS)).values(latitude=None, longitude=None)
        ).rowcount,
        "audit_logs": db.execute(delete(AuditLog).where(
            AuditLog.created_at < now - timedelta(days=AUDIT_DAYS))).rowcount,
        "incident_occurrences": db.execute(delete(IncidentOccurrence).where(
            IncidentOccurrence.occurred_at < now - timedelta(days=OCCURRENCE_DAYS))).rowcount,
        "incidents": db.execute(delete(Incident).where(
            Incident.status == "resolved",
            Incident.last_seen_at < now - timedelta(days=RESOLVED_INCIDENT_DAYS))).rowcount,
        "sessions": db.execute(delete(AuthSession).where(
            AuthSession.expires_at < now - timedelta(days=SESSION_DAYS))).rowcount,
    }
    total = sum(counts.values())
    if total:
        log.info("saklama süresi dolan kayıtlar: %s", {k: v for k, v in counts.items() if v})
    return total
