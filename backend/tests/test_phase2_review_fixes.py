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


def _provider(*, fail_refunds: bool = False):
    """Sahte sağlayıcı; iade çağrılarını kaydeder."""
    from dataclasses import dataclass, field

    from app.providers.payments import FakeProvider, get_payment_provider

    base = get_payment_provider()

    @dataclass
    class Recording(FakeProvider):
        calls: list = field(default_factory=list)

        def refund(self, merchant_oid, amount, reference=None):
            self.calls.append((merchant_oid, amount, reference))
            return super().refund(merchant_oid, amount, reference)

    return Recording(secret=base.secret, public_api_url=base.public_api_url, fail_refunds=fail_refunds)


def _rejected_charge(client, db, *, total: str | None = "", currency: str | None = None, fail_refunds: bool = True,
                     provider=None):
    """Ödeme sayfası açılmış ve imzası geçerli ama tutar/para birimi denetimine takılan başarılı bildirim almış
    rezervasyon. `total=None`: rezervasyon tutarı bildirilir. Varsayılan: tutar bildirilmemiş, iade başarısız
    (rezervasyon incelemede kalır)."""
    from app.models import Payment
    from app.services import payments as payment_service

    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    provider = provider or _provider(fail_refunds=fail_refunds)
    if total is None:
        total = str(int(payment.amount * 100))
    form = {"merchant_oid": oid, "status": "success", "total_amount": total,
            "hash": provider.sign(oid, "success", total)}
    if currency:
        form["currency"] = currency
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


# --- K-74: reddedilen başarılı bildirimde otomatik iade -------------------------------------------------------


def _charge_state(db, booking_id):
    from app.models import Payment, Refund

    payment = db.scalar(select(Payment).where(Payment.booking_id == booking_id))
    refunds = list(db.scalars(select(Refund).where(Refund.payment_id == payment.id)))
    return payment, refunds


def test_underpaid_charge_is_refunded_with_charged_amount(client, db):
    from decimal import Decimal

    from app.models.enums import PaymentStatus, RefundStatus

    provider = _provider()
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer)
    code = r.json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    from app.models import Payment
    from app.services import payments as payment_service

    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    charged = payment.amount - Decimal("10.00")
    total = str(int(charged * 100))
    payment_service.handle_callback(
        db, provider, {"merchant_oid": oid, "status": "success", "total_amount": total,
                       "hash": provider.sign(oid, "success", total)}, _now())
    db.commit()
    db.expire_all()

    payment, refunds = _charge_state(db, payment.booking_id)
    assert provider.calls == [(oid, charged, provider.calls[0][2])]
    assert len(refunds) == 1 and refunds[0].status is RefundStatus.COMPLETED
    assert refunds[0].amount == charged and refunds[0].refund_percent == 100
    # Ödeme hiç kabul edilmedi: FAILED kalır, ödenmiş sayılmaz.
    assert payment.status is PaymentStatus.FAILED


def test_charge_without_total_refunds_requested_amount(client, db):
    from app.models.enums import RefundStatus

    provider = _provider()
    _, _, booking_id = _rejected_charge(client, db, total="", provider=provider)
    payment, refunds = _charge_state(db, booking_id)
    assert [c[1] for c in provider.calls] == [payment.amount]
    assert refunds[0].status is RefundStatus.COMPLETED


def test_currency_mismatch_refunds_order_amount(client, db):
    """Başka para biriminde bildirilen tutar karşılaştırılamaz; sipariş tutarı (sipariş para biriminde) iade
    edilir, fazlası asla."""
    from app.models.enums import RefundStatus

    provider = _provider()
    _, _, booking_id = _rejected_charge(client, db, total="999999", currency="TL", provider=provider)
    payment, refunds = _charge_state(db, booking_id)
    assert payment.currency.value != "TRY"  # varsayılan EUR; TL bildirimi uyuşmazlıktır
    assert [c[1] for c in provider.calls] == [payment.amount]
    assert refunds[0].status is RefundStatus.COMPLETED


def test_failed_auto_refund_can_be_closed_by_admin_after_panel_refund(client, db):
    """Muhasebe parayı PayTR panelinden iade ettiyse admin açık onayla kapatır; rezervasyon incelemeden çıkar.
    Ödenmiş ödemenin başarısız iadesi bu yolla kapatılamaz (test_review_payment_fixes)."""
    from app.models.enums import PaymentStatus, RefundStatus
    from tests.conftest import staff_headers

    customer, code, booking_id = _rejected_charge(client, db, fail_refunds=True)
    _, refunds = _charge_state(db, booking_id)
    admin = staff_headers(client, db, ["admin"])
    url = f"{API}/admin/refunds/{refunds[0].id}/mark-completed"
    assert client.post(url, headers=admin, json={"confirmed": False}).status_code == 409
    r = client.post(url, headers=admin, json={"confirmed": True, "reference": "PANEL-1"})
    assert r.status_code == 200, r.text
    db.expire_all()
    payment, refunds = _charge_state(db, booking_id)
    assert refunds[0].status is RefundStatus.COMPLETED and payment.status is PaymentStatus.FAILED
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code in (200, 201), r.text


def test_refunded_rejected_charge_releases_booking(client, db):
    """İade tamamlanınca rezervasyon incelemeden çıkar: müşteri yeniden ödeyebilir, süre dolunca iptal edilir."""
    from app.models import Booking
    from app.models.enums import BookingStatus
    from app.services import jobs

    customer, code, booking_id = _rejected_charge(client, db, fail_refunds=False)
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code in (200, 201), r.text
    jobs.cancel_unpaid_bookings(db, _now() + timedelta(days=2))
    db.commit()
    db.expire_all()
    assert db.get(Booking, booking_id).status is BookingStatus.CANCELLED


def test_failed_auto_refund_keeps_review_and_retry_completes(client, db):
    from app.models.enums import PaymentStatus, RefundStatus
    from app.services import bookings

    customer, code, booking_id = _rejected_charge(client, db, fail_refunds=True)
    payment, refunds = _charge_state(db, booking_id)
    assert refunds[0].status is RefundStatus.FAILED
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code == 409 and "payment_under_review" in r.text

    # Muhasebe yeniden dener: aynı kayıt, ikinci iade açılmaz, ödeme FAILED kalır.
    bookings.retry_refund(db, refunds[0].id, _provider())
    db.commit()
    db.expire_all()
    payment, refunds = _charge_state(db, booking_id)
    assert len(refunds) == 1 and refunds[0].status is RefundStatus.COMPLETED
    assert payment.status is PaymentStatus.FAILED
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    assert r.status_code in (200, 201), r.text


def test_rejected_charge_refund_not_duplicated(client, db):
    """Aynı bildirim tekrar gelirse ikinci iade açılmaz; reddedilmiş ödemeye ek iade açılamaz."""
    from app.models import Payment
    from app.services import payments as payment_service

    provider = _provider()
    _, _, booking_id = _rejected_charge(client, db, provider=provider)
    payment, _ = _charge_state(db, booking_id)
    oid = payment.merchant_oid
    payment_service.handle_callback(
        db, provider, {"merchant_oid": oid, "status": "success", "total_amount": "",
                       "hash": provider.sign(oid, "success", "")}, _now())
    db.commit()
    db.expire_all()
    _, refunds = _charge_state(db, booking_id)
    assert len(refunds) == 1 and len(provider.calls) == 1
    assert db.scalar(select(Payment).where(Payment.merchant_oid == oid)) is not None


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
