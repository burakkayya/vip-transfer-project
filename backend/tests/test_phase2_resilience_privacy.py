"""Güvenlik Faz 2: dayanıklılık, gizlilik ve veri kalanları.

MON-12 (approach sınırı ve önbelleği), MON-13 (offset ve liste üst sınırı), MON-14 (worker işleri birbirinden
yalıtık), PRIV-10 (iptalde uçuş verisi hemen silinir), PRIV-12 (konsol push gövdesi loglanmaz), PRIV-13 (uçuş
takip logunda numara maskeli), DB-07 (denetim kaydında reason/reference), DB-13 (LIKE kaçışlama), RT-08 (push
jetonu biçimi ve devri), fx XML (defusedxml).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.errors import ServiceUnavailable
from app.models import AuditLog, Booking, Customer, Driver, FlightInfo
from app.providers import routing
from app.providers.routing import Route
from app.services import audit, jobs, quotes
from tests.conftest import booking_body, otp_login, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _accepted, _region

API = "/api/v1"


# --- MON-12: approach -------------------------------------------------------------------------------------


class _CountingRouter:
    def __init__(self) -> None:
        self.calls = 0

    def route(self, origin, destination) -> Route:
        self.calls += 1
        return Route(distance_km=Decimal("12.3"), duration_minutes=17, polyline="abc")


@pytest.fixture
def fixed_minute(monkeypatch):
    # Dakika sınırına denk gelen çalıştırmada sayaç sıfırlanmasın.
    stamp = f"t{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(quotes, "_minute", lambda: stamp)
    return stamp


def test_approach_rate_limited_per_driver(client, db, ops, monkeypatch, fixed_minute):
    driver, _, _, leg_id = _accepted(client, ops)
    other, _, _, other_leg = _accepted(client, ops)
    router = _CountingRouter()
    monkeypatch.setattr(routing, "get_routing", lambda: router)
    monkeypatch.setattr(get_settings(), "approach_rate_limit_per_minute", 2, raising=False)
    ayt = _region(client, "ayt")
    base = (float(ayt["latitude"]), float(ayt["longitude"]))

    def call(headers, leg, i):
        return client.get(f"{API}/driver/trips/{leg}/approach", headers=headers,
                          params={"lat": base[0] + 0.01 * i, "lng": base[1]})

    assert call(driver, leg_id, 1).status_code == 200
    assert call(driver, leg_id, 2).status_code == 200
    r = call(driver, leg_id, 3)
    assert r.status_code == 429, r.text
    assert router.calls == 2
    # Sınır sürücü başınadır: başka sürücü etkilenmez.
    assert call(other, other_leg, 4).status_code == 200


def test_approach_cached_for_nearby_position(client, db, ops, monkeypatch, fixed_minute):
    driver, _, _, leg_id = _accepted(client, ops)
    router = _CountingRouter()
    monkeypatch.setattr(routing, "get_routing", lambda: router)
    ayt = _region(client, "ayt")
    lat, lng = float(ayt["latitude"]) + 0.05, float(ayt["longitude"])
    first = client.get(f"{API}/driver/trips/{leg_id}/approach", headers=driver, params={"lat": lat, "lng": lng})
    # ~10 m kayma: aynı yuvarlanmış nokta, Routes API tekrar çağrılmaz.
    second = client.get(f"{API}/driver/trips/{leg_id}/approach", headers=driver,
                        params={"lat": lat + 0.0001, "lng": lng})
    assert first.status_code == second.status_code == 200
    assert router.calls == 1
    assert second.json()["polyline"] == "abc" and second.json()["duration_minutes"] == 17


def test_approach_requires_active_leg(client, db, ops, monkeypatch, fixed_minute):
    driver, customer, code, leg_id = _accepted(client, ops)
    router = _CountingRouter()
    monkeypatch.setattr(routing, "get_routing", lambda: router)
    assert client.post(f"{API}/me/bookings/{code}/cancel", headers=customer,
                       json={"reason": "plan değişti"}).status_code == 200
    r = client.get(f"{API}/driver/trips/{leg_id}/approach", headers=driver, params={"lat": 36.9, "lng": 30.8})
    assert r.status_code == 409 and r.json()["error"]["code"] == "trip_not_active"
    assert router.calls == 0


# --- MON-13: sayfalama ------------------------------------------------------------------------------------


def test_admin_list_offset_capped(client, db, ops):
    assert client.get(f"{API}/admin/audit-logs", headers=ops, params={"offset": 10_000}).status_code == 200
    r = client.get(f"{API}/admin/audit-logs", headers=ops, params={"offset": 10_001})
    assert r.status_code == 422, r.text
    assert client.get(f"{API}/admin/drivers", headers=ops, params={"offset": 10**9}).status_code == 422


def test_admin_unbounded_lists_have_cap(client, db, ops, monkeypatch):
    from app.api.admin import common
    from tests.conftest import staff_headers

    admin = staff_headers(client, db, ["admin"])
    staff_headers(client, db, ["operasyon"])
    monkeypatch.setattr(common, "MAX_LIST", 1)
    r = client.get(f"{API}/admin/users", headers=admin)
    assert r.status_code == 200 and len(r.json()) == 1


# --- MON-14: worker ---------------------------------------------------------------------------------------


class _FakeSession:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def commit(self):
        pass


def _job(name, ran):
    def job(db, now):
        ran.append(name)
        return 0

    job.__name__ = name
    return job


def test_worker_job_failure_does_not_skip_next_job(monkeypatch, caplog):
    from app import worker

    ran: list[str] = []

    def boom(db, now):
        raise RuntimeError("Anna Schmidt +905321112233")

    boom.__name__ = "purge_flight_data"
    monkeypatch.setattr(jobs, "purge_flight_data", boom)
    for name in ("purge_otp_challenges", "purge_trip_messages", "refresh_exchange_rate"):
        monkeypatch.setattr(jobs, name, _job(name, ran))
    monkeypatch.setattr(worker, "SessionLocal", _FakeSession)

    with caplog.at_level(logging.INFO, logger="app.worker"):
        asyncio.run(worker.every_hour({}))

    assert ran == ["purge_otp_challenges", "purge_trip_messages", "refresh_exchange_rate"]
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors and "GÜVENLİK ALARMI" in errors[0].getMessage() and "purge_flight_data" in errors[0].getMessage()
    # Hata iletisindeki kişisel veri loglanmaz (yalnızca istisna tipi).
    assert "Anna" not in caplog.text and "905321112233" not in caplog.text
    assert all(r.exc_info is None for r in errors)


def test_worker_records_last_success(monkeypatch):
    from app import worker

    ran: list[str] = []
    name = "purge_otp_challenges"
    monkeypatch.setattr(jobs, name, _job(name, ran))
    monkeypatch.setattr(worker, "SessionLocal", _FakeSession)
    r = quotes._redis()
    r.delete(f"worker:last_success:{name}")
    assert worker._run(jobs.purge_otp_challenges) is True
    stamp = r.get(f"worker:last_success:{name}")
    assert stamp is not None
    assert abs(datetime.fromisoformat(stamp.decode()) - datetime.now(timezone.utc)) < timedelta(minutes=1)


# --- PRIV-10: iptalde uçuş verisi -------------------------------------------------------------------------


def _flight_booking(client):
    customer = otp_login(client, random_phone())
    no = f"PC{uuid.uuid4().int % 10000:04d}"
    r = client.post(f"{API}/me/bookings", headers=customer,
                    json=booking_body(client, flights=[{"leg_order": 1, "flight_no": no}]))
    assert r.status_code == 201, r.text
    return customer, r.json()["booking_code"], r.json()["legs"][0]["id"]


def test_cancel_sets_flight_purge_now(client, db):
    customer, code, leg_id = _flight_booking(client)
    before = datetime.now(timezone.utc)
    r = client.post(f"{API}/me/bookings/{code}/cancel", headers=customer, json={"reason": "plan değişti"})
    assert r.status_code == 200, r.text
    db.expire_all()
    fi = db.scalar(select(FlightInfo).where(FlightInfo.booking_leg_id == leg_id))
    assert fi is not None and fi.purge_at <= datetime.now(timezone.utc)
    assert jobs.purge_flight_data(db, datetime.now(timezone.utc)) >= 1
    db.commit()
    assert db.scalar(select(FlightInfo).where(FlightInfo.booking_leg_id == leg_id)) is None
    assert before


def test_unpaid_auto_cancel_sets_flight_purge_now(client, db):
    _, code, leg_id = _flight_booking(client)
    later = datetime.now(timezone.utc) + timedelta(days=1)
    assert jobs.cancel_unpaid_bookings(db, later) >= 1
    db.commit()
    db.expire_all()
    assert db.scalar(select(Booking.status).where(Booking.booking_code == code)).value == "iptal"
    fi = db.scalar(select(FlightInfo).where(FlightInfo.booking_leg_id == leg_id))
    assert fi is not None and fi.purge_at <= later


# --- PRIV-12: konsol push ---------------------------------------------------------------------------------


def test_console_push_log_has_no_body(caplog):
    from app.providers.push import ConsolePush

    sender = ConsolePush()
    token = "SECRETTOKENPREFIX-" + uuid.uuid4().hex
    with caplog.at_level(logging.DEBUG, logger="app.providers.push"):
        sender.send(token, "Merhaba Mehmet", "Yolcu Anna Schmidt sizi bekliyor", {"leg_id": "x"})
    assert sender.outbox  # testler bellekteki kutuyu kullanmaya devam eder
    assert "SECRETTO" not in caplog.text
    assert "Mehmet" not in caplog.text and "Anna" not in caplog.text


# --- PRIV-13: uçuş takip logu -----------------------------------------------------------------------------


class _FailingFlights:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def arrivals(self, flight_no, day, airport_iata):
        raise self.exc


@pytest.mark.parametrize("exc", [ServiceUnavailable("uçuş durumu alınamadı"), RuntimeError("beklenmeyen")])
def test_flight_tracking_log_masks_flight_no(client, db, ops, monkeypatch, caplog, exc):
    import redis

    from app.services import flight_tracking

    r = redis.Redis.from_url(get_settings().redis_url)
    for key in r.scan_iter("flight_calls:*"):
        r.delete(key)
    monkeypatch.setattr(get_settings(), "flight_daily_call_limit", 100_000)
    no = f"ZQ{uuid.uuid4().int % 10000:04d}"
    customer = otp_login(client, random_phone())
    body = booking_body(client, hours_ahead=3, flights=[{"leg_order": 1, "flight_no": no}])
    r = client.post(f"{API}/me/bookings", headers=customer, json=body)
    assert r.status_code == 201, r.text
    from tests.conftest import pay

    pay(client, customer, r.json()["booking_code"])
    with caplog.at_level(logging.WARNING, logger="app.services.flight_tracking"):
        flight_tracking.refresh_flights(db, datetime.now(timezone.utc), _FailingFlights(exc))
    assert "ZQ***" in caplog.text
    assert no not in caplog.text


# --- DB-07: denetim kaydında reason / reference -----------------------------------------------------------


def test_audit_masks_reason_and_reference():
    long_reason = "müşteri anna@example.com ve +90 532 111 22 33 numarasından aradı, IBAN TR330006100519786457841326 " + "x" * 600
    cleaned = audit._clean({"reference": "DEKONT-998877", "reason": long_reason,
                            "override_reason": "ara: 0532 111 22 33", "nested": {"reference": "R-1"}})
    assert cleaned["reference"] == "***" and cleaned["nested"]["reference"] == "***"
    assert "anna@example.com" not in cleaned["reason"]
    assert "532 111 22 33" not in cleaned["reason"] and "TR330006100519786457841326" not in cleaned["reason"]
    assert len(cleaned["reason"]) <= audit.REASON_MAX_LENGTH + 1
    assert "0532 111 22 33" not in cleaned["override_reason"]
    # Operasyonel gerekçe okunur kalır (force-advance, sohbet incelemesi, fiyat ezme).
    assert audit._clean({"reason": "Şikâyet #12: erken bitirme"})["reason"] == "Şikâyet #12: erken bitirme"
    assert audit._clean({"reason": "uçuş 2026-11-14 tarihinde 3 saat rötar"})["reason"] == \
        "uçuş 2026-11-14 tarihinde 3 saat rötar"
    assert audit._clean({"reason": None})["reason"] is None


# --- DB-13: LIKE kaçışlama --------------------------------------------------------------------------------


def test_audit_action_filter_escapes_wildcards(client, db, ops):
    prefix = f"w{uuid.uuid4().hex[:10]}"
    audit.record(db, actor_id=None, action=f"{prefix}Q.done", entity_type="test")
    db.commit()
    assert len(client.get(f"{API}/admin/audit-logs", headers=ops, params={"action": prefix}).json()) == 1
    # `_` ve `%` joker değil, düz karakter sayılır.
    assert client.get(f"{API}/admin/audit-logs", headers=ops, params={"action": f"{prefix}_"}).json() == []
    assert client.get(f"{API}/admin/audit-logs", headers=ops, params={"action": f"{prefix}%"}).json() == []


# --- RT-08: push jetonu -----------------------------------------------------------------------------------


def _valid_token() -> str:
    return f"fcm-{uuid.uuid4().hex}:{uuid.uuid4().hex}"


@pytest.mark.parametrize("token", ["kisa", "bosluk iceren jeton " + "x" * 40, "<script>" + "a" * 40, "ç" * 40])
def test_push_token_format_validated(client, db, token):
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/push-token", headers=customer, json={"token": token})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_push_token", r.text


def test_push_token_format_validated_on_driver_online(client, db, ops):
    driver, _ = onboard_driver(client, ops, online=False)
    r = client.post(f"{API}/driver/me/online", headers=driver, json={"is_online": True, "push_token": "tok 1"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_push_token"
    ok = client.post(f"{API}/driver/me/online", headers=driver,
                     json={"is_online": True, "push_token": _valid_token()})
    assert ok.status_code == 200, ok.text


def test_push_token_moves_between_accounts_without_double_delivery(client, db, ops):
    token = _valid_token()
    customer = otp_login(client, random_phone())
    driver, driver_id = onboard_driver(client, ops, online=False)
    assert client.post(f"{API}/me/push-token", headers=customer, json={"token": token}).status_code == 204
    assert client.post(f"{API}/driver/me/push-token", headers=driver, json={"token": token}).status_code == 204
    db.expire_all()
    assert db.scalar(select(Customer).where(Customer.push_token == token)) is None
    assert db.scalar(select(Driver).where(Driver.push_token == token)).id == uuid.UUID(driver_id)
    log = db.scalar(select(AuditLog).where(AuditLog.action == "push_token.reassigned",
                                           AuditLog.entity_id == driver_id))
    assert log is not None and token not in str(log.changes)
    # Geçerli biçimdeki jetonu temizlemek (None) hâlâ serbesttir.
    assert client.post(f"{API}/me/push-token", headers=customer, json={"token": None}).status_code == 204


# --- fx: defusedxml ---------------------------------------------------------------------------------------


def test_fx_rejects_xml_entities():
    from app.providers import fx

    xml = ('<?xml version="1.0"?><!DOCTYPE Tarih_Date [<!ENTITY r "38.5">]>'
           '<Tarih_Date><Currency CurrencyCode="EUR"><ForexSelling>&r;</ForexSelling></Currency></Tarih_Date>')
    with pytest.raises(ServiceUnavailable):
        fx.parse_tcmb_eur_try(xml)
    ok = '<Tarih_Date><Currency CurrencyCode="EUR"><ForexSelling>38.5</ForexSelling></Currency></Tarih_Date>'
    assert fx.parse_tcmb_eur_try(ok) == Decimal("38.5")
