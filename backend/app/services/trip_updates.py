"""Yolculuk bildirimleri (K-51): sürücü kabul etti, yolda, yaklaşıyor, geldi, yeni mesaj...

Her bildirim `trip_updates` akışına yazılır; mobil uygulama bu akışı yoklayıp yerel bildirim
gösterir. Alıcının push jetonu varsa ve push sağlayıcısı (FCM) açıksa aynı metin push olarak
da gönderilir. Push hatası işlemi bozmaz.

Metinler alıcının dilinde üretilir: müşteri için rezervasyon dili (tr, en, de, ru), sürücü için tr.
Bildirimde telefon, adres veya ödeme bilgisi yer almaz.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models import BookingLeg, TripUpdate
from app.services import push_outbox

class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""


# kod -> dil -> (başlık, gövde)
CUSTOMER_TEXTS: dict[str, dict[str, tuple[str, str]]] = {
    "driver_assigned": {
        "tr": ("Sürücünüz belli oldu", "{driver}, {vehicle} ({plate}) ile sizi karşılayacak."),
        "en": ("Your driver is confirmed", "{driver} will pick you up in a {vehicle} ({plate})."),
        "de": ("Ihr Fahrer steht fest", "{driver} holt Sie mit einem {vehicle} ({plate}) ab."),
        "ru": ("Водитель назначен", "{driver} заберёт вас на {vehicle} ({plate})."),
    },
    "driver_en_route": {
        "tr": ("Sürücünüz yola çıktı", "{driver} alış noktasına geliyor. Tahmini varış {eta} dk."),
        "en": ("Your driver is on the way", "{driver} is heading to your pickup. About {eta} min away."),
        "de": ("Ihr Fahrer ist unterwegs", "{driver} ist auf dem Weg zu Ihnen. Etwa {eta} Min."),
        "ru": ("Водитель в пути", "{driver} едет к месту посадки. Примерно {eta} мин."),
    },
    "driver_en_route_noeta": {
        "tr": ("Sürücünüz yola çıktı", "{driver} alış noktasına geliyor."),
        "en": ("Your driver is on the way", "{driver} is heading to your pickup."),
        "de": ("Ihr Fahrer ist unterwegs", "{driver} ist auf dem Weg zu Ihnen."),
        "ru": ("Водитель в пути", "{driver} едет к месту посадки."),
    },
    "driver_eta": {
        "tr": ("Sürücünüz {eta} dk uzakta", "{vehicle} · {plate}"),
        "en": ("Your driver is {eta} min away", "{vehicle} · {plate}"),
        "de": ("Ihr Fahrer ist {eta} Min. entfernt", "{vehicle} · {plate}"),
        "ru": ("Водитель в {eta} мин от вас", "{vehicle} · {plate}"),
    },
    "driver_approaching": {
        "tr": ("Sürücünüz yaklaşıyor", "Yaklaşık {eta} dk içinde alış noktasında. Hazır olun."),
        "en": ("Your driver is almost there", "Arriving in about {eta} min. Please get ready."),
        "de": ("Ihr Fahrer ist gleich da", "Ankunft in etwa {eta} Min. Bitte halten Sie sich bereit."),
        "ru": ("Водитель почти на месте", "Будет примерно через {eta} мин. Пожалуйста, будьте готовы."),
    },
    "driver_arrived": {
        "tr": ("Sürücünüz geldi", "{vehicle} · {plate} sizi bekliyor."),
        "en": ("Your driver has arrived", "{vehicle} · {plate} is waiting for you."),
        "de": ("Ihr Fahrer ist da", "{vehicle} · {plate} wartet auf Sie."),
        "ru": ("Водитель на месте", "{vehicle} · {plate} ждёт вас."),
    },
    "trip_started": {
        "tr": ("Yolculuğunuz başladı", "İyi yolculuklar. Tahmini varış {eta} dk."),
        "en": ("Your trip has started", "Enjoy the ride. About {eta} min to your destination."),
        "de": ("Ihre Fahrt hat begonnen", "Gute Fahrt. Etwa {eta} Min. bis zum Ziel."),
        "ru": ("Поездка началась", "Приятной поездки. Примерно {eta} мин до места."),
    },
    "trip_finished": {
        "tr": ("Yolculuk tamamlandı", "Bizi tercih ettiğiniz için teşekkürler."),
        "en": ("Trip completed", "Thank you for travelling with us."),
        "de": ("Fahrt abgeschlossen", "Danke, dass Sie mit uns gefahren sind."),
        "ru": ("Поездка завершена", "Спасибо, что выбрали нас."),
    },
    "new_message": {
        "tr": ("{sender} yazdı", "{text}"),
        "en": ("Message from {sender}", "{text}"),
        "de": ("Nachricht von {sender}", "{text}"),
        "ru": ("Сообщение от {sender}", "{text}"),
    },
}

DRIVER_TEXTS: dict[str, tuple[str, str]] = {
    "customer_finished": ("Yolcu yolculuğu bitirdi", "{pickup} → {dropoff} tamamlandı. Hakedişiniz Kazanç'a eklendi."),
    "trip_cancelled": ("Yolculuk iptal edildi", "{pickup} → {dropoff}, {pickup_at}."),
    "new_message": ("{sender} yazdı", "{text}"),
    # K-60 uçuş takibi
    "flight_delayed": ("Uçuş saati değişti: {flight}", "Tahmini iniş {time} (planlanan {scheduled}). {pickup} alışı."),
    "flight_landed": ("Uçuş indi: {flight}", "{time} itibarıyla indi. {pickup} alışı."),
    "flight_cancelled": ("Uçuş iptal: {flight}", "{pickup} alışı. Operasyonla iletişime geçin."),
    "flight_diverted": ("Uçuş başka havalimanına yönlendirildi: {flight}", "{pickup} alışı. Operasyonla iletişime geçin."),
}


def _data(leg: BookingLeg, code: str) -> dict[str, str]:
    return {"type": code, "booking_code": leg.booking.booking_code, "leg_id": str(leg.id)}


def leg_params(leg: BookingLeg) -> dict[str, str]:
    params = {"pickup": leg.pickup_region.name, "dropoff": leg.dropoff_region.name}
    if leg.driver is not None:
        params["driver"] = leg.driver.full_name.split()[0]
    if leg.vehicle is not None:
        params["vehicle"] = f"{leg.vehicle.brand} {leg.vehicle.model}"
        params["plate"] = leg.vehicle.plate
    return params


def to_customer(db: Session, leg: BookingLeg, code: str, **params: object) -> TripUpdate:
    booking = leg.booking
    texts = CUSTOMER_TEXTS[code]
    title_t, body_t = texts.get(booking.locale) or texts["en"]
    values = _Safe({**leg_params(leg), **{k: str(v) for k, v in params.items()}})
    title, body = title_t.format_map(values)[:120], body_t.format_map(values)[:500]
    data = _data(leg, code)
    update = TripUpdate(id=uuid.uuid4(), booking_leg_id=leg.id, recipient_type="customer",
                        recipient_id=booking.customer_id, code=code, title=title, body=body, data=data)
    db.add(update)
    push_outbox.enqueue(db, booking.customer, code, title, body, {**data, "update_id": str(update.id)})
    return update


def to_driver(db: Session, leg: BookingLeg, code: str, **params: object) -> TripUpdate | None:
    if leg.driver is None:
        return None
    title_t, body_t = DRIVER_TEXTS[code]
    values = _Safe({**leg_params(leg), **{k: str(v) for k, v in params.items()}})
    title, body = title_t.format_map(values)[:120], body_t.format_map(values)[:500]
    data = _data(leg, code)
    update = TripUpdate(id=uuid.uuid4(), booking_leg_id=leg.id, recipient_type="driver",
                        recipient_id=leg.driver.id, code=code, title=title, body=body, data=data)
    db.add(update)
    push_outbox.enqueue(db, leg.driver, code, title, body, {**data, "update_id": str(update.id)})
    return update
