"""Buluşma deneyimi (K-62): ekstralar, yolcu durumu, buluşma rehberi, sürücü kartı, girişsiz takip,
sohbet çevirisi, puan ve bahşiş."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models import BookingLeg, DriverLedger, Payment, TripRating
from app.providers import translation
from app.services import meeting, messages
from tests.conftest import booking_body, otp_login, pay, random_phone
from tests.test_api_driver_admin import onboard_driver, ops  # noqa: F401 - fikstür

API = "/api/v1"


def _png() -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    img = Image.new("RGB", (40, 30), (200, 30, 30))
    exif = Image.Exif()
    exif[0x010F] = "SecretPhoneMaker"  # Make: yeniden kodlamada silinmeli
    img.save(out, format="PNG", exif=exif)
    return out.getvalue()


PNG = _png()
JPEG_MAGIC = b"\xff\xd8\xff"


def _setup(client, ops_headers, *, hours_ahead=6, **extra):
    driver, _ = onboard_driver(client, ops_headers, online=False)
    customer = otp_login(client, random_phone())
    r = client.post(f"{API}/me/bookings", headers=customer, json=booking_body(client, hours_ahead=hours_ahead, **extra))
    assert r.status_code == 201, r.text
    code = r.json()["booking_code"]
    pay(client, customer, code)
    job = next(j for j in client.get(f"{API}/driver/jobs", headers=driver).json() if j["booking_code"] == code)
    trip = client.post(f"{API}/driver/jobs/{job['leg_id']}/accept", headers=driver)
    assert trip.status_code == 200, trip.text
    return driver, customer, code, job, trip.json()


def _codes(client, headers, who="me"):
    return [u["code"] for u in client.get(f"{API}/{'me' if who == 'me' else 'driver'}/updates", headers=headers).json()]


def _event(client, driver, leg_id, event, point=None):
    body = {"event": event}
    if point:
        body.update(lat=point[0], lng=point[1])
    r = client.post(f"{API}/driver/trips/{leg_id}/events", headers=driver, json=body)
    assert r.status_code == 200, r.text


def _complete(client, driver, leg_id):
    kemer = next(x for x in client.get(f"{API}/regions").json() if x["code"] == "kemer")
    for event in ("yola_cikti", "vardi", "basladi"):
        _event(client, driver, leg_id, event)
    _event(client, driver, leg_id, "bitti", (float(kemer["latitude"]), float(kemer["longitude"])))


def test_extras_reach_driver_and_are_validated(client, ops):
    customer = otp_login(client, random_phone())
    bad = booking_body(client, child_seat_count=3, passenger_count=2)
    r = client.post(f"{API}/me/bookings", headers=customer, json=bad)
    assert r.json()["error"]["code"] == "child_seats_exceed_passengers"

    driver, customer, code, job, trip = _setup(client, ops, child_seat_count=1, market_stop=True)
    assert job["child_seat_count"] == 1 and job["market_stop"] is True
    assert trip["child_seat_count"] == 1 and trip["market_stop"] is True and trip["customer_locale"] == "de"
    b = client.get(f"{API}/me/bookings/{code}", headers=customer).json()
    assert b["child_seat_count"] == 1 and b["market_stop"] is True


def test_passenger_status_and_meeting_guide(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops)
    leg_id = trip["leg_id"]

    guide = client.get(f"{API}/me/bookings/{code}/meeting-guide", headers=customer).json()
    assert guide["airport"] == "Antalya Havalimanı" and guide["guides"]
    assert "Passkontrolle" in guide["guides"][0]["steps"][0]["text"]  # rezervasyon dili (de)
    assert "passport" in client.get(f"{API}/me/bookings/{code}/meeting-guide", headers=customer,
                                    params={"lang": "en"}).json()["guides"][0]["steps"][0]["text"]

    r = client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "indi"})
    assert r.status_code == 200 and r.json()["passenger_status"] == "indi", r.text
    client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "indi"})
    client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "cikiyor"})
    # Geri dönüş (bagajda) yok sayılır, bildirim üretmez.
    r = client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "bagajda"})
    assert r.json()["passenger_status"] == "cikiyor"
    driver_codes = _codes(client, driver, "driver")
    assert driver_codes.count("passenger_landed") == 1 and "passenger_exiting" in driver_codes
    assert "passenger_baggage" not in driver_codes
    assert client.get(f"{API}/driver/trips/{leg_id}", headers=driver).json()["passenger_status"] == "cikiyor"
    # Rehber "İndim" ile bir kez gider; sürücü "Vardım" deyince tekrar gitmez.
    _event(client, driver, leg_id, "yola_cikti")
    _event(client, driver, leg_id, "vardi")
    assert _codes(client, customer).count("meeting_guide") == 1

    r = client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "uçtum"})
    assert r.status_code == 422


def test_passenger_status_too_early_and_guide_on_arrival(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops, hours_ahead=72)
    r = client.post(f"{API}/me/bookings/{code}/passenger-status", headers=customer, json={"status": "indi"})
    assert r.json()["error"]["code"] == "too_early"
    _event(client, driver, trip["leg_id"], "yola_cikti")
    _event(client, driver, trip["leg_id"], "vardi")
    assert "meeting_guide" in _codes(client, customer)


def test_driver_card_photo_languages_and_day_before_job(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops, hours_ahead=40)
    r = client.put(f"{API}/driver/me/profile", headers=driver, json={"languages": ["tr", "EN", "de"]})
    assert r.status_code == 200 and r.json()["languages"] == ["tr", "en", "de"], r.text
    assert client.put(f"{API}/driver/me/profile", headers=driver,
                      json={"languages": ["xx"]}).json()["error"]["code"] == "invalid_language"
    vehicle_id = client.get(f"{API}/driver/vehicles", headers=driver).json()[0]["id"]
    assert client.patch(f"{API}/driver/vehicles/{vehicle_id}", headers=driver,
                        json={"color": "Siyah"}).json()["color"] == "Siyah"

    r = client.post(f"{API}/driver/me/photo", headers=driver, files={"file": ("a.png", b"not-a-png", "image/png")})
    assert r.json()["error"]["code"] == "invalid_file_type"
    r = client.post(f"{API}/driver/me/photo", headers=driver, files={"file": ("a.png", PNG, "image/png")})
    assert r.status_code == 200 and r.json()["has_photo"] is True, r.text

    brief = client.get(f"{API}/me/bookings/{code}", headers=customer).json()["legs"][0]["driver"]
    assert brief == {"first_name": "Mehmet", "vehicle": "Mercedes Vito", "plate": brief["plate"], "color": "Siyah",
                     "languages": ["tr", "en", "de"], "has_photo": True}
    photo = client.get(f"{API}/me/bookings/{code}/driver-photo", headers=customer)
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert photo.content.startswith(JPEG_MAGIC) and b"SecretPhoneMaker" not in photo.content  # EXIF silindi

    # 40 saat kala atandı: kart henüz gitmedi; alışa 24 saatten az kalınca bir kez gider.
    now = datetime.now(timezone.utc)
    assert "driver_card" not in _codes(client, customer)
    meeting.send_driver_cards(db, now)
    db.commit()
    assert "driver_card" not in _codes(client, customer)
    assert meeting.send_driver_cards(db, now + timedelta(hours=17)) >= 1
    db.commit()
    assert meeting.send_driver_cards(db, now + timedelta(hours=18)) == 0
    db.commit()
    card = next(u for u in client.get(f"{API}/me/updates", headers=customer).json() if u["code"] == "driver_card")
    assert "Siyah Mercedes Vito" in card["body"] and "TR, EN, DE" in card["body"]


def test_share_link_shows_limited_info_and_can_be_revoked(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops)
    r = client.post(f"{API}/me/bookings/{code}/share", headers=customer)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert r.json()["url"].endswith(f"/track/{token}")
    assert client.post(f"{API}/me/bookings/{code}/share", headers=customer).json()["token"] == token

    t = client.get(f"{API}/track/{token}")
    assert t.status_code == 200, t.text
    body = t.json()
    assert body["status"] == "atandi" and body["driver"]["first_name"] == "Mehmet" and body["location"] is None
    flat = str(body)
    assert "Anna" not in flat and "Otel Örnek" not in flat and code not in flat
    assert client.get(f"{API}/track/{token}/driver-photo").json()["error"]["code"] == "photo_missing"

    _event(client, driver, trip["leg_id"], "yola_cikti", (36.95, 30.85))
    body = client.get(f"{API}/track/{token}").json()
    assert body["status"] == "yolda" and body["location"]["lat"] == 36.95

    assert client.delete(f"{API}/me/bookings/{code}/share", headers=customer).status_code == 204
    assert client.get(f"{API}/track/{token}").json()["error"]["code"] == "track_not_found"
    assert client.get(f"{API}/track/short").status_code == 404


def test_chat_is_translated_for_the_recipient(client, db, ops, monkeypatch):
    fake = translation.FakeTranslator()
    monkeypatch.setattr(messages, "get_translator", lambda: fake)
    driver, customer, code, _, trip = _setup(client, ops)
    r = client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "de: Ich bin am Ausgang"})
    assert r.json()["translated_body"] == "[tr] de: Ich bin am Ausgang" and r.json()["translated_lang"] == "tr"
    r = client.post(f"{API}/driver/trips/{trip['leg_id']}/messages", headers=driver, json={"body": "tr: Geliyorum"})
    assert r.json()["translated_lang"] == "de"
    # Metin zaten alıcının dilindeyse çeviri saklanmaz.
    r = client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "tr: Merhaba"})
    assert r.json()["translated_body"] is None
    chat = client.get(f"{API}/driver/trips/{trip['leg_id']}/messages", headers=driver).json()
    assert chat["messages"][0]["translated_body"].startswith("[tr]")
    push = next(u for u in client.get(f"{API}/driver/updates", headers=driver).json() if u["code"] == "new_message")
    assert push["body"].startswith("[tr]")
    # Telefon ve e-posta çeviri servisine gönderilmez, çeviride aynen yerine konur.
    r = client.post(f"{API}/me/bookings/{code}/messages", headers=customer,
                    json={"body": "de: Ruf mich an +49 170 1234567 oder anna@example.com"})
    sent = fake.calls[-1][0]
    assert "+49" not in sent and "anna@" not in sent
    assert "+49 170 1234567" in r.json()["translated_body"] and "anna@example.com" in r.json()["translated_body"]
    # Servis hata verirse mesaj çevrilmeden gider.
    fake.fail = True
    r = client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Hallo"})
    assert r.status_code == 201 and r.json()["translated_body"] is None


def test_turkish_booking_skips_translation(client, ops, monkeypatch):
    fake = translation.FakeTranslator()
    monkeypatch.setattr(messages, "get_translator", lambda: fake)
    driver, customer, code, _, trip = _setup(client, ops, locale="tr")
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Merhaba"})
    assert fake.calls == []


def test_rating_and_tip_go_to_driver(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops)
    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer, json={"stars": 5})
    assert r.json()["error"]["code"] == "nothing_to_rate"
    _complete(client, driver, trip["leg_id"])

    state = client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()
    assert state["rated"] is False and state["currency"] == "EUR" and state["tip_suggestions"] == ["5.00", "10.00", "20.00"]
    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer,
                    json={"stars": 5, "comment": "Çok kibar", "tip_amount": "500"})
    assert r.json()["error"]["code"] == "tip_too_large"
    assert db.scalar(select(TripRating).where(TripRating.booking_leg_id == trip["leg_id"])) is None  # geri alındı

    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer,
                    json={"stars": 5, "comment": "Çok kibar", "tip_amount": "10"})
    assert r.status_code == 201, r.text
    assert r.json()["tip_status"] == "beklemede" and r.json()["iframe_url"]
    assert client.post(f"{API}/me/bookings/{code}/rating", headers=customer,
                       json={"stars": 4}).json()["error"]["code"] == "already_rated"
    assert "trip_rated" in _codes(client, driver, "driver")

    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    assert client.post(f"{API}/payments/fake/{oid}/complete", data={"status": "success"}).status_code == 200
    db.expire_all()
    ledgers = list(db.scalars(select(DriverLedger).where(DriverLedger.booking_leg_id == trip["leg_id"])))
    tip = next(x for x in ledgers if x.kind == "tip")
    assert tip.net_amount == Decimal("10.00") and tip.commission_amount == 0 and len(ledgers) == 2
    assert client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()["tip_status"] == "odendi"
    assert "tip_received" in _codes(client, driver, "driver")
    assert client.post(f"{API}/me/bookings/{code}/tip", headers=customer,
                       json={"amount": "5"}).json()["error"]["code"] == "tip_already_paid"
    me = client.get(f"{API}/driver/me", headers=driver).json()
    assert me["rating_count"] == 1 and me["rating_avg"] == "5.0"
    # Bahşiş rezervasyon iadesinin hedefi olmaz.
    from app.models import Booking
    from app.services import bookings
    booking = db.scalar(select(Booking).where(Booking.booking_code == code))
    assert bookings.paid_payment(db, booking).purpose == "booking"


def test_failed_tip_can_be_retried(client, db, ops):
    driver, customer, code, _, trip = _setup(client, ops)
    _complete(client, driver, trip["leg_id"])
    assert client.post(f"{API}/me/bookings/{code}/tip", headers=customer,
                       json={"amount": "5"}).json()["error"]["code"] == "rating_required"
    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer, json={"stars": 4, "tip_amount": "5"})
    oid = r.json()["iframe_url"].rsplit("/", 1)[1]
    client.post(f"{API}/payments/fake/{oid}/complete", data={"status": "failed"})
    assert client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()["tip_status"] == "basarisiz"
    r = client.post(f"{API}/me/bookings/{code}/tip", headers=customer, json={"amount": "7.50"})
    assert r.status_code == 200 and r.json()["tip_amount"] == "7.50", r.text
    db.expire_all()
    assert db.scalar(select(Payment).where(Payment.merchant_oid == oid)).status.value == "basarisiz"


def test_admin_manages_meeting_guides(client, db, ops):
    regions = client.get(f"{API}/regions").json()
    gzp = next(r["id"] for r in regions if r["code"] == "gzp")
    kemer = next(r["id"] for r in regions if r["code"] == "kemer")
    step = {"texts": {"tr": "Çıkışa yürüyün", "en": "Walk to the exit"}}
    r = client.post(f"{API}/admin/meeting-guides", headers=ops, json={"region_id": kemer, "steps": [step]})
    assert r.json()["error"]["code"] == "guide_region_invalid"
    r = client.post(f"{API}/admin/meeting-guides", headers=ops,
                    json={"region_id": gzp, "terminal": "Dış Hatlar", "steps": [step, step]})
    assert r.status_code == 201, r.text
    gid = r.json()["id"]
    r = client.post(f"{API}/admin/meeting-guides", headers=ops,
                    json={"region_id": gzp, "terminal": "Dış Hatlar", "steps": [step]})
    assert r.json()["error"]["code"] == "guide_exists"

    r = client.post(f"{API}/admin/meeting-guides/{gid}/steps/1/photo", headers=ops,
                    files={"file": ("s.png", PNG, "image/png")})
    assert r.status_code == 200 and r.json()["steps"][1]["has_photo"] is True, r.text
    photo = client.get(f"{API}{r.json()['steps'][1]['photo_path'].removeprefix('/api/v1')}")
    assert photo.status_code == 200 and photo.content.startswith(JPEG_MAGIC)
    # Adım sırası değişince fotoğraf adımıyla birlikte gider (photo_from).
    r = client.put(f"{API}/admin/meeting-guides/{gid}", headers=ops, json={
        "region_id": gzp, "terminal": "Dış Hatlar", "steps": [{**step, "photo_from": 1}, {**step, "photo_from": 0}]})
    assert [x["has_photo"] for x in r.json()["steps"]] == [True, False]
    # Adım silinince fotoğrafı da gider.
    r = client.put(f"{API}/admin/meeting-guides/{gid}", headers=ops,
                   json={"region_id": gzp, "terminal": "Dış Hatlar", "steps": [step]})
    assert r.status_code == 200 and len(r.json()["steps"]) == 1
    assert client.get(f"{API}/meeting-guides/{gid}/photos/0").status_code == 200
    r = client.put(f"{API}/admin/meeting-guides/{gid}", headers=ops,
                   json={"region_id": gzp, "terminal": "Dış Hatlar", "steps": [{**step, "photo_from": None}]})
    assert client.get(f"{API}/meeting-guides/{gid}/photos/0").status_code == 404
    support = client.get(f"{API}/admin/meeting-guides", headers=ops).json()
    assert any(g["id"] == gid for g in support)


def test_leg_columns_reset_on_reassignment(db):
    leg = BookingLeg(pickup_at=datetime.now(timezone.utc) + timedelta(hours=48))
    meeting.on_assigned(leg, datetime.now(timezone.utc))
    assert leg.driver_card_sent_at is None
    leg.pickup_at = datetime.now(timezone.utc) + timedelta(hours=5)
    meeting.on_assigned(leg, datetime.now(timezone.utc))
    assert leg.driver_card_sent_at is not None


def test_translation_skipped_when_driver_speaks_language_and_budget(client, ops, monkeypatch):
    from app.config import get_settings

    fake = translation.FakeTranslator()
    monkeypatch.setattr(messages, "get_translator", lambda: fake)
    driver, customer, code, _, trip = _setup(client, ops)
    client.put(f"{API}/driver/me/profile", headers=driver, json={"languages": ["tr", "de"]})
    client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Hallo"})
    client.post(f"{API}/driver/trips/{trip['leg_id']}/messages", headers=driver, json={"body": "Hallo"})
    assert fake.calls == []  # sürücü Almanca konuşuyor

    client.put(f"{API}/driver/me/profile", headers=driver, json={"languages": ["tr"]})
    monkeypatch.setattr(get_settings(), "translation_daily_char_limit", 0)
    r = client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "Hallo"})
    assert r.status_code == 201 and r.json()["translated_body"] is None and fake.calls == []

    def broken():
        raise RuntimeError("anahtar yok")
    monkeypatch.setattr(messages, "get_translator", broken)
    assert client.post(f"{API}/me/bookings/{code}/messages", headers=customer, json={"body": "x"}).status_code == 201


def test_open_tip_page_is_reused_and_stale_paid_page_is_handled(client, db, ops):
    """Aynı tutarda ikinci sayfa açılmaz; yerine yenisi açılmış eski sayfa ödenirse bahşiş sayılır,
    bahşiş zaten ödendiyse sonraki ödeme müşteriye iade edilir."""
    from app.models.enums import RefundStatus

    driver, customer, code, _, trip = _setup(client, ops)
    _complete(client, driver, trip["leg_id"])
    first = client.post(f"{API}/me/bookings/{code}/rating", headers=customer, json={"stars": 5, "tip_amount": "5"})
    again = client.post(f"{API}/me/bookings/{code}/tip", headers=customer, json={"amount": "5"})
    assert first.json()["iframe_url"] == again.json()["iframe_url"]
    second = client.post(f"{API}/me/bookings/{code}/tip", headers=customer, json={"amount": "10"})
    old_oid = first.json()["iframe_url"].rsplit("/", 1)[1]
    new_oid = second.json()["iframe_url"].rsplit("/", 1)[1]
    assert old_oid != new_oid

    client.post(f"{API}/payments/fake/{old_oid}/complete", data={"status": "success"})
    state = client.get(f"{API}/me/bookings/{code}/rating", headers=customer).json()
    assert state["tip_status"] == "odendi" and state["tip_amount"] == "5.00"
    client.post(f"{API}/payments/fake/{new_oid}/complete", data={"status": "success"})
    db.expire_all()
    tips = list(db.scalars(select(DriverLedger).where(DriverLedger.booking_leg_id == trip["leg_id"],
                                                      DriverLedger.kind == "tip")))
    assert len(tips) == 1 and tips[0].net_amount == Decimal("5.00")
    dup = db.scalar(select(Payment).where(Payment.merchant_oid == new_oid))
    assert dup.refunds and dup.refunds[0].amount == Decimal("10.00") and dup.refunds[0].status is not RefundStatus.FAILED


def test_tip_minimum(client, ops):
    driver, customer, code, _, trip = _setup(client, ops)
    _complete(client, driver, trip["leg_id"])
    r = client.post(f"{API}/me/bookings/{code}/rating", headers=customer, json={"stars": 4, "tip_amount": "0.50"})
    assert r.json()["error"]["code"] == "tip_invalid"
