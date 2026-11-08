"""FCM HTTP v1 gönderici ve cihaz jetonu yaşam döngüsü (bağlama, çıkışta silme, geçersiz jeton)."""

import json
import uuid

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.models import Customer, Driver
from app.providers import push
from app.services import push_outbox
from tests.conftest import otp_login, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür
from tests.test_trips import _accepted, _event

API = "/api/v1"


@pytest.fixture
def credentials(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    path = tmp_path / "sa.json"
    path.write_text(json.dumps({
        "type": "service_account", "project_id": "demo-proj", "private_key_id": "k1", "private_key": pem,
        "client_email": "fcm@demo-proj.iam.gserviceaccount.com", "token_uri": "https://oauth2.googleapis.com/token",
    }))
    return str(path), key.public_key()


class FakeHttp:
    def __init__(self, send_status=200, send_body=None):
        self.calls: list[tuple[str, dict]] = []
        self.send_status = send_status
        self.send_body = send_body or {"name": "projects/demo-proj/messages/1"}

    def post(self, url, **kw):
        self.calls.append((url, kw))
        req = httpx.Request("POST", url)
        if url.endswith("/token"):
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3600}, request=req)
        return httpx.Response(self.send_status, json=self.send_body, request=req)


def test_fcm_sends_v1_message_and_caches_access_token(credentials, monkeypatch):
    path, public_key = credentials
    http = FakeHttp()
    monkeypatch.setattr(push.httpx, "post", http.post)
    sender = push.FcmPush(path)

    sender.send("tok-1", "Sürücünüz geldi", "Vito · 07 GA 001", {"type": "driver_arrived", "update_id": "u1"})
    sender.send("tok-2", "Başlık", "Gövde", {"type": "new_message"})

    token_calls = [c for c in http.calls if c[0].endswith("/token")]
    assert len(token_calls) == 1  # erişim jetonu önbellekte
    claims = jwt.decode(token_calls[0][1]["data"]["assertion"], public_key, algorithms=["RS256"],
                        audience="https://oauth2.googleapis.com/token")
    assert claims["scope"] == push.FCM_SCOPE and claims["iss"].startswith("fcm@")

    url, kw = http.calls[1]
    assert url == "https://fcm.googleapis.com/v1/projects/demo-proj/messages:send"
    assert kw["headers"]["Authorization"] == "Bearer ya29.test"
    msg = kw["json"]["message"]
    assert msg["token"] == "tok-1"
    assert msg["notification"] == {"title": "Sürücünüz geldi", "body": "Vito · 07 GA 001"}
    assert msg["android"]["priority"] == "high"
    assert msg["android"]["notification"]["channel_id"] == "trip"
    assert msg["android"]["notification"]["tag"] == "u1"
    assert "tag" not in http.calls[2][1]["json"]["message"]["android"]["notification"]


def test_fcm_unregistered_token_and_other_errors(credentials, monkeypatch):
    path, _ = credentials
    gone = FakeHttp(404, {"error": {"status": "NOT_FOUND", "details": [{"errorCode": "UNREGISTERED"}]}})
    monkeypatch.setattr(push.httpx, "post", gone.post)
    with pytest.raises(push.PushTokenInvalid):
        push.FcmPush(path).send("old", "t", "b", {})

    # Proje yolu yanlışsa gelen düz 404 jeton hatası değildir (jetonlar silinmez).
    wrong_project = FakeHttp(404, {"error": {"status": "NOT_FOUND"}})
    monkeypatch.setattr(push.httpx, "post", wrong_project.post)
    with pytest.raises(RuntimeError):
        push.FcmPush(path).send("tok", "t", "b", {})

    bad_format = FakeHttp(400, {"error": {"status": "INVALID_ARGUMENT", "message": "The registration token is not a valid FCM registration token",
                                          "details": [{"errorCode": "INVALID_ARGUMENT"}]}})
    monkeypatch.setattr(push.httpx, "post", bad_format.post)
    with pytest.raises(push.PushTokenInvalid):
        push.FcmPush(path).send("ios-apns-token", "t", "b", {})

    down = FakeHttp(503, {"error": {"status": "UNAVAILABLE"}})
    monkeypatch.setattr(push.httpx, "post", down.post)
    with pytest.raises(RuntimeError):
        push.FcmPush(path).send("tok", "t", "b", {})


def test_fcm_rejects_non_service_account_file(tmp_path):
    p = tmp_path / "google-services.json"
    p.write_text(json.dumps({"project_info": {"project_id": "x"}, "client": []}))
    with pytest.raises(ValueError):
        push.FcmPush(str(p))


