"""K-78: sürücü detayları (kimlik, ehliyet, adli sicil, D2, TÜRSAB, WhatsApp, il) ve araç detayları
(dört fotoğraf, ruhsat, muayene, sigorta); admin onayı."""

from __future__ import annotations

from tests.conftest import PDF, otp_login, random_phone, staff_headers
from tests.test_api_driver_admin import DRIVER_DOCS, NEXT_YEAR, PNG, VEHICLE_DOCS, ops, upload  # noqa: F401

API = "/api/v1"


def _driver(client, **extra):
    headers = otp_login(client, random_phone(), purpose="driver", country_code=None)
    r = client.post(f"{API}/driver/register", headers=headers, json={"full_name": "Ali Veli", **extra})
    assert r.status_code == 201, r.text
    return headers, r.json()


def _vehicle(client, headers, plate="07 KZ 7878"):
    r = client.post(f"{API}/driver/vehicles", headers=headers, json={
        "plate": plate, "vehicle_type_code": "minivan", "brand": "Mercedes-Benz", "model": "Vito", "capacity": 6})
    assert r.status_code == 201, r.text
    return r.json()


def _post(client, headers, doc_type, *, file=("belge.pdf", PDF, "application/pdf"), valid_until=None, vehicle_id=None):
    data = {"doc_type": doc_type}
    if valid_until:
        data["valid_until"] = valid_until
    if vehicle_id:
        data["vehicle_id"] = vehicle_id
    return client.post(f"{API}/driver/documents", headers=headers, data=data, files={"file": file})


def test_register_keeps_driver_details_and_lists_new_requirements(client):
    headers, me = _driver(client, whatsapp_phone="+90 532 111 22 33", operating_province="mugla")
    assert me["whatsapp_phone"] == "+905321112233"
    assert me["operating_province"] == "mugla"
    assert me["phone"].startswith("+")
    assert set(me["missing_documents"]) == set(DRIVER_DOCS)
    v = _vehicle(client, headers)
    assert set(v["missing_documents"]) == set(VEHICLE_DOCS)


def test_contact_update_validates_province_and_clears_whatsapp(client):
    headers, _ = _driver(client)
    r = client.put(f"{API}/driver/me/contact", headers=headers,
                   json={"whatsapp_phone": "05321112233", "operating_province": "istanbul"})
    assert r.status_code == 200, r.text
    assert (r.json()["whatsapp_phone"], r.json()["operating_province"]) == ("+905321112233", "istanbul")
    r = client.put(f"{API}/driver/me/contact", headers=headers, json={"whatsapp_phone": "", "operating_province": "trabzon"})
    assert r.status_code == 422
    r = client.put(f"{API}/driver/me/contact", headers=headers, json={"whatsapp_phone": "", "operating_province": None})
    assert (r.json()["whatsapp_phone"], r.json()["operating_province"]) == (None, None)


def test_expiring_documents_need_a_date(client):
    headers, _ = _driver(client)
    for doc_type in ("kimlik", "surucu_belgesi", "d2_yetki_belgesi", "tursab_belgesi"):
        r = _post(client, headers, doc_type)
        assert r.status_code == 400 and r.json()["error"]["code"] == "valid_until_required", doc_type
    # Adli sicil kaydının süresi yoktur.
    assert _post(client, headers, "adli_sicil").status_code == 201


def test_vehicle_photos_are_images_and_documents_match_owner(client):
    headers, _ = _driver(client)
    v = _vehicle(client, headers, "07 KZ 7879")
    r = _post(client, headers, "arac_foto_dis", vehicle_id=v["id"])
    assert r.json()["error"]["code"] == "photo_required"
    r = _post(client, headers, "arac_foto_dis", vehicle_id=v["id"], file=("on.png", PNG, "image/png"))
    assert r.status_code == 201
    # Sürücü kendi araç fotoğrafını görür; başka sürücü göremez, kişisel belge geri verilmez.
    photo = client.get(f"{API}/driver/documents/{r.json()['id']}/file", headers=headers)
    # Tam dosya değil, küçük resim (JPEG) döner.
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert photo.content[:3] == bytes.fromhex("ffd8ff")
    other, _ = _driver(client)
    assert client.get(f"{API}/driver/documents/{r.json()['id']}/file", headers=other).status_code == 404
    sicil = _post(client, headers, "adli_sicil").json()["id"]
    assert client.get(f"{API}/driver/documents/{sicil}/file", headers=headers).status_code == 404
    # Kimlik araca, ruhsat sürücüye yüklenemez.
    r = _post(client, headers, "kimlik", valid_until=NEXT_YEAR, vehicle_id=v["id"])
    assert r.json()["error"]["code"] == "invalid_document_owner"
    r = _post(client, headers, "arac_ruhsati")
    assert r.json()["error"]["code"] == "invalid_document_owner"


