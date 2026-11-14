"""Güvenlik Faz 2 bağımsız inceleme düzeltmeleri (REV-C-1..4)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from tests.conftest import booking_body, otp_login, random_phone

API = "/api/v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rejected_charge(client, db):
    """Ödeme sayfası açılmış ve imzası geçerli ama tutarı bildirilmemiş başarılı bildirim almış rezervasyon."""
    from app.models import Payment
    from app.providers.payments import get_payment_provider
    from app.services import payments as payment_service

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    provider = get_payment_provider()
    form = {"merchant_oid": oid, "status": "success", "total_amount": "", "hash": provider.sign(oid, "success", "")}
    payment_service.handle_callback(db, provider, form, _now())
    db.commit()
    db.expire_all()
    return customer, code, payment.booking_id


# --- REV-C-1: reddedilen başarılı bildirimden sonra ikinci tahsilat ve otomatik iptal -------------------------


def test_rejected_charge_blocks_new_payment_session(client, db):
    customer, code, _ = _rejected_charge(client, db)
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code == 409, r.text
    assert "payment_under_review" in r.text


def test_rejected_charge_not_auto_cancelled(client, db):
    from app.models import Booking
    from app.models.enums import BookingStatus
    from app.services import jobs

    _, _, booking_id = _rejected_charge(client, db)
    jobs.cancel_unpaid_bookings(db, _now() + timedelta(days=2))
    db.commit()
    db.expire_all()
    assert db.get(Booking, booking_id).status is BookingStatus.PENDING_PAYMENT


def test_rejected_charge_raises_alarm(client, db, caplog):
    with caplog.at_level(logging.ERROR, logger="app.services.payments"):
        _rejected_charge(client, db)
    assert any("GÜVENLİK ALARMI" in r.getMessage() for r in caplog.records)


def test_ordinary_failed_payment_does_not_block(client, db):
    """Kartın reddedilmesi (status=failed) inceleme durumu değildir; müşteri yeniden ödeyebilir."""
    from app.models import Payment
    from app.providers.payments import get_payment_provider
    from app.services import payments as payment_service

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    code = r.json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    provider = get_payment_provider()
    total = str(int(db.scalar(select(Payment).where(Payment.merchant_oid == oid)).amount * 100))
    form = {"merchant_oid": oid, "status": "failed", "total_amount": total,
            "hash": provider.sign(oid, "failed", total)}
    payment_service.handle_callback(db, provider, form, _now())
    db.commit()
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code in (200, 201), r.text


# --- REV-C-2: admin teklifinde ülke kodu deseni ---------------------------------------------------------------


def test_admin_quote_country_code_pattern():
    from app.api.admin.manual_bookings import AdminQuoteIn

    place = {"region_id": 1}
    base = {"pickup": place, "dropoff": place, "pickup_at": _now() + timedelta(days=2), "passenger_count": 2}
    assert AdminQuoteIn(**base, country_code="DE").country_code == "DE"
    with pytest.raises(ValidationError):
        AdminQuoteIn(**base, country_code="1!")


# --- REV-C-3 / REV-C-4: denetim gerekçesi ---------------------------------------------------------------------


def test_reason_keeps_system_ids_and_full_length():
    from app.services import audit

    text = "GA12ABCD1A2B3C4D ödemesi PayTR panelinden iade edildi"
    assert audit.scrub_reason(text) == text
    long_reason = "gerekçe " * 62  # 496 karakter: girdi sınırı (500) içinde
    assert audit.scrub_reason(long_reason) == long_reason
    # Gerçek IBAN yine temizlenir.
    assert "TR33" not in audit.scrub_reason("IBAN TR33 0006 1005 1978 6457 8413 26 hesabına")
    assert "TR330006100519786457841326" not in audit.scrub_reason("TR330006100519786457841326")


def test_reason_scrub_is_bounded_for_huge_input():
    import time

    from app.services import audit

    start = time.monotonic()
    out = audit.scrub_reason("a" * 200_000)
    assert time.monotonic() - start < 2
    assert len(out) <= audit.REASON_MAX_LENGTH + 1