def test_push_token_bound_to_one_account_and_released_on_logout(client, db):
    token = f"fcm-{uuid.uuid4()}"
    first = otp_login(client, random_phone())
    second = otp_login(client, random_phone())
    assert client.post(f"{API}/me/push-token", headers=first, json={"token": token}).status_code == 204
    # Aynı cihazda başka hesap: jeton önceki hesaptan alınır.
    assert client.post(f"{API}/me/push-token", headers=second, json={"token": token}).status_code == 204
    owners = db.scalars(select(Customer).where(Customer.push_token == token)).all()
    assert len(owners) == 1

    # Çıkışta yalnız bu cihazın jetonu silinir; gövdesiz çıkış eskisi gibi çalışır.
    assert client.post(f"{API}/auth/logout", headers=second, json={"push_token": "baska-cihaz"}).status_code == 204
    db.expire_all()
    assert db.scalar(select(Customer).where(Customer.push_token == token)) is not None
    third = otp_login(client, random_phone())
    client.post(f"{API}/me/push-token", headers=third, json={"token": token})
    assert client.post(f"{API}/auth/logout", headers=third, json={"push_token": token}).status_code == 204
    assert client.post(f"{API}/auth/logout", headers=first).status_code == 204
    db.expire_all()
    assert db.scalar(select(Customer).where(Customer.push_token == token)) is None


def test_trip_update_push_carries_update_id_and_invalid_token_is_cleared(client, db, ops, monkeypatch):
    driver, customer, code, leg_id = _accepted(client, ops)
    token = f"fcm-{uuid.uuid4()}"
    client.post(f"{API}/me/push-token", headers=customer, json={"token": token})

    sent: list[dict] = []

    class Gone:
        def send(self, tok, title, body, data):
            sent.append({"token": tok, **data})
            raise push.PushTokenInvalid("unregistered")

    monkeypatch.setattr("app.services.push_outbox.get_push_sender", lambda: Gone())
    assert _event(client, driver, leg_id, "yola_cikti").status_code == 200
    push_outbox.drain()

    assert sent and sent[0]["token"] == token and sent[0]["update_id"]
    ids = [u["id"] for u in client.get(f"{API}/me/updates", headers=customer).json()]
    assert sent[0]["update_id"] in ids  # uygulama içi bildirimle aynı kimlik (çift bildirim engeli)
    db.expire_all()
    assert db.scalar(select(Customer).where(Customer.push_token == token)) is None


def test_driver_offer_push_clears_invalid_token(client, db, ops, monkeypatch):
    driver_headers, driver_id = onboard_driver(client, ops, online=True)
    token = f"fcm-{uuid.uuid4()}"
    client.post(f"{API}/driver/me/push-token", headers=driver_headers, json={"token": token})

    class Gone:
        def send(self, *a):
            raise push.PushTokenInvalid("unregistered")

    monkeypatch.setattr("app.services.push_outbox.get_push_sender", lambda: Gone())
    from tests.test_trips import _paid_booking

    _paid_booking(client, booking_type="anlik", hours_ahead=0)
    push_outbox.drain()
    db.expire_all()
    assert db.scalar(select(Driver).where(Driver.push_token == token)) is None


def test_fcm_retries_once_with_fresh_access_token_on_401(credentials, monkeypatch):
    path, _ = credentials
    statuses = iter([401, 200])

    class Flaky(FakeHttp):
        def post(self, url, **kw):
            self.calls.append((url, kw))
            req = httpx.Request("POST", url)
            if url.endswith("/token"):
                return httpx.Response(200, json={"access_token": f"ya29.{len(self.calls)}", "expires_in": 3600}, request=req)
            return httpx.Response(next(statuses), json={}, request=req)

    http = Flaky()
    monkeypatch.setattr(push.httpx, "post", http.post)
    push.FcmPush(path).send("tok", "t", "b", {"update_id": "u9"})
    assert sum(1 for u, _ in http.calls if u.endswith("/token")) == 2
    send_calls = [kw for u, kw in http.calls if not u.endswith("/token")]
    assert len(send_calls) == 2
    assert send_calls[0]["headers"]["Authorization"] != send_calls[1]["headers"]["Authorization"]
    assert send_calls[1]["json"]["message"]["apns"]["headers"]["apns-collapse-id"] == "u9"


def test_push_is_sent_only_after_commit(db, monkeypatch):
    sent: list[str] = []

    class Rec:
        def send(self, tok, *a):
            sent.append(tok)

    monkeypatch.setattr("app.services.push_outbox.get_push_sender", lambda: Rec())
    driver = db.scalars(select(Driver).limit(1)).first()
    if driver is None:
        pytest.skip("sürücü yok")
    original = driver.push_token
    driver.push_token = "rollback-token"
    push_outbox.enqueue(db, driver, "dispatch_offer", "t", "b", {})
    db.rollback()
    push_outbox.drain()
    assert sent == []  # geri alınan işlemin bildirimi gitmez

    driver = db.get(Driver, driver.id)
    driver.push_token = "commit-token"
    push_outbox.enqueue(db, driver, "dispatch_offer", "t", "b", {})
    assert sent == []  # commit'ten önce gönderilmez
    driver.push_token = original
    db.commit()
    push_outbox.drain()
    assert sent == ["commit-token"]


def test_settings_reject_fcm_without_credentials_file(monkeypatch):
    from app.config import Settings

    with pytest.raises(ValueError):
        Settings(push_provider="fcm", fcm_credentials_file="C:/yok/sa.json")
    with pytest.raises(ValueError):
        Settings(push_provider="FCM")