def test_admin_approves_undated_documents_but_not_expiring_ones_without_a_date(client, db, ops):
    headers, me = _driver(client)
    sicil = _post(client, headers, "adli_sicil").json()["id"]
    r = client.post(f"{API}/admin/documents/{sicil}/review", headers=ops, json={"decision": "onayli"})
    assert r.status_code == 200, r.text
    # Süreli belge tarihle yüklenir; admin tarihi silemez ama değiştirebilir.
    kimlik = upload(client, headers, "kimlik")
    r = client.post(f"{API}/admin/documents/{kimlik}/review", headers=ops, json={"decision": "onayli"})
    assert r.status_code == 200, r.text
    r = client.get(f"{API}/admin/drivers/{me['id']}", headers=ops)
    missing = r.json()["missing_documents"]
    assert "adli_sicil" not in missing and "kimlik" not in missing


def test_full_application_can_be_approved(client, db, ops):
    headers, me = _driver(client, operating_province="antalya")
    v = _vehicle(client, headers, "07 KZ 7880")
    ids = [upload(client, headers, t) for t in DRIVER_DOCS] + [upload(client, headers, t, v["id"]) for t in VEHICLE_DOCS]
    for doc_id in ids:
        r = client.post(f"{API}/admin/documents/{doc_id}/review", headers=ops, json={"decision": "onayli"})
        assert r.status_code == 200, r.text
    assert client.post(f"{API}/admin/vehicles/{v['id']}/status", headers=ops, json={"status": "aktif"}).status_code == 200
    r = client.post(f"{API}/admin/drivers/{me['id']}/status", headers=ops, json={"status": "onayli"})
    assert r.status_code == 200, r.text
    detail = client.get(f"{API}/admin/drivers/{me['id']}", headers=ops).json()
    assert detail["operating_province"] == "antalya" and detail["missing_documents"] == []
    assert staff_headers  # içe aktarılan yardımcı kullanılıyor (ops fikstürü)


def test_tourism_permit_fits_either_owner(client):
    headers, _ = _driver(client)
    v = _vehicle(client, headers, "07 KZ 7881")
    assert _post(client, headers, "turizm_tasimacilik_yetki", vehicle_id=v["id"]).status_code == 201
    assert _post(client, headers, "turizm_tasimacilik_yetki").status_code == 201


def test_required_document_settings_reject_wrong_owner(client, db):
    admin = staff_headers(client, db, ["admin"])
    url = f"{API}/admin/settings/required_vehicle_documents"
    r = client.put(url, headers=admin, json={"value": ["arac_ruhsati", "kimlik"]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_setting_value"
    r = client.put(url, headers=admin, json={"value": ["arac_ruhsati", "yok_boyle"]})
    assert r.json()["error"]["code"] == "invalid_setting_value"
    r = client.put(f"{API}/admin/settings/required_driver_documents", headers=admin, json={"value": ["arac_sigortasi"]})
    assert r.json()["error"]["code"] == "invalid_setting_value"
    # Geçerli liste kaydedilir; ayar paylaşılan durum olduğundan test sonunda varsayılana döner.
    try:
        r = client.put(url, headers=admin, json={"value": ["arac_ruhsati", "turizm_tasimacilik_yetki"]})
        assert r.status_code == 200, r.text
    finally:
        client.put(url, headers=admin, json={"value": VEHICLE_DOCS})


def test_admin_detail_masks_whatsapp(client, db, ops):
    headers, me = _driver(client, whatsapp_phone="+905321112233")
    detail = client.get(f"{API}/admin/drivers/{me['id']}", headers=ops).json()
    assert detail["whatsapp_phone"] != "+905321112233" and detail["whatsapp_phone"].endswith("33")
