"""K-76 kısa yolculukta en düşük ücret, K-77 on iki dil."""

from __future__ import annotations

import re
from decimal import Decimal as D

from sqlalchemy import select

from app import seed
from app.api.admin.manual_bookings import _PAY, _SHARE, SHARE_LOCALES
from app.api.schemas import SUPPORTED_LOCALES
from app.models import MeetingGuide, NotificationTemplate, Region
from app.models.enums import RegionType
from app.services.otp import OTP_TEXT
from app.services.trip_updates import CUSTOMER_TEXTS
from tests.test_places import future, place, quote

TWELVE = {"tr", "en", "de", "es", "ru", "fr", "ar", "zh", "ja", "it", "pt", "ko"}


def _vars(text: str) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", text))


def test_twelve_supported_locales():
    assert set(SUPPORTED_LOCALES) == TWELVE
    assert set(SHARE_LOCALES) == TWELVE


def test_trip_notifications_cover_every_language_with_same_placeholders():
    for code, texts in CUSTOMER_TEXTS.items():
        assert set(texts) == TWELVE, code
        title_vars, body_vars = _vars(texts["en"][0]), _vars(texts["en"][1])
        for lang, (title, body) in texts.items():
            assert (_vars(title), _vars(body)) == (title_vars, body_vars), (code, lang)


def test_otp_share_and_pay_texts_cover_every_language():
    assert set(OTP_TEXT) == TWELVE
    assert all(_vars(t) == {"code"} for t in OTP_TEXT.values())
    assert set(_SHARE) == TWELVE and set(_PAY) == TWELVE
    for lang in TWELVE:
        assert _vars(_SHARE[lang]) == _vars(_SHARE["en"]), lang
        assert [_vars(t) for t in _PAY[lang]] == [_vars(t) for t in _PAY["en"]], lang


def test_seed_templates_and_guide_steps_cover_every_language():
    for code in ("booking_confirmed", "booking_created_admin"):
        rows = {loc: body for c, loc, _ch, body in seed.TEMPLATES if c == code}
        assert set(rows) == TWELVE, code
        assert all(_vars(b) == _vars(rows["en"]) for b in rows.values()), code
    assert all(set(step) == TWELVE for step in seed.GUIDE_STEPS)


def test_seed_backfills_new_languages_only_on_unchanged_default_steps(db):
    region = db.scalar(select(Region).where(Region.type == RegionType.AIRPORT).limit(1))
    old = [{k: v for k, v in s.items() if k in ("tr", "en", "de", "ru")} for s in seed.GUIDE_STEPS]
    custom = {"tr": "Admin'in yazdığı adım", "en": "Custom step"}
    guide = MeetingGuide(region_id=region.id, terminal="K77 test", steps=[
        {"texts": old[0], "photo_key": None},
        {"texts": custom, "photo_key": None},
    ])
    db.add(guide)
    db.flush()
    seed.run(db)
    db.refresh(guide)
    assert set(guide.steps[0]["texts"]) == TWELVE
    assert guide.steps[0]["texts"]["ja"] == seed.GUIDE_STEPS[0]["ja"]
    assert guide.steps[1]["texts"] == custom
    assert db.scalar(select(NotificationTemplate.id).where(
        NotificationTemplate.code == "booking_confirmed", NotificationTemplate.locale == "ko")) is not None


def test_short_trip_is_accepted_at_minimum_fare(client):
    """K-76: Taksim → Sultanahmet birkaç km; taksimetre gibi km'den değil, 30 € en düşük ücretle fiyatlanır."""
    taksim = {"place_token": place(client, "Taksim")["place_token"]}
    sultanahmet = {"place_token": place(client, "Sultanahmet")["place_token"]}
    q = quote(client, taksim, sultanahmet, country_code="DE")
    assert D(q["legs"][0]["distance_km"]) * D("1.10") * D("1.30") < D("30")
    assert (q["currency"], D(q["total"])) == ("EUR", D("30.00"))


def test_short_round_trip_never_drops_below_minimum_per_leg(client):
    taksim = {"place_token": place(client, "Taksim")["place_token"]}
    sultanahmet = {"place_token": place(client, "Sultanahmet")["place_token"]}
    q = quote(client, taksim, sultanahmet, country_code="DE", return_pickup_at=future(76))
    # Gidiş-dönüş indirimi (%5) 60 €'yu 57 €'ya indirirdi; taban bacak başına 30 €.
    assert D(q["total"]) == D("60.00")
    assert [D(leg["price"]) for leg in q["legs"]] == [D("30.00"), D("30.00")]
