"""Güvenlik Faz 1: kötüye kullanım ve gizlilik.

- F1-5 / MON-03: kimliksiz teklif ve rota önizlemesine IP başına ve küresel sınır; rota önbelleği LRU.
- F1-7 / API-07: belge yüklemesinde gövde üst sınırı (akış sırasında), sürücü başına adet kotası,
  `doc_type` başına tek bekleyen belge.
- F1-10 / PRIV-03: teklif yanıtında kesin koordinat yok (bölge merkezi); kabulde tam koordinat.
- F1-11 / PRIV-04: mesaj metni ve uçuş numarası `trip_updates` ve push yüküne yazılmaz.
"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal as D
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import Booking
from tests.conftest import PDF, booking_body, otp_login, pay, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür

API = "/api/v1"


# --- F1-5: teklif hız sınırı -------------------------------------------------------


@pytest.fixture
def clean_quote_limits(db_app):
    from app.services import places

    def wipe():
        r = places._redis()
        for key in r.scan_iter("quotes_rl:*"):
            r.delete(key)

    wipe()
    yield
    wipe()


def _quote_body(client):
    body = booking_body(client)
    return {k: body[k] for k in ("pickup", "dropoff", "vehicle_type_code", "pickup_at", "passenger_count",
                                 "luggage_count")}


def test_quotes_rate_limited_per_ip(client, monkeypatch, clean_quote_limits):
    body = _quote_body(client)  # booking_body bir teklif çağırır; sayaçlar sonra sıfırlanır
    from app.services import places

    for key in places._redis().scan_iter("quotes_rl:*"):
        places._redis().delete(key)
    monkeypatch.setattr(get_settings(), "quotes_rate_limit_per_minute", 2)
    ip = {"cf-connecting-ip": f"198.51.100.{uuid.uuid4().int % 250}"}
    assert client.post(f"{API}/quotes", json=body, headers=ip).status_code == 200
    assert client.post(f"{API}/quotes", json=body, headers=ip).status_code == 200
    r = client.post(f"{API}/quotes", json=body, headers=ip)
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "too_many_requests"


def test_route_preview_counts_toward_quote_limit(client, monkeypatch, clean_quote_limits):
    body = _quote_body(client)
    from app.services import places

    for key in places._redis().scan_iter("quotes_rl:*"):
        places._redis().delete(key)
    monkeypatch.setattr(get_settings(), "quotes_rate_limit_per_minute", 1)
    preview = {"pickup": body["pickup"], "dropoff": body["dropoff"]}
    assert client.post(f"{API}/routes/preview", json=preview).status_code == 200
    assert client.post(f"{API}/routes/preview", json=preview).status_code == 429


def test_quotes_global_limit(client, monkeypatch, clean_quote_limits):
    body = _quote_body(client)
    from app.services import places

    for key in places._redis().scan_iter("quotes_rl:*"):
        places._redis().delete(key)
    monkeypatch.setattr(get_settings(), "quotes_rate_limit_per_minute", 1000)
    monkeypatch.setattr(get_settings(), "quotes_global_rate_limit_per_minute", 2)
    assert client.post(f"{API}/quotes", json=body, headers={"cf-connecting-ip": "198.51.100.1"}).status_code == 200
    assert client.post(f"{API}/quotes", json=body, headers={"cf-connecting-ip": "198.51.100.2"}).status_code == 200
    r = client.post(f"{API}/quotes", json=body, headers={"cf-connecting-ip": "198.51.100.3"})
    assert r.status_code == 429, r.text


def test_route_cache_evicts_least_recent_instead_of_clearing():
    from app.providers.routing import GoogleRouting, Point, Route

    calls: list[tuple] = []
    g = GoogleRouting("k", cache_size=2)

    def fake_fetch(o, d):
        calls.append((o, d))
        return Route(distance_km=D("1"), duration_minutes=1)

    g._fetch = fake_fetch  # type: ignore[method-assign]
    a, b, c, x = (Point(D(str(36 + i / 10)), D("30")) for i in range(4))
    g.route(a, x)
    g.route(b, x)
    g.route(a, x)  # isabet: a en yeni olur
    g.route(c, x)  # dolu: en eski (b) atılmalı, a kalmalı
    assert len(calls) == 3
    g.route(a, x)
    assert len(calls) == 3, "önbellek dolunca tamamen boşaltılmamalı"
    g.route(b, x)
    assert len(calls) == 4
    assert len(g._cache) <= 2


# --- F1-7: belge yükleme kotası ---------------------------------------------------


def _new_driver(client):
    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    assert client.post(f"{API}/driver/register", headers=headers, json={"full_name": "Ali Veli"}).status_code == 201
    return headers


def _upload(client, headers, doc_type, data=PDF):
    return client.post(f"{API}/driver/documents", headers=headers, data={"doc_type": doc_type},
                       files={"file": ("x.pdf", data, "application/pdf")})


def test_document_upload_quota_for_unapproved_driver(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "document_quota_unapproved", 2)
    headers = _new_driver(client)
    assert _upload(client, headers, "surucu_belgesi").status_code == 201
    assert _upload(client, headers, "src_belgesi").status_code == 201
    r = _upload(client, headers, "adli_sicil")
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "document_quota_exceeded"


def test_document_upload_quota_for_approved_driver(client, ops, monkeypatch):  # noqa: F811
    headers, _ = onboard_driver(client, ops, online=False)  # 7 belge yükler ve onaylatır
    monkeypatch.setattr(get_settings(), "document_quota_approved", 8)
    assert _upload(client, headers, "surucu_belgesi").status_code == 201
    r = _upload(client, headers, "src_belgesi")
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "document_quota_exceeded"


def test_document_upload_quota_per_doc_type(client):
    headers = _new_driver(client)
    assert _upload(client, headers, "surucu_belgesi").status_code == 201
    r = _upload(client, headers, "surucu_belgesi")
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "document_pending_exists"


def test_request_body_over_limit_rejected_413(client, monkeypatch):
    headers = _new_driver(client)
    monkeypatch.setattr(get_settings(), "document_upload_max_body_bytes", 4096)
    r = _upload(client, headers, "surucu_belgesi", data=PDF + b"0" * 8192)
    assert r.status_code == 413, r.text
    assert r.json()["error"]["code"] == "payload_too_large"


def test_body_limit_enforced_while_streaming_without_content_length(monkeypatch):
    """Content-Length gelmese de (chunked) sınır aşılınca uygulama gövdenin kalanını okumadan 413 döner."""
    from app.body_limit import UploadBodyLimit

    monkeypatch.setattr(get_settings(), "document_upload_max_body_bytes", 100)
    read: list[int] = []

    async def inner(scope, receive, send):
        while True:
            msg = await receive()
            read.append(len(msg.get("body", b"")))
            if not msg.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 201, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    chunks = [{"type": "http.request", "body": b"x" * 60, "more_body": True} for _ in range(10)]
    chunks[-1]["more_body"] = False
    sent: list[dict] = []

    async def receive():
        return chunks.pop(0)

    async def send(msg):
        sent.append(msg)

    scope = {"type": "http", "method": "POST", "path": "/api/v1/driver/documents", "headers": []}
    asyncio.run(UploadBodyLimit(inner)(scope, receive, send))
    assert sent[0]["status"] == 413
    assert len(read) <= 2, "sınır aşıldıktan sonra gövde okunmaya devam etmemeli"


# --- F1-10: teklifte kesin koordinat yok ------------------------------------------


def test_offer_response_has_no_exact_coordinates(client, db, ops):  # noqa: F811
    driver, _ = onboard_driver(client, ops)
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client, hours_ahead=0, booking_type="anlik"),
                    headers=customer)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    leg = b.legs[0]
    exact_pickup = (D("36.898731"), D("30.800461"))
    exact_dropoff = (D("36.601234"), D("30.559876"))
    leg.pickup_lat, leg.pickup_lng = exact_pickup
    leg.dropoff_lat, leg.dropoff_lng = exact_dropoff
    centres = {
        "pickup": (leg.pickup_region.latitude, leg.pickup_region.longitude),
        "dropoff": (leg.dropoff_region.latitude, leg.dropoff_region.longitude),
    }
    db.commit()
    pay(client, customer, code)

    offers = client.get(f"{API}/driver/offers", headers=driver).json()
    trip = next(o for o in offers if o["trip"]["booking_code"] == code)["trip"]
    got_pickup = (D(trip["pickup_lat"]), D(trip["pickup_lng"]))
    got_dropoff = (D(trip["dropoff_lat"]), D(trip["dropoff_lng"]))
    assert got_pickup != exact_pickup and got_dropoff != exact_dropoff
    assert got_pickup == centres["pickup"] and got_dropoff == centres["dropoff"]

    offer_id = next(o for o in offers if o["trip"]["booking_code"] == code)["offer_id"]
    accepted = client.post(f"{API}/driver/offers/{offer_id}/accept", headers=driver).json()
    assert (D(accepted["pickup_lat"]), D(accepted["pickup_lng"])) == exact_pickup
    assert (D(accepted["dropoff_lat"]), D(accepted["dropoff_lng"])) == exact_dropoff


# --- F1-11: bildirimde mesaj metni ve uçuş numarası yok ---------------------------


SECRET_TEXT = "Oda 312, kapı kodu 4711"


class _FakeDb:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


def _fake_leg(locale="de"):
    owner = SimpleNamespace(id=uuid.uuid4(), push_token="tok")
    booking = SimpleNamespace(locale=locale, customer_id=owner.id, customer=owner, booking_code="GT-TEST")
    driver = SimpleNamespace(id=uuid.uuid4(), full_name="Mehmet Yılmaz", push_token="tok-d")
    return SimpleNamespace(
        id=uuid.uuid4(), booking=booking, driver=driver, vehicle=None,
        pickup_region=SimpleNamespace(name="Antalya Havalimanı"), dropoff_region=SimpleNamespace(name="Kemer"),
    )


@pytest.fixture
def captured_push(monkeypatch):
    from app.services import push_outbox

    sent: list[tuple] = []
    monkeypatch.setattr(push_outbox, "enqueue", lambda db, owner, code, title, body, data:
                        sent.append((code, title, body, data)))
    return sent


@pytest.mark.parametrize("locale", ["tr", "en", "de", "ru"])
def test_new_message_update_body_has_no_message_text(captured_push, locale):
    from app.services import trip_updates

    db = _FakeDb()
    leg = _fake_leg(locale)
    up = trip_updates.to_customer(db, leg, "new_message", sender="Mehmet", text=SECRET_TEXT)
    assert SECRET_TEXT not in up.title and SECRET_TEXT not in up.body
    assert "Mehmet" not in up.title and "Mehmet" not in up.body
    assert up.body.strip()
    up = trip_updates.to_driver(db, leg, "new_message", sender="Anna", text=SECRET_TEXT)
    assert SECRET_TEXT not in up.title and SECRET_TEXT not in up.body
    assert "Anna" not in up.title and "Anna" not in up.body


def test_push_payload_has_no_message_text(captured_push):
    from app.services import trip_updates

    leg = _fake_leg()
    trip_updates.to_customer(_FakeDb(), leg, "new_message", sender="Mehmet", text=SECRET_TEXT)
    trip_updates.to_driver(_FakeDb(), leg, "new_message", sender="Anna", text=SECRET_TEXT)
    assert len(captured_push) == 2
    for code, title, body, data in captured_push:
        blob = " ".join([title, body, *map(str, data.values())])
        assert SECRET_TEXT not in blob and "4711" not in blob


@pytest.mark.parametrize("code", ["flight_delayed", "flight_landed", "flight_cancelled", "flight_diverted"])
def test_flight_update_has_no_flight_number(captured_push, code):
    from app.services import trip_updates

    up = trip_updates.to_driver(_FakeDb(), _fake_leg(), code, flight="TK1980", time="14:05", scheduled="13:20")
    assert "TK1980" not in up.title and "TK1980" not in up.body
    _, title, body, data = captured_push[-1]
    assert "TK1980" not in " ".join([title, body, *map(str, data.values())])
