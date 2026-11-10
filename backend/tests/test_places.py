"""Adres arama, ilçe çözümleme ve gerçek noktaya göre fiyat (K-58; testte sahte adres sağlayıcısı)."""

from decimal import Decimal as D

import jwt
import pytest

from app import demo
from app.config import get_settings
from app.providers.places import PlaceDetails, normalize
from app.services import places
from tests.conftest import future, otp_login, random_phone, region_id, staff_headers


def place(client, query: str) -> dict:
    hits = client.get("/api/v1/places/autocomplete", params={"q": query}).json()
    assert hits, query
    r = client.get(f"/api/v1/places/{hits[0]['place_id']}")
    assert r.status_code == 200, r.text
    return r.json()


def quote(client, pickup: dict, dropoff: dict, **extra) -> dict:
    body = {"pickup": pickup, "dropoff": dropoff, "vehicle_type_code": "minivan", "pickup_at": future(72),
            "passenger_count": 2, "luggage_count": 1, **extra}
    return client.post("/api/v1/quotes", json=body).json()


def test_normalize_turkish():
    assert normalize("Muğla") == "mugla"
    assert normalize("İbradı") == "ibradi"
    assert normalize(" KAŞ ") == "kas"


def test_address_resolves_to_district_and_airport(client):
    hotel = place(client, "Rixos Downtown")
    assert hotel["region"]["code"] == "konyaalti"
    assert "Konyaaltı" in hotel["address"]
    airport = place(client, "Antalya Havalimanı")
    assert airport["region"]["code"] == "ayt"  # ilçe (Muratpaşa) değil havalimanı bölgesi
    assert place(client, "Ölüdeniz")["region"]["code"] == "fethiye"


def test_price_uses_exact_address_not_district(client):
    """K-58: fiyat seçilen gerçek noktalar arasındaki mesafeyle hesaplanır; aynı ilçedeki farklı
    adresler farklı fiyat alabilir, yalnızca ilçe seçilirse ilçe merkezi kullanılır."""
    airport = {"place_token": place(client, "Antalya Havalimanı")["place_token"]}
    kalkan = quote(client, airport, {"place_token": place(client, "Kalkan")["place_token"]})
    kas = quote(client, airport, {"place_token": place(client, "Kaş Merkez")["place_token"]})
    assert D(kalkan["legs"][0]["distance_km"]) > D(kas["legs"][0]["distance_km"]) > 100
    assert D(kalkan["total"]) > D(kas["total"])
    # Fiyat 5'in katına yuvarlanır (K-32).
    assert D(kalkan["total"]) % 5 == 0 and D(kas["total"]) % 5 == 0


def test_same_district_uses_real_points(client):
    kaleici = {"place_token": place(client, "Kaleiçi")["place_token"]}
    lara = {"place_token": place(client, "Lara Plajı")["place_token"]}
    q = quote(client, kaleici, lara)
    assert D(q["legs"][0]["distance_km"]) > 0
    assert q["total"] == "30.00"  # minimum fiyat
    same = client.post("/api/v1/quotes", json={"pickup": kaleici, "dropoff": kaleici, "vehicle_type_code": "minivan",
                                              "pickup_at": future(72), "passenger_count": 1})
    assert same.json()["error"]["code"] == "same_place"


def test_outside_service_area_rejected(client):
    hits = client.get("/api/v1/places/autocomplete", params={"q": "Taksim"}).json()
    r = client.get(f"/api/v1/places/{hits[0]['place_id']}")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "region_not_served"


def test_tampered_place_token_rejected(client):
    token = place(client, "Kalkan")["place_token"]
    payload = jwt.decode(token, options={"verify_signature": False})
    payload["rid"] = region_id(client, "muratpasa")  # daha ucuz ilçe
    forged = jwt.encode(payload, "baska-anahtar", algorithm="HS256")
    r = client.post("/api/v1/quotes", json={
        "pickup": {"region_id": region_id(client, "ayt")}, "dropoff": {"place_token": forged},
        "vehicle_type_code": "minivan", "pickup_at": future(72), "passenger_count": 1})
    assert r.json()["error"]["code"] == "place_token_invalid"
    # Bölge kimliği ne jeton ne bölge verilmeden kabul edilmez
    r = client.post("/api/v1/quotes", json={"pickup": {}, "dropoff": {"region_id": 1}, "vehicle_type_code": "minivan",
                                           "pickup_at": future(72), "passenger_count": 1})
    assert r.status_code == 422


def test_booking_stores_address_and_coordinates(client):
    headers = otp_login(client, random_phone())
    pickup = {"place_token": place(client, "Antalya Havalimanı")["place_token"]}
    dropoff = {"place_token": place(client, "Belek")["place_token"], "address": "Oda 214"}
    q = quote(client, pickup, dropoff)
    body = {"pickup": pickup, "dropoff": dropoff, "vehicle_type_code": "minivan", "pickup_at": future(72),
            "passenger_count": 2, "luggage_count": 1, "booking_type": "planli", "expected_total": q["total"],
            "passenger_name": "Anna Schmidt", "accept_disclosure": True, "accept_distance_sales": True}
    r = client.post("/api/v1/me/bookings", json=body, headers=headers)
    assert r.status_code == 201, r.text
    leg = r.json()["legs"][0]
    assert leg["dropoff_region"]["code"] == "serik"
    assert leg["dropoff_address"].endswith("(Oda 214)")


def test_district_name_fallback_to_nearest(db):
    # İlçe adı gelmezse en yakın ilçe merkezi seçilir.
    detail = PlaceDetails(place_id="x", address="x", lat=D("36.55"), lng=D("31.99"), district=None,
                          province="Antalya", is_airport=False)
    assert places.resolve_region(db, detail).code == "alanya"


def test_dev_otp_code_only_outside_prod(client, monkeypatch):
    r = client.post("/api/v1/auth/otp/request", json={"phone": random_phone()})
    assert r.json()["dev_code"] and len(r.json()["dev_code"]) == 6
    monkeypatch.setattr(get_settings(), "env", "prod")
    r = client.post("/api/v1/auth/otp/request", json={"phone": random_phone()})
    assert r.json()["dev_code"] is None


def test_staff_change_password(client, db):
    headers = staff_headers(client, db, ["operasyon"])
    r = client.post("/api/v1/auth/staff/password", headers=headers,
                    json={"current_password": "yanlis parola 123", "new_password": "yeni guvenli parola"})
    assert r.json()["error"]["code"] == "wrong_password"
    r = client.post("/api/v1/auth/staff/password", headers=headers,
                    json={"current_password": "correct horse battery", "new_password": "yeni guvenli parola"})
    assert r.status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    customer = otp_login(client, random_phone())
    assert client.post("/api/v1/auth/staff/password", headers=customer,
                       json={"current_password": "x", "new_password": "yeni guvenli parola"}).status_code == 401


def test_demo_seed_creates_bookable_drivers(client, db):
    demo.run(db)
    db.commit()
    assert "zaten var" in demo.run(db)[0]
    driver = otp_login(client, demo.DEMO_DRIVERS[0].phone, purpose="driver", country_code=None)
    me = client.get("/api/v1/driver/me", headers=driver).json()
    assert me["status"] == "onayli" and me["missing_documents"] == []
    assert client.post("/api/v1/driver/me/online", headers=driver, json={"is_online": True}).status_code == 200
