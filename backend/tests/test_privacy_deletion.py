"""F0-4 / PRIV-01: KVKK silme talebi gerçekten veri siler.

- "silme" talebi yalnızca anonimleştirmeyle ve yalnızca admin tarafından kapatılabilir.
- Anonimleştirme rezervasyon, bacak, oturum, push jetonu, sohbet ve talep notlarını kapsar.
- consents.ip yasal kanıt olarak saklanır (hukukçu teyidi bekliyor).
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal as D

from sqlalchemy import select

from app.models import AuthSession, Booking, BookingLeg, Consent, Customer, DataRequest, TripMessage, TripUpdate
from app.models.enums import BookingStatus, DataRequestStatus, DataRequestType
from tests.conftest import booking_body, otp_login, random_phone, staff_headers

SECRET_NOTE = "Kapı kodu 4711, Anna'nın oğlu karşılayacak"


def _customer_with_history(client, db, *, status: BookingStatus = BookingStatus.COMPLETED):
    """Profil, push jetonu, geçmiş rezervasyon (adres, koordinat, not), sohbet ve bildirim kaydı olan müşteri."""
    headers = otp_login(client, random_phone())
    r = client.patch("/api/v1/me/profile", json={"full_name": "Anna Schmidt", "email": "anna@example.com"},
                     headers=headers)
    assert r.status_code == 200, r.text
    assert client.post("/api/v1/me/push-token", json={"token": f"tok-{uuid.uuid4().hex}"},
                       headers=headers).status_code == 204
    r = client.post("/api/v1/me/bookings", json=booking_body(client, note=SECRET_NOTE), headers=headers)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]

    b = db.scalar(select(Booking).where(Booking.booking_code == code))
    b.status = status
    leg = b.legs[0]
    leg.pickup_address = "Antalya Havalimanı Dış Hatlar"
    leg.pickup_lat, leg.pickup_lng = D("36.898731"), D("30.800461")
    leg.dropoff_lat, leg.dropoff_lng = D("36.601234"), D("30.559876")
    now = datetime.now(timezone.utc)
    db.add(TripMessage(booking_leg_id=leg.id, sender="customer", body="Oda 312'deyim", created_at=now))
    db.add(TripUpdate(booking_leg_id=leg.id, recipient_type="customer", recipient_id=b.customer_id,
                      code="driver_assigned", title="Sürücü atandı", body="Anna, sürücünüz yolda", data={}))
    for s in db.scalars(select(AuthSession).join(Customer, Customer.user_id == AuthSession.user_id)
                        .where(Customer.id == b.customer_id)):
        s.ip = "203.0.113.7"
        s.device_info = "Pixel 8 / Android 15"
    db.commit()
    return headers, b.customer_id, b.id


def _deletion_request(client, headers, db) -> uuid.UUID:
    r = client.post("/api/v1/me/data-requests", json={"request_type": "silme", "note": "Anna Schmidt, +49 151 000"},
                    headers=headers)
    assert r.status_code == 201, r.text
    return uuid.UUID(r.json()["id"])


def _assert_anonymized(db, customer_id, booking_id):
    db.expire_all()
    c = db.get(Customer, customer_id)
    assert c.deleted_at is not None
    assert c.full_name is None and c.email is None
    assert c.push_token is None
    assert c.user.phone is None and c.user.phone_hash is None

    b = db.get(Booking, booking_id)
    assert "Anna" not in b.passenger_name and "Schmidt" not in b.passenger_name
    assert b.note is None
    # Fatura/tutar/tarih yasal saklama kapsamında kalır.
    assert b.total_amount > 0 and b.created_at is not None
    for leg in b.legs:
        assert leg.pickup_address is None and leg.dropoff_address is None
        assert leg.pickup_lat is None and leg.pickup_lng is None
        assert leg.dropoff_lat is None and leg.dropoff_lng is None
        # Bölge düzeyi (ilçe) bilgisi raporlama için kalır.
        assert leg.pickup_region_id and leg.dropoff_region_id

    leg_ids = [leg.id for leg in b.legs]
    assert not list(db.scalars(select(TripMessage).where(TripMessage.booking_leg_id.in_(leg_ids))))
    assert not list(db.scalars(select(TripUpdate).where(TripUpdate.recipient_type == "customer",
                                                        TripUpdate.recipient_id == customer_id)))

    sessions = list(db.scalars(select(AuthSession).where(AuthSession.user_id == c.user_id)))
    assert sessions
    for s in sessions:
        assert s.revoked_at is not None
        assert s.ip is None and s.device_info is None

    for r in db.scalars(select(DataRequest).where(DataRequest.customer_id == customer_id)):
        assert r.note is None


def test_completing_deletion_request_requires_anonymization(client, db):
    headers, customer_id, booking_id = _customer_with_history(client, db)
    req_id = _deletion_request(client, headers, db)
    admin = staff_headers(client, db, ["admin"])

    r = client.post(f"/api/v1/admin/data-requests/{req_id}", json={"status": "tamamlandi"}, headers=admin)
    assert r.status_code == 200, r.text

    _assert_anonymized(db, customer_id, booking_id)
    req = db.get(DataRequest, req_id)
    assert req.status is DataRequestStatus.COMPLETED and req.completed_at is not None
    # Anonimleştirilen müşterinin eski erişim jetonu artık geçmez.
    assert client.get("/api/v1/me/bookings", headers=headers).status_code in (401, 403)


def test_completing_deletion_request_with_active_booking_is_rejected(client, db):
    headers, customer_id, booking_id = _customer_with_history(client, db, status=BookingStatus.CONFIRMED)
    req_id = _deletion_request(client, headers, db)
    admin = staff_headers(client, db, ["admin"])

    r = client.post(f"/api/v1/admin/data-requests/{req_id}", json={"status": "tamamlandi"}, headers=admin)
    assert r.status_code == 409, r.text
    db.expire_all()
    req = db.get(DataRequest, req_id)
    assert req.status is DataRequestStatus.OPEN and req.completed_at is None
    assert db.get(Customer, customer_id).full_name == "Anna Schmidt"


def test_support_role_cannot_complete_deletion_request(client, db):
    headers, customer_id, _ = _customer_with_history(client, db)
    req_id = _deletion_request(client, headers, db)
    for role in ("destek", "operasyon"):
        staff = staff_headers(client, db, [role])
        for status in ("tamamlandi", "reddedildi"):
            r = client.post(f"/api/v1/admin/data-requests/{req_id}", json={"status": status}, headers=staff)
            assert r.status_code == 403, (role, status, r.text)
        # İşleme almak (kapatmadan) destek ve operasyon için serbest kalır.
        r = client.post(f"/api/v1/admin/data-requests/{req_id}", json={"status": "isleniyor"}, headers=staff)
        assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(DataRequest, req_id).completed_at is None
    assert db.get(Customer, customer_id).full_name == "Anna Schmidt"


def test_support_can_still_close_access_request(client, db):
    headers = otp_login(client, random_phone())
    r = client.post("/api/v1/me/data-requests", json={"request_type": "erisim"}, headers=headers)
    req_id = r.json()["id"]
    staff = staff_headers(client, db, ["destek"])
    r = client.post(f"/api/v1/admin/data-requests/{req_id}", json={"status": "tamamlandi"}, headers=staff)
    assert r.status_code == 200, r.text


def test_anonymize_customer_clears_booking_and_leg_pii(client, db):
    headers, customer_id, booking_id = _customer_with_history(client, db)
    req_id = _deletion_request(client, headers, db)
    admin = staff_headers(client, db, ["admin"])

    r = client.post(f"/api/v1/admin/customers/{customer_id}/anonymize", json={}, headers=admin)
    assert r.status_code == 200, r.text

    _assert_anonymized(db, customer_id, booking_id)
    # Açık silme talebi anonimleştirmeyle birlikte kapanır.
    req = db.get(DataRequest, req_id)
    assert req.request_type is DataRequestType.DELETE
    assert req.status is DataRequestStatus.COMPLETED and req.completed_at is not None


def test_anonymize_customer_clears_session_ip_and_push_token(client, db):
    headers, customer_id, booking_id = _customer_with_history(client, db)
    client.post("/api/v1/me/consents", json={"consent_type": "pazarlama", "accepted": True, "version": "1.0"},
                headers=headers)
    admin = staff_headers(client, db, ["admin"])

    r = client.post(f"/api/v1/admin/customers/{customer_id}/anonymize", json={}, headers=admin)
    assert r.status_code == 200, r.text

    db.expire_all()
    c = db.get(Customer, customer_id)
    assert c.push_token is None
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == c.user_id)):
        assert s.revoked_at is not None and s.ip is None and s.device_info is None
    # consents.ip yasal kanıt olarak kalır (hukukçu teyidi bekliyor, F0-4 kapsamı dışında).
    assert any(x.ip for x in db.scalars(select(Consent).where(Consent.customer_id == customer_id)))
