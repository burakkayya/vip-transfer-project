"""Yolculuk bildirimleri (K-51): sürücü kabul etti, yolda, yaklaşıyor, geldi, yeni mesaj...

Her bildirim `trip_updates` akışına yazılır; mobil uygulama bu akışı yoklayıp yerel bildirim
gösterir. Alıcının push jetonu varsa ve push sağlayıcısı (FCM) açıksa aynı metin push olarak
da gönderilir. Push hatası işlemi bozmaz.

Metinler alıcının dilinde üretilir: müşteri için rezervasyon dili (K-77: on iki dil, eksikse en), sürücü için tr.
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
        "es": ("Su conductor está confirmado", "{driver} le recogerá en un {vehicle} ({plate})."),
        "fr": ("Votre chauffeur est confirmé", "{driver} viendra vous chercher en {vehicle} ({plate})."),
        "it": ("Il suo autista è confermato", "{driver} la verrà a prendere con un {vehicle} ({plate})."),
        "pt": ("Seu motorista está confirmado", "{driver} vai buscá-lo em um {vehicle} ({plate})."),
        "ar": ("تم تأكيد سائقك", "سيقلّك {driver} بسيارة {vehicle} ({plate})."),
        "zh": ("您的司机已确定", "{driver} 将驾驶 {vehicle}（{plate}）来接您。"),
        "ja": ("ドライバーが決まりました", "{driver} が {vehicle}（{plate}）でお迎えに上がります。"),
        "ko": ("기사님이 배정되었습니다", "{driver} 기사님이 {vehicle}({plate})로 모시러 갑니다."),
    },
    # K-81: günlük kiralamada bütün günler tek seferde atandığında tek özet bildirim (gün sayısı yazılmaz).
    "daily_driver_assigned_all": {
        "tr": ("Sürücünüz belli oldu", "{driver}, {vehicle} ({plate}) ile kiralamanızın bütün günlerinde sizinle."),
        "en": ("Your driver is confirmed", "{driver} will be with you on every day of your booking in a {vehicle} ({plate})."),
        "de": ("Ihr Fahrer steht fest", "{driver} ist an allen Tagen Ihrer Buchung mit einem {vehicle} ({plate}) für Sie da."),
        "ru": ("Водитель назначен", "{driver} будет с вами во все дни аренды на {vehicle} ({plate})."),
        "es": ("Su conductor está confirmado", "{driver} le acompañará todos los días de su reserva en un {vehicle} ({plate})."),
        "fr": ("Votre chauffeur est confirmé", "{driver} sera à vos côtés chaque jour de votre réservation en {vehicle} ({plate})."),
        "it": ("Il suo autista è confermato", "{driver} sarà con lei ogni giorno della prenotazione con un {vehicle} ({plate})."),
        "pt": ("Seu motorista está confirmado", "{driver} estará com você em todos os dias da reserva em um {vehicle} ({plate})."),
        "ar": ("تم تأكيد سائقك", "سيرافقك {driver} في جميع أيام حجزك بسيارة {vehicle} ({plate})."),
        "zh": ("您的司机已确定", "{driver} 将在您预订的每一天驾驶 {vehicle}（{plate}）为您服务。"),
        "ja": ("ドライバーが決まりました", "ご予約の全日程、{driver} が {vehicle}（{plate}）でご一緒します。"),
        "ko": ("기사님이 배정되었습니다", "{driver} 기사님이 예약하신 모든 날 {vehicle}({plate})로 함께합니다."),
    },
    "driver_en_route": {
        "tr": ("Sürücünüz yola çıktı", "{driver} alış noktasına geliyor. Tahmini varış {eta} dk."),
        "en": ("Your driver is on the way", "{driver} is heading to your pickup. About {eta} min away."),
        "de": ("Ihr Fahrer ist unterwegs", "{driver} ist auf dem Weg zu Ihnen. Etwa {eta} Min."),
        "ru": ("Водитель в пути", "{driver} едет к месту посадки. Примерно {eta} мин."),
        "es": ("Su conductor está en camino", "{driver} se dirige al punto de recogida. Llega en unos {eta} min."),
        "fr": ("Votre chauffeur est en route", "{driver} se dirige vers le point de prise en charge. Environ {eta} min."),
        "it": ("Il suo autista è in arrivo", "{driver} sta raggiungendo il punto di partenza. Circa {eta} min."),
        "pt": ("Seu motorista está a caminho", "{driver} está indo ao local de embarque. Cerca de {eta} min."),
        "ar": ("سائقك في الطريق", "{driver} في طريقه إلى نقطة الالتقاء. يصل خلال {eta} دقيقة تقريبًا."),
        "zh": ("司机正在赶来", "{driver} 正前往上车点，约 {eta} 分钟到达。"),
        "ja": ("ドライバーが向かっています", "{driver} が乗車場所へ向かっています。到着まで約 {eta} 分です。"),
        "ko": ("기사님이 오고 있습니다", "{driver} 기사님이 탑승 장소로 이동 중입니다. 약 {eta}분 후 도착합니다."),
    },
    "driver_en_route_noeta": {
        "tr": ("Sürücünüz yola çıktı", "{driver} alış noktasına geliyor."),
        "en": ("Your driver is on the way", "{driver} is heading to your pickup."),
        "de": ("Ihr Fahrer ist unterwegs", "{driver} ist auf dem Weg zu Ihnen."),
        "ru": ("Водитель в пути", "{driver} едет к месту посадки."),
        "es": ("Su conductor está en camino", "{driver} se dirige al punto de recogida."),
        "fr": ("Votre chauffeur est en route", "{driver} se dirige vers le point de prise en charge."),
        "it": ("Il suo autista è in arrivo", "{driver} sta raggiungendo il punto di partenza."),
        "pt": ("Seu motorista está a caminho", "{driver} está indo ao local de embarque."),
        "ar": ("سائقك في الطريق", "{driver} في طريقه إلى نقطة الالتقاء."),
        "zh": ("司机正在赶来", "{driver} 正前往上车点。"),
        "ja": ("ドライバーが向かっています", "{driver} が乗車場所へ向かっています。"),
        "ko": ("기사님이 오고 있습니다", "{driver} 기사님이 탑승 장소로 이동 중입니다."),
    },
    "driver_eta": {
        "tr": ("Sürücünüz {eta} dk uzakta", "{vehicle} · {plate}"),
        "en": ("Your driver is {eta} min away", "{vehicle} · {plate}"),
        "de": ("Ihr Fahrer ist {eta} Min. entfernt", "{vehicle} · {plate}"),
        "ru": ("Водитель в {eta} мин от вас", "{vehicle} · {plate}"),
        "es": ("Su conductor está a {eta} min", "{vehicle} · {plate}"),
        "fr": ("Votre chauffeur est à {eta} min", "{vehicle} · {plate}"),
        "it": ("Il suo autista è a {eta} min", "{vehicle} · {plate}"),
        "pt": ("Seu motorista está a {eta} min", "{vehicle} · {plate}"),
        "ar": ("سائقك على بعد {eta} دقيقة", "{vehicle} · {plate}"),
        "zh": ("司机还有 {eta} 分钟到达", "{vehicle} · {plate}"),
        "ja": ("ドライバーはあと {eta} 分で到着します", "{vehicle} · {plate}"),
        "ko": ("기사님이 {eta}분 거리에 있습니다", "{vehicle} · {plate}"),
    },
    "driver_approaching": {
        "tr": ("Sürücünüz yaklaşıyor", "Yaklaşık {eta} dk içinde alış noktasında. Hazır olun."),
        "en": ("Your driver is almost there", "Arriving in about {eta} min. Please get ready."),
        "de": ("Ihr Fahrer ist gleich da", "Ankunft in etwa {eta} Min. Bitte halten Sie sich bereit."),
        "ru": ("Водитель почти на месте", "Будет примерно через {eta} мин. Пожалуйста, будьте готовы."),
        "es": ("Su conductor está a punto de llegar", "Llega en unos {eta} min. Por favor, esté listo."),
        "fr": ("Votre chauffeur arrive bientôt", "Arrivée dans environ {eta} min. Merci de vous tenir prêt."),
        "it": ("Il suo autista sta per arrivare", "Arriva tra circa {eta} min. La preghiamo di tenersi pronto."),
        "pt": ("Seu motorista está chegando", "Chega em cerca de {eta} min. Por favor, esteja pronto."),
        "ar": ("سائقك على وشك الوصول", "يصل خلال {eta} دقيقة تقريبًا. يرجى الاستعداد."),
        "zh": ("司机即将到达", "约 {eta} 分钟后到达上车点，请做好准备。"),
        "ja": ("まもなくドライバーが到着します", "約 {eta} 分で到着します。ご準備をお願いします。"),
        "ko": ("기사님이 곧 도착합니다", "약 {eta}분 후 도착합니다. 준비해 주세요."),
    },
    "driver_arrived": {
        "tr": ("Sürücünüz geldi", "{vehicle} · {plate} sizi bekliyor."),
        "en": ("Your driver has arrived", "{vehicle} · {plate} is waiting for you."),
        "de": ("Ihr Fahrer ist da", "{vehicle} · {plate} wartet auf Sie."),
        "ru": ("Водитель на месте", "{vehicle} · {plate} ждёт вас."),
        "es": ("Su conductor ha llegado", "{vehicle} · {plate} le está esperando."),
        "fr": ("Votre chauffeur est arrivé", "{vehicle} · {plate} vous attend."),
        "it": ("Il suo autista è arrivato", "{vehicle} · {plate} la sta aspettando."),
        "pt": ("Seu motorista chegou", "{vehicle} · {plate} está esperando por você."),
        "ar": ("وصل سائقك", "{vehicle} · {plate} بانتظارك."),
        "zh": ("司机已到达", "{vehicle} · {plate} 正在等您。"),
        "ja": ("ドライバーが到着しました", "{vehicle} · {plate} がお待ちしています。"),
        "ko": ("기사님이 도착했습니다", "{vehicle} · {plate} 차량이 기다리고 있습니다."),
    },
    "trip_started": {
        "tr": ("Yolculuğunuz başladı", "İyi yolculuklar. Tahmini varış {eta} dk."),
        "en": ("Your trip has started", "Enjoy the ride. About {eta} min to your destination."),
        "de": ("Ihre Fahrt hat begonnen", "Gute Fahrt. Etwa {eta} Min. bis zum Ziel."),
        "ru": ("Поездка началась", "Приятной поездки. Примерно {eta} мин до места."),
        "es": ("Su viaje ha comenzado", "Buen viaje. Unos {eta} min hasta su destino."),
        "fr": ("Votre trajet a commencé", "Bon voyage. Environ {eta} min jusqu'à destination."),
        "it": ("Il suo viaggio è iniziato", "Buon viaggio. Circa {eta} min alla destinazione."),
        "pt": ("Sua viagem começou", "Boa viagem. Cerca de {eta} min até o destino."),
        "ar": ("بدأت رحلتك", "رحلة سعيدة. حوالي {eta} دقيقة حتى الوجهة."),
        "zh": ("行程已开始", "祝您旅途愉快，约 {eta} 分钟到达目的地。"),
        "ja": ("乗車が始まりました", "快適な移動をお楽しみください。目的地まで約 {eta} 分です。"),
        "ko": ("운행이 시작되었습니다", "편안한 여행 되세요. 목적지까지 약 {eta}분 걸립니다."),
    },
    # K-29 günlük kiralama: gün başladı (bildirim kodu yine "trip_started").
    "daily_started": {
        "tr": ("Gününüz başladı", "İyi günler. Sürücünüz {hours} saat boyunca sizinle."),
        "en": ("Your day has started", "Have a great day. Your driver is with you for {hours} hours."),
        "de": ("Ihr Tag hat begonnen", "Einen schönen Tag. Ihr Fahrer ist {hours} Stunden für Sie da."),
        "ru": ("Ваш день начался", "Хорошего дня. Водитель с вами {hours} ч."),
        "es": ("Su día ha comenzado", "Que tenga un buen día. Su conductor está con usted {hours} horas."),
        "fr": ("Votre journée a commencé", "Bonne journée. Votre chauffeur est à vos côtés pendant {hours} heures."),
        "it": ("La sua giornata è iniziata", "Buona giornata. Il suo autista è con lei per {hours} ore."),
        "pt": ("Seu dia começou", "Tenha um ótimo dia. Seu motorista está com você por {hours} horas."),
        "ar": ("بدأ يومك", "نتمنى لك يومًا سعيدًا. سائقك معك لمدة {hours} ساعات."),
        "zh": ("您的包车日已开始", "祝您愉快，司机将陪同您 {hours} 小时。"),
        "ja": ("貸切が始まりました", "良い一日を。ドライバーが {hours} 時間ご一緒します。"),
        "ko": ("하루 일정이 시작되었습니다", "즐거운 하루 되세요. 기사님이 {hours}시간 동안 함께합니다."),
    },
    "trip_finished": {
        "tr": ("Yolculuk tamamlandı", "Bizi tercih ettiğiniz için teşekkürler."),
        "en": ("Trip completed", "Thank you for travelling with us."),
        "de": ("Fahrt abgeschlossen", "Danke, dass Sie mit uns gefahren sind."),
        "ru": ("Поездка завершена", "Спасибо, что выбрали нас."),
        "es": ("Viaje completado", "Gracias por viajar con nosotros."),
        "fr": ("Trajet terminé", "Merci d'avoir voyagé avec nous."),
        "it": ("Viaggio completato", "Grazie per aver viaggiato con noi."),
        "pt": ("Viagem concluída", "Obrigado por viajar conosco."),
        "ar": ("اكتملت الرحلة", "شكرًا لسفرك معنا."),
        "zh": ("行程已完成", "感谢您选择我们。"),
        "ja": ("乗車が完了しました", "ご利用ありがとうございました。"),
        "ko": ("운행이 완료되었습니다", "이용해 주셔서 감사합니다."),
    },
    # K-63 yolcu gelmedi (ücretsiz bekleme sonunda)
    "no_show": {
        "tr": ("Sizi bulamadık", "Sürücünüz alış noktasında bekledi, yolculuk gerçekleşmedi. Bir sorun varsa bize yazın."),
        "en": ("We couldn't find you", "Your driver waited at the pickup point and the ride did not take place. Contact us if something went wrong."),
        "de": ("Wir konnten Sie nicht finden", "Ihr Fahrer hat am Abholort gewartet, die Fahrt fand nicht statt. Melden Sie sich bei Problemen."),
        "ru": ("Мы не нашли вас", "Водитель ждал в месте посадки, поездка не состоялась. Напишите нам, если что-то пошло не так."),
        "es": ("No pudimos encontrarle", "Su conductor esperó en el punto de recogida y el traslado no se realizó. Escríbanos si hubo algún problema."),
        "fr": ("Nous ne vous avons pas trouvé", "Votre chauffeur a attendu au point de prise en charge et le trajet n'a pas eu lieu. Contactez-nous en cas de problème."),
        "it": ("Non siamo riusciti a trovarla", "Il suo autista ha atteso al punto di partenza e il viaggio non è avvenuto. Ci scriva se qualcosa è andato storto."),
        "pt": ("Não conseguimos encontrar você", "Seu motorista esperou no local de embarque e a viagem não aconteceu. Fale conosco se algo deu errado."),
        "ar": ("لم نتمكن من العثور عليك", "انتظرك السائق في نقطة الالتقاء ولم تتم الرحلة. راسلنا إذا حدثت مشكلة."),
        "zh": ("未能接到您", "司机在上车点等候，但行程未能进行。如有问题，请联系我们。"),
        "ja": ("お客様を見つけられませんでした", "ドライバーが乗車場所でお待ちしましたが、乗車は行われませんでした。問題があればご連絡ください。"),
        "ko": ("고객님을 찾지 못했습니다", "기사님이 탑승 장소에서 기다렸지만 운행이 이루어지지 않았습니다. 문제가 있었다면 연락해 주세요."),
    },
    # K-62 buluşma deneyimi
    "meeting_guide": {
        "tr": ("Hoş geldiniz! Sürücünüzle buluşma", "Çıkıştan buluşma noktasına adım adım yol tarifi için dokunun."),
        "en": ("Welcome! Meeting your driver", "Tap for step-by-step directions from arrivals to the meeting point."),
        "de": ("Willkommen! Treffpunkt mit Ihrem Fahrer", "Tippen Sie für eine Schritt-für-Schritt-Wegbeschreibung zum Treffpunkt."),
        "ru": ("Добро пожаловать! Встреча с водителем", "Нажмите, чтобы увидеть пошаговый путь от выхода до места встречи."),
        "es": ("¡Bienvenido! Encuentro con su conductor", "Toque para ver el camino paso a paso desde la salida hasta el punto de encuentro."),
        "fr": ("Bienvenue ! Rejoindre votre chauffeur", "Touchez pour l'itinéraire pas à pas de la sortie jusqu'au point de rencontre."),
        "it": ("Benvenuto! Incontro con l'autista", "Tocchi per le indicazioni passo passo dall'uscita al punto d'incontro."),
        "pt": ("Bem-vindo! Encontro com o motorista", "Toque para ver o caminho passo a passo da saída até o ponto de encontro."),
        "ar": ("أهلًا بك! لقاء سائقك", "اضغط لعرض الطريق خطوة بخطوة من صالة الوصول إلى نقطة اللقاء."),
        "zh": ("欢迎！与司机会合", "点按查看从到达出口到会合点的分步指引。"),
        "ja": ("ようこそ！ドライバーとの待ち合わせ", "到着出口から待ち合わせ場所までの道順を確認するにはタップしてください。"),
        "ko": ("환영합니다! 기사님과 만나기", "도착 출구에서 만남 장소까지 단계별 안내를 보려면 탭하세요."),
    },
    "driver_card": {
        "tr": ("Sizi karşılayacak sürücü: {driver}", "{color}{vehicle} · {plate}. Konuştuğu diller: {languages}."),
        "en": ("Your driver: {driver}", "{color}{vehicle} · {plate}. Speaks: {languages}."),
        "de": ("Ihr Fahrer: {driver}", "{color}{vehicle} · {plate}. Sprachen: {languages}."),
        "ru": ("Ваш водитель: {driver}", "{color}{vehicle} · {plate}. Языки: {languages}."),
        "es": ("Su conductor: {driver}", "{color}{vehicle} · {plate}. Idiomas: {languages}."),
        "fr": ("Votre chauffeur : {driver}", "{color}{vehicle} · {plate}. Langues : {languages}."),
        "it": ("Il suo autista: {driver}", "{color}{vehicle} · {plate}. Lingue: {languages}."),
        "pt": ("Seu motorista: {driver}", "{color}{vehicle} · {plate}. Idiomas: {languages}."),
        "ar": ("سائقك: {driver}", "{color}{vehicle} · {plate}. اللغات: {languages}."),
        "zh": ("您的司机：{driver}", "{color}{vehicle} · {plate}。语言：{languages}。"),
        "ja": ("担当ドライバー：{driver}", "{color}{vehicle} · {plate}。対応言語：{languages}。"),
        "ko": ("담당 기사님: {driver}", "{color}{vehicle} · {plate}. 사용 언어: {languages}."),
    },
    # PRIV-04: mesaj metni ve gönderen adı bildirime (trip_updates.body, FCM) kopyalanmaz;
    # içerik uygulamada şifreli kaynaktan (trip_messages) okunur.
    "new_message": {
        "tr": ("Yeni mesaj", "Sürücünüz size yazdı. Okumak için uygulamayı açın."),
        "en": ("New message", "Your driver sent you a message. Open the app to read it."),
        "de": ("Neue Nachricht", "Ihr Fahrer hat Ihnen geschrieben. Öffnen Sie die App, um sie zu lesen."),
        "ru": ("Новое сообщение", "Водитель написал вам. Откройте приложение, чтобы прочитать."),
        "es": ("Nuevo mensaje", "Su conductor le ha escrito. Abra la aplicación para leerlo."),
        "fr": ("Nouveau message", "Votre chauffeur vous a écrit. Ouvrez l'application pour le lire."),
        "it": ("Nuovo messaggio", "Il suo autista le ha scritto. Apra l'app per leggerlo."),
        "pt": ("Nova mensagem", "Seu motorista enviou uma mensagem. Abra o app para ler."),
        "ar": ("رسالة جديدة", "أرسل لك السائق رسالة. افتح التطبيق لقراءتها."),
        "zh": ("新消息", "司机给您发了消息，打开应用即可查看。"),
        "ja": ("新しいメッセージ", "ドライバーからメッセージが届きました。アプリを開いてご確認ください。"),
        "ko": ("새 메시지", "기사님이 메시지를 보냈습니다. 앱을 열어 확인하세요."),
    },
}

DRIVER_TEXTS: dict[str, tuple[str, str]] = {
    "customer_finished": ("Yolcu yolculuğu bitirdi", "{pickup} → {dropoff} tamamlandı. Hakedişiniz Kazanç'a eklendi."),
    "trip_cancelled": ("Yolculuk iptal edildi", "{pickup} → {dropoff}, {pickup_at}."),
    "new_message": ("Yeni mesaj", "Yolcu size yazdı. Okumak için uygulamayı açın."),
    # K-63 günlük plan
    "daily_plan": ("Yarın {count} işiniz var", "İlk alış {first}. Planı ve dönüş işi önerilerini görmek için dokunun."),
    # K-62 yolcu durumu, puan, bahşiş
    "passenger_landed": ("{passenger} indi", "{pickup} alışı. Yolcu pasaport ve bagaj aşamasında."),
    "passenger_baggage": ("{passenger} bagajda", "{pickup} alışı. Birazdan çıkışta olacak."),
    "passenger_exiting": ("{passenger} çıkıyor", "{pickup} alışı. Yolcu karşılama alanına geliyor."),
    "trip_rated": ("Yolculuğunuz {stars}/5 puan aldı", "{pickup} → {dropoff}"),
    "tip_received": ("Bahşiş: {amount} {currency}", "{pickup} → {dropoff}. Komisyon düşülerek Kazanç'a eklendi."),
    # K-60 uçuş takibi. PRIV-04: uçuş numarası bildirime yazılmaz (yolculuk ekranında görünür).
    "flight_delayed": ("Uçuş saati değişti", "Tahmini iniş {time} (planlanan {scheduled}). {pickup} alışı."),
    "flight_landed": ("Uçuş indi", "{time} itibarıyla indi. {pickup} alışı."),
    "flight_cancelled": ("Uçuş iptal edildi", "{pickup} alışı. Operasyonla iletişime geçin."),
    "flight_diverted": ("Uçuş başka havalimanına yönlendirildi", "{pickup} alışı. Operasyonla iletişime geçin."),
}

# PRIV-04: çağıran bu değerleri geçse de metne girmez (şablon değişse bile ikinci savunma).
_PRIVATE_PARAMS = frozenset({"text", "flight", "sender"})


def _values(leg: BookingLeg, params: dict[str, object]) -> _Safe:
    return _Safe({**leg_params(leg), **{k: str(v) for k, v in params.items() if k not in _PRIVATE_PARAMS}})


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


def to_customer(db: Session, leg: BookingLeg, code: str, *, text_key: str | None = None,
                **params: object) -> TripUpdate:
    """`text_key`: aynı bildirim kodu için farklı metin (ör. K-29 günlük kiralamada "daily_started")."""
    booking = leg.booking
    texts = CUSTOMER_TEXTS[text_key or code]
    title_t, body_t = texts.get(booking.locale) or texts["en"]
    values = _values(leg, params)
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
    values = _values(leg, params)
    title, body = title_t.format_map(values)[:120], body_t.format_map(values)[:500]
    data = _data(leg, code)
    update = TripUpdate(id=uuid.uuid4(), booking_leg_id=leg.id, recipient_type="driver",
                        recipient_id=leg.driver.id, code=code, title=title, body=body, data=data)
    db.add(update)
    push_outbox.enqueue(db, leg.driver, code, title, body, {**data, "update_id": str(update.id)})
    return update
