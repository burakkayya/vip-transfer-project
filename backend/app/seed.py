"""Başlangıç verisi. Tekrar çalıştırılabilir; var olan kayıtlara dokunmaz.

Bölge koordinatları ilçe merkezlerinin yaklaşık değerleridir; admin panelinden
düzeltilebilir. Araç tipleri ve çarpanları açık konudur (acik_konular.md),
buradaki değerler yer tutucudur.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal as D

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    CancellationPolicy,
    CancellationPolicyTier,
    CommissionRule,
    NotificationTemplate,
    PricingRule,
    MeetingGuide,
    Region,
    RoundTripDiscount,
    VehicleType,
)
from app.models.enums import CommissionScope, DiscountType, NotificationChannel, RegionType
from app.services.auth import ensure_roles

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)

# (kod, il, ad, tür, IATA, enlem, boylam)
REGIONS: list[tuple] = [
    ("ayt", "antalya", "Antalya Havalimanı", RegionType.AIRPORT, "AYT", "36.898700", "30.800500"),
    ("gzp", "antalya", "Gazipaşa-Alanya Havalimanı", RegionType.AIRPORT, "GZP", "36.299200", "32.300600"),
    ("dlm", "mugla", "Dalaman Havalimanı", RegionType.AIRPORT, "DLM", "36.713100", "28.792500"),
    ("bjv", "mugla", "Milas-Bodrum Havalimanı", RegionType.AIRPORT, "BJV", "37.250600", "27.664300"),
    # Antalya ilçeleri
    ("akseki", "antalya", "Akseki", RegionType.DISTRICT, None, "37.048300", "31.790000"),
    ("aksu", "antalya", "Aksu", RegionType.DISTRICT, None, "36.950000", "30.840000"),
    ("alanya", "antalya", "Alanya", RegionType.DISTRICT, None, "36.544400", "31.995400"),
    ("demre", "antalya", "Demre", RegionType.DISTRICT, None, "36.244400", "29.983900"),
    ("dosemealti", "antalya", "Döşemealtı", RegionType.DISTRICT, None, "37.023600", "30.601100"),
    ("elmali", "antalya", "Elmalı", RegionType.DISTRICT, None, "36.737200", "29.916400"),
    ("finike", "antalya", "Finike", RegionType.DISTRICT, None, "36.295800", "30.145600"),
    ("gazipasa", "antalya", "Gazipaşa", RegionType.DISTRICT, None, "36.270000", "32.317500"),
    ("gundogmus", "antalya", "Gündoğmuş", RegionType.DISTRICT, None, "36.813600", "31.998900"),
    ("ibradi", "antalya", "İbradı", RegionType.DISTRICT, None, "37.095800", "31.598600"),
    ("kas", "antalya", "Kaş", RegionType.DISTRICT, None, "36.201700", "29.637800"),
    ("kemer", "antalya", "Kemer", RegionType.DISTRICT, None, "36.600000", "30.560000"),
    ("kepez", "antalya", "Kepez", RegionType.DISTRICT, None, "36.950000", "30.710000"),
    ("konyaalti", "antalya", "Konyaaltı", RegionType.DISTRICT, None, "36.870000", "30.630000"),
    ("korkuteli", "antalya", "Korkuteli", RegionType.DISTRICT, None, "37.065600", "30.195300"),
    ("kumluca", "antalya", "Kumluca", RegionType.DISTRICT, None, "36.370000", "30.290000"),
    ("manavgat", "antalya", "Manavgat", RegionType.DISTRICT, None, "36.786700", "31.443300"),
    ("muratpasa", "antalya", "Muratpaşa", RegionType.DISTRICT, None, "36.885000", "30.710000"),
    ("serik", "antalya", "Serik", RegionType.DISTRICT, None, "36.917200", "31.100300"),
    # Muğla ilçeleri
    ("bodrum", "mugla", "Bodrum", RegionType.DISTRICT, None, "37.034400", "27.430500"),
    ("dalaman", "mugla", "Dalaman", RegionType.DISTRICT, None, "36.765600", "28.802800"),
    ("datca", "mugla", "Datça", RegionType.DISTRICT, None, "36.727500", "27.686900"),
    ("fethiye", "mugla", "Fethiye", RegionType.DISTRICT, None, "36.621400", "29.116400"),
    ("kavaklidere", "mugla", "Kavaklıdere", RegionType.DISTRICT, None, "37.443000", "28.365000"),
    ("koycegiz", "mugla", "Köyceğiz", RegionType.DISTRICT, None, "36.970600", "28.685600"),
    ("marmaris", "mugla", "Marmaris", RegionType.DISTRICT, None, "36.855000", "28.274200"),
    ("mentese", "mugla", "Menteşe", RegionType.DISTRICT, None, "37.215300", "28.363600"),
    ("milas", "mugla", "Milas", RegionType.DISTRICT, None, "37.316400", "27.783900"),
    ("ortaca", "mugla", "Ortaca", RegionType.DISTRICT, None, "36.838900", "28.764700"),
    ("seydikemer", "mugla", "Seydikemer", RegionType.DISTRICT, None, "36.640000", "29.350000"),
    ("ula", "mugla", "Ula", RegionType.DISTRICT, None, "37.103900", "28.416100"),
    ("yatagan", "mugla", "Yatağan", RegionType.DISTRICT, None, "37.340000", "28.140000"),
    # K-75: İstanbul, Ankara, İzmir ve Kapadokya (Nevşehir, Kayseri)
    ("ist", "istanbul", "İstanbul Havalimanı", RegionType.AIRPORT, "IST", "41.275300", "28.751900"),
    ("saw", "istanbul", "Sabiha Gökçen Havalimanı", RegionType.AIRPORT, "SAW", "40.898600", "29.309200"),
    ("esb", "ankara", "Ankara Esenboğa Havalimanı", RegionType.AIRPORT, "ESB", "40.128100", "32.995100"),
    ("adb", "izmir", "İzmir Adnan Menderes Havalimanı", RegionType.AIRPORT, "ADB", "38.292400", "27.157000"),
    ("nav", "nevsehir", "Nevşehir Kapadokya Havalimanı", RegionType.AIRPORT, "NAV", "38.771900", "34.534500"),
    ("asr", "kayseri", "Kayseri Erkilet Havalimanı", RegionType.AIRPORT, "ASR", "38.770400", "35.495400"),
    # İstanbul ilçeleri
    ("adalar", "istanbul", "Adalar", RegionType.DISTRICT, None, "40.876000", "29.091000"),
    ("arnavutkoy", "istanbul", "Arnavutköy", RegionType.DISTRICT, None, "41.185000", "28.740000"),
    ("atasehir", "istanbul", "Ataşehir", RegionType.DISTRICT, None, "40.983000", "29.127000"),
    ("avcilar", "istanbul", "Avcılar", RegionType.DISTRICT, None, "40.979000", "28.721000"),
    ("bagcilar", "istanbul", "Bağcılar", RegionType.DISTRICT, None, "41.039000", "28.856000"),
    ("bahcelievler", "istanbul", "Bahçelievler", RegionType.DISTRICT, None, "41.000000", "28.861000"),
    ("bakirkoy", "istanbul", "Bakırköy", RegionType.DISTRICT, None, "40.981000", "28.872000"),
    ("basaksehir", "istanbul", "Başakşehir", RegionType.DISTRICT, None, "41.093000", "28.802000"),
    ("bayrampasa", "istanbul", "Bayrampaşa", RegionType.DISTRICT, None, "41.046000", "28.900000"),
    ("besiktas", "istanbul", "Beşiktaş", RegionType.DISTRICT, None, "41.043000", "29.007000"),
    ("beykoz", "istanbul", "Beykoz", RegionType.DISTRICT, None, "41.134000", "29.092000"),
    ("beylikduzu", "istanbul", "Beylikdüzü", RegionType.DISTRICT, None, "40.982000", "28.640000"),
    ("beyoglu", "istanbul", "Beyoğlu", RegionType.DISTRICT, None, "41.037000", "28.977000"),
    ("buyukcekmece", "istanbul", "Büyükçekmece", RegionType.DISTRICT, None, "41.021000", "28.585000"),
    ("catalca", "istanbul", "Çatalca", RegionType.DISTRICT, None, "41.143000", "28.461000"),
    ("cekmekoy", "istanbul", "Çekmeköy", RegionType.DISTRICT, None, "41.035000", "29.178000"),
    ("esenler", "istanbul", "Esenler", RegionType.DISTRICT, None, "41.043000", "28.876000"),
    ("esenyurt", "istanbul", "Esenyurt", RegionType.DISTRICT, None, "41.029000", "28.672000"),
    ("eyupsultan", "istanbul", "Eyüpsultan", RegionType.DISTRICT, None, "41.048000", "28.934000"),
    ("fatih", "istanbul", "Fatih", RegionType.DISTRICT, None, "41.019000", "28.940000"),
    ("gaziosmanpasa", "istanbul", "Gaziosmanpaşa", RegionType.DISTRICT, None, "41.066000", "28.912000"),
    ("gungoren", "istanbul", "Güngören", RegionType.DISTRICT, None, "41.022000", "28.873000"),
    ("kadikoy", "istanbul", "Kadıköy", RegionType.DISTRICT, None, "40.991000", "29.027000"),
    ("kagithane", "istanbul", "Kağıthane", RegionType.DISTRICT, None, "41.085000", "28.973000"),
    ("kartal", "istanbul", "Kartal", RegionType.DISTRICT, None, "40.889000", "29.190000"),
    ("kucukcekmece", "istanbul", "Küçükçekmece", RegionType.DISTRICT, None, "41.000000", "28.780000"),
    ("maltepe", "istanbul", "Maltepe", RegionType.DISTRICT, None, "40.935000", "29.155000"),
    ("pendik", "istanbul", "Pendik", RegionType.DISTRICT, None, "40.877000", "29.235000"),
    ("sancaktepe", "istanbul", "Sancaktepe", RegionType.DISTRICT, None, "41.003000", "29.231000"),
    ("sariyer", "istanbul", "Sarıyer", RegionType.DISTRICT, None, "41.167000", "29.050000"),
    ("silivri", "istanbul", "Silivri", RegionType.DISTRICT, None, "41.074000", "28.247000"),
    ("sultanbeyli", "istanbul", "Sultanbeyli", RegionType.DISTRICT, None, "40.968000", "29.262000"),
    ("sultangazi", "istanbul", "Sultangazi", RegionType.DISTRICT, None, "41.107000", "28.868000"),
    ("sile", "istanbul", "Şile", RegionType.DISTRICT, None, "41.176000", "29.613000"),
    ("sisli", "istanbul", "Şişli", RegionType.DISTRICT, None, "41.060000", "28.987000"),
    ("tuzla", "istanbul", "Tuzla", RegionType.DISTRICT, None, "40.816000", "29.300000"),
    ("umraniye", "istanbul", "Ümraniye", RegionType.DISTRICT, None, "41.016000", "29.124000"),
    ("uskudar", "istanbul", "Üsküdar", RegionType.DISTRICT, None, "41.023000", "29.015000"),
    ("zeytinburnu", "istanbul", "Zeytinburnu", RegionType.DISTRICT, None, "40.994000", "28.904000"),
    # Ankara ilçeleri
    ("akyurt", "ankara", "Akyurt", RegionType.DISTRICT, None, "40.134000", "33.087000"),
    ("altindag", "ankara", "Altındağ", RegionType.DISTRICT, None, "39.950000", "32.870000"),
    ("ayas", "ankara", "Ayaş", RegionType.DISTRICT, None, "40.017000", "32.346000"),
    ("bala", "ankara", "Bala", RegionType.DISTRICT, None, "39.553000", "33.124000"),
    ("beypazari", "ankara", "Beypazarı", RegionType.DISTRICT, None, "40.168000", "31.921000"),
    ("camlidere", "ankara", "Çamlıdere", RegionType.DISTRICT, None, "40.490000", "32.475000"),
    ("cankaya", "ankara", "Çankaya", RegionType.DISTRICT, None, "39.900000", "32.860000"),
    ("cubuk", "ankara", "Çubuk", RegionType.DISTRICT, None, "40.239000", "33.032000"),
    ("elmadag", "ankara", "Elmadağ", RegionType.DISTRICT, None, "39.921000", "33.231000"),
    ("etimesgut", "ankara", "Etimesgut", RegionType.DISTRICT, None, "39.950000", "32.670000"),
    ("evren", "ankara", "Evren", RegionType.DISTRICT, None, "39.023000", "33.808000"),
    ("golbasi", "ankara", "Gölbaşı", RegionType.DISTRICT, None, "39.790000", "32.806000"),
    ("gudul", "ankara", "Güdül", RegionType.DISTRICT, None, "40.211000", "32.245000"),
    ("haymana", "ankara", "Haymana", RegionType.DISTRICT, None, "39.433000", "32.497000"),
    ("kahramankazan", "ankara", "Kahramankazan", RegionType.DISTRICT, None, "40.205000", "32.683000"),
    ("kalecik", "ankara", "Kalecik", RegionType.DISTRICT, None, "40.098000", "33.409000"),
    ("kecioren", "ankara", "Keçiören", RegionType.DISTRICT, None, "39.990000", "32.860000"),
    ("kizilcahamam", "ankara", "Kızılcahamam", RegionType.DISTRICT, None, "40.470000", "32.651000"),
    ("mamak", "ankara", "Mamak", RegionType.DISTRICT, None, "39.930000", "32.920000"),
    ("nallihan", "ankara", "Nallıhan", RegionType.DISTRICT, None, "40.186000", "31.352000"),
    ("polatli", "ankara", "Polatlı", RegionType.DISTRICT, None, "39.584000", "32.147000"),
    ("pursaklar", "ankara", "Pursaklar", RegionType.DISTRICT, None, "40.040000", "32.900000"),
    ("sincan", "ankara", "Sincan", RegionType.DISTRICT, None, "39.970000", "32.580000"),
    ("sereflikochisar", "ankara", "Şereflikoçhisar", RegionType.DISTRICT, None, "38.939000", "33.539000"),
    ("yenimahalle", "ankara", "Yenimahalle", RegionType.DISTRICT, None, "39.970000", "32.810000"),
    # İzmir ilçeleri
    ("aliaga", "izmir", "Aliağa", RegionType.DISTRICT, None, "38.800000", "26.972000"),
    ("balcova", "izmir", "Balçova", RegionType.DISTRICT, None, "38.389000", "27.050000"),
    ("bayindir", "izmir", "Bayındır", RegionType.DISTRICT, None, "38.218000", "27.648000"),
    ("bayrakli", "izmir", "Bayraklı", RegionType.DISTRICT, None, "38.462000", "27.165000"),
    ("bergama", "izmir", "Bergama", RegionType.DISTRICT, None, "39.121000", "27.180000"),
    ("beydag", "izmir", "Beydağ", RegionType.DISTRICT, None, "38.085000", "28.210000"),
    ("bornova", "izmir", "Bornova", RegionType.DISTRICT, None, "38.470000", "27.220000"),
    ("buca", "izmir", "Buca", RegionType.DISTRICT, None, "38.388000", "27.175000"),
    ("cesme", "izmir", "Çeşme", RegionType.DISTRICT, None, "38.323000", "26.305000"),
    ("cigli", "izmir", "Çiğli", RegionType.DISTRICT, None, "38.496000", "27.070000"),
    ("dikili", "izmir", "Dikili", RegionType.DISTRICT, None, "39.071000", "26.889000"),
    ("foca", "izmir", "Foça", RegionType.DISTRICT, None, "38.670000", "26.757000"),
    ("gaziemir", "izmir", "Gaziemir", RegionType.DISTRICT, None, "38.320000", "27.130000"),
    ("guzelbahce", "izmir", "Güzelbahçe", RegionType.DISTRICT, None, "38.370000", "26.890000"),
    ("karabaglar", "izmir", "Karabağlar", RegionType.DISTRICT, None, "38.380000", "27.120000"),
    ("karaburun", "izmir", "Karaburun", RegionType.DISTRICT, None, "38.638000", "26.512000"),
    ("karsiyaka", "izmir", "Karşıyaka", RegionType.DISTRICT, None, "38.460000", "27.110000"),
    ("kemalpasa", "izmir", "Kemalpaşa", RegionType.DISTRICT, None, "38.427000", "27.417000"),
    ("kinik", "izmir", "Kınık", RegionType.DISTRICT, None, "39.087000", "27.383000"),
    ("kiraz", "izmir", "Kiraz", RegionType.DISTRICT, None, "38.231000", "28.204000"),
    ("konak", "izmir", "Konak", RegionType.DISTRICT, None, "38.418000", "27.128000"),
    ("menderes", "izmir", "Menderes", RegionType.DISTRICT, None, "38.253000", "27.134000"),
    ("menemen", "izmir", "Menemen", RegionType.DISTRICT, None, "38.607000", "27.069000"),
    ("narlidere", "izmir", "Narlıdere", RegionType.DISTRICT, None, "38.393000", "26.995000"),
    ("odemis", "izmir", "Ödemiş", RegionType.DISTRICT, None, "38.228000", "27.970000"),
    ("seferihisar", "izmir", "Seferihisar", RegionType.DISTRICT, None, "38.197000", "26.838000"),
    ("selcuk", "izmir", "Selçuk", RegionType.DISTRICT, None, "37.951000", "27.368000"),
    ("tire", "izmir", "Tire", RegionType.DISTRICT, None, "38.089000", "27.736000"),
    ("torbali", "izmir", "Torbalı", RegionType.DISTRICT, None, "38.152000", "27.362000"),
    ("urla", "izmir", "Urla", RegionType.DISTRICT, None, "38.323000", "26.765000"),
    # Nevşehir ilçeleri
    ("nevsehir_merkez", "nevsehir", "Nevşehir Merkez", RegionType.DISTRICT, None, "38.625000", "34.712000"),
    ("acigol", "nevsehir", "Acıgöl", RegionType.DISTRICT, None, "38.551000", "34.509000"),
    ("avanos", "nevsehir", "Avanos", RegionType.DISTRICT, None, "38.715000", "34.847000"),
    ("derinkuyu", "nevsehir", "Derinkuyu", RegionType.DISTRICT, None, "38.374000", "34.734000"),
    ("gulsehir", "nevsehir", "Gülşehir", RegionType.DISTRICT, None, "38.746000", "34.623000"),
    ("hacibektas", "nevsehir", "Hacıbektaş", RegionType.DISTRICT, None, "38.941000", "34.560000"),
    ("kozakli", "nevsehir", "Kozaklı", RegionType.DISTRICT, None, "39.218000", "34.848000"),
    ("urgup", "nevsehir", "Ürgüp", RegionType.DISTRICT, None, "38.631000", "34.912000"),
    # Kayseri ilçeleri
    ("akkisla", "kayseri", "Akkışla", RegionType.DISTRICT, None, "39.000000", "36.168000"),
    ("bunyan", "kayseri", "Bünyan", RegionType.DISTRICT, None, "38.848000", "35.860000"),
    ("develi", "kayseri", "Develi", RegionType.DISTRICT, None, "38.390000", "35.491000"),
    ("felahiye", "kayseri", "Felahiye", RegionType.DISTRICT, None, "39.090000", "35.570000"),
    ("hacilar", "kayseri", "Hacılar", RegionType.DISTRICT, None, "38.646000", "35.449000"),
    ("incesu", "kayseri", "İncesu", RegionType.DISTRICT, None, "38.623000", "35.183000"),
    ("kocasinan", "kayseri", "Kocasinan", RegionType.DISTRICT, None, "38.740000", "35.480000"),
    ("melikgazi", "kayseri", "Melikgazi", RegionType.DISTRICT, None, "38.720000", "35.510000"),
    ("ozvatan", "kayseri", "Özvatan", RegionType.DISTRICT, None, "39.124000", "35.722000"),
    ("pinarbasi", "kayseri", "Pınarbaşı", RegionType.DISTRICT, None, "38.722000", "36.393000"),
    ("sarioglan", "kayseri", "Sarıoğlan", RegionType.DISTRICT, None, "39.077000", "35.968000"),
    ("sariz", "kayseri", "Sarız", RegionType.DISTRICT, None, "38.477000", "36.502000"),
    ("talas", "kayseri", "Talas", RegionType.DISTRICT, None, "38.690000", "35.553000"),
    ("tomarza", "kayseri", "Tomarza", RegionType.DISTRICT, None, "38.448000", "35.799000"),
    ("yahyali", "kayseri", "Yahyalı", RegionType.DISTRICT, None, "38.098000", "35.358000"),
    ("yesilhisar", "kayseri", "Yeşilhisar", RegionType.DISTRICT, None, "38.348000", "35.088000"),
]

# Yer tutucu: (kod, ad, yolcu, bagaj, çarpan)
VEHICLE_TYPES = [
    ("minivan", "Minivan", 6, 6, D("1.30")),
    ("vip_van", "VIP Van", 6, 6, D("1.60")),
    ("minibus", "Minibüs", 14, 14, D("2.00")),
    # K-35: siyah, VIP donanımlı Sprinter. Çarpan yer tutucu, admin panelinden değiştirilir.
    ("vip_minibus", "VIP Minibüs", 14, 14, D("2.40")),
]
# Hizmetten kaldırılan araç tipleri: eski rezervasyonlar bağlı olduğu için silinmez, pasife alınır.
RETIRED_VEHICLE_TYPES = ["sedan"]

TEMPLATES = [
    ("booking_confirmed", "tr", NotificationChannel.SMS,
     "Rezervasyonunuz onaylandi. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "en", NotificationChannel.SMS,
     "Your booking is confirmed. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "de", NotificationChannel.SMS,
     "Ihre Buchung ist bestaetigt. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "ru", NotificationChannel.SMS,
     "Vashe bronirovanie podtverzhdeno. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    # K-54: admin'in oluşturduğu, ödemesi beklenen rezervasyon. Bağlantı web'de SMS koduyla girişe açılır.
    ("booking_created_admin", "tr", NotificationChannel.SMS,
     "Getaway Transfers rezervasyonunuz olusturuldu. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}, "
     "{total} {currency}. Odeme: {pay_url}"),
    ("booking_created_admin", "en", NotificationChannel.SMS,
     "Your Getaway Transfers booking is created. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}, "
     "{total} {currency}. Pay here: {pay_url}"),
    ("booking_created_admin", "de", NotificationChannel.SMS,
     "Ihre Getaway Transfers Buchung wurde erstellt. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}, "
     "{total} {currency}. Zahlung: {pay_url}"),
    ("booking_created_admin", "ru", NotificationChannel.SMS,
     "Vashe bronirovanie Getaway Transfers sozdano. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}, "
     "{total} {currency}. Oplata: {pay_url}"),
    ("booking_confirmed", "es", NotificationChannel.SMS,
     'Su reserva esta confirmada. Codigo: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_confirmed", "fr", NotificationChannel.SMS,
     'Votre reservation est confirmee. Code : {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_confirmed", "it", NotificationChannel.SMS,
     'La sua prenotazione e confermata. Codice: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_confirmed", "pt", NotificationChannel.SMS,
     'Sua reserva esta confirmada. Codigo: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_confirmed", "ar", NotificationChannel.SMS,
     'تم تأكيد حجزك. الرمز: {booking_code}، {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_confirmed", "zh", NotificationChannel.SMS,
     '您的预订已确认。预订码：{booking_code}，{pickup_at} {pickup} > {dropoff}。getawaytransfers.com'),
    ("booking_confirmed", "ja", NotificationChannel.SMS,
     'ご予約が確定しました。コード：{booking_code}、{pickup_at} {pickup} > {dropoff}。getawaytransfers.com'),
    ("booking_confirmed", "ko", NotificationChannel.SMS,
     '예약이 확정되었습니다. 코드: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com'),
    ("booking_created_admin", "es", NotificationChannel.SMS,
     'Se ha creado su reserva de Getaway Transfers. Codigo: {booking_code}, {pickup_at} {pickup} > {dropoff}, {total} {currency}. Pago: {pay_url}'),
    ("booking_created_admin", "fr", NotificationChannel.SMS,
     'Votre reservation Getaway Transfers est creee. Code : {booking_code}, {pickup_at} {pickup} > {dropoff}, {total} {currency}. Paiement : {pay_url}'),
    ("booking_created_admin", "it", NotificationChannel.SMS,
     'La sua prenotazione Getaway Transfers e stata creata. Codice: {booking_code}, {pickup_at} {pickup} > {dropoff}, {total} {currency}. Pagamento: {pay_url}'),
    ("booking_created_admin", "pt", NotificationChannel.SMS,
     'Sua reserva Getaway Transfers foi criada. Codigo: {booking_code}, {pickup_at} {pickup} > {dropoff}, {total} {currency}. Pagamento: {pay_url}'),
    ("booking_created_admin", "ar", NotificationChannel.SMS,
     'تم إنشاء حجزك لدى Getaway Transfers. الرمز: {booking_code}، {pickup_at} {pickup} > {dropoff}، {total} {currency}. الدفع: {pay_url}'),
    ("booking_created_admin", "zh", NotificationChannel.SMS,
     '您的 Getaway Transfers 预订已创建。预订码：{booking_code}，{pickup_at} {pickup} > {dropoff}，{total} {currency}。付款：{pay_url}'),
    ("booking_created_admin", "ja", NotificationChannel.SMS,
     'Getaway Transfers のご予約を作成しました。コード：{booking_code}、{pickup_at} {pickup} > {dropoff}、{total} {currency}。お支払い：{pay_url}'),
    ("booking_created_admin", "ko", NotificationChannel.SMS,
     'Getaway Transfers 예약이 생성되었습니다. 코드: {booking_code}, {pickup_at} {pickup} > {dropoff}, {total} {currency}. 결제: {pay_url}'),
    ("dispatch_offer", "tr", NotificationChannel.PUSH, "Yeni iş: {pickup} > {dropoff}"),
]


GUIDE_STEPS = [
    {"tr": "Pasaport kontrolünden sonra bagajınızı alın. Uygulamada \"İndim\" ve \"Bagajdayım\"a dokunun; sürücünüz görür.",
     "en": "After passport control, collect your luggage. Tap \"Landed\" and \"At baggage\" in the app; your driver sees it.",
     "de": "Holen Sie nach der Passkontrolle Ihr Gepäck. Tippen Sie in der App auf \"Gelandet\" und \"Am Gepäckband\"; Ihr Fahrer sieht es.",
     "ru": "После паспортного контроля получите багаж. Нажмите в приложении \"Приземлился\" и \"У багажа\" — водитель увидит.",
     "es": "Tras el control de pasaportes, recoja su equipaje. Toque \"He aterrizado\" y \"En el equipaje\" en la app; su conductor lo verá.",
     "fr": "Après le contrôle des passeports, récupérez vos bagages. Touchez \"J'ai atterri\" puis \"Aux bagages\" dans l'application ; votre chauffeur le verra.",
     "it": "Dopo il controllo passaporti, ritiri i bagagli. Tocchi \"Atterrato\" e \"Ai bagagli\" nell'app; il suo autista lo vedrà.",
     "pt": "Depois do controle de passaportes, pegue sua bagagem. Toque em \"Pousei\" e \"Na bagagem\" no app; seu motorista verá.",
     "ar": "بعد ختم الجوازات، استلم أمتعتك. اضغط \"هبطت\" ثم \"عند الأمتعة\" في التطبيق؛ سيرى السائق ذلك.",
     "zh": "通过护照检查后提取行李。在应用中点按“已落地”和“在取行李”，司机即可看到。",
     "ja": "入国審査の後、手荷物を受け取ってください。アプリで「着陸しました」「手荷物受取中」をタップすると、ドライバーに伝わります。",
     "ko": "입국 심사 후 수하물을 찾으세요. 앱에서 \"착륙했어요\"와 \"수하물 찾는 중\"을 누르면 기사님이 확인합니다."},
    {"tr": "Gümrükten geçip çıkış kapısından karşılama salonuna çıkın. Çıkarken \"Çıkıyorum\"a dokunun.",
     "en": "Pass customs and walk through the exit doors to the arrivals hall. Tap \"Heading out\" as you leave.",
     "de": "Gehen Sie durch den Zoll und die Ausgangstür in die Ankunftshalle. Tippen Sie dabei auf \"Ich komme raus\".",
     "ru": "Пройдите таможню и выйдите в зал прилёта. Выходя, нажмите \"Выхожу\".",
     "es": "Pase la aduana y salga por las puertas al vestíbulo de llegadas. Toque \"Estoy saliendo\" al salir.",
     "fr": "Passez la douane et franchissez les portes de sortie vers le hall des arrivées. Touchez \"Je sors\" en sortant.",
     "it": "Passi la dogana ed esca dalle porte verso la sala arrivi. Tocchi \"Sto uscendo\" mentre esce.",
     "pt": "Passe pela alfândega e saia pelas portas para o saguão de desembarque. Toque em \"Estou saindo\" ao sair.",
     "ar": "اعبر الجمارك واخرج من البوابات إلى صالة الوصول. اضغط \"أنا خارج\" أثناء خروجك.",
     "zh": "通过海关后从出口门进入到达大厅。离开时点按“正在出来”。",
     "ja": "税関を通過し、出口ドアから到着ロビーへお進みください。出るときに「今出ます」をタップしてください。",
     "ko": "세관을 통과해 출구 문을 지나 입국장으로 나오세요. 나올 때 \"나가는 중\"을 누르세요."},
    {"tr": "Sürücünüz karşılama alanında adınızın yazılı olduğu tabelayla bekler. Fotoğrafı ve plakası uygulamada.",
     "en": "Your driver waits in the arrivals area holding a sign with your name. Their photo and plate are in the app.",
     "de": "Ihr Fahrer wartet im Ankunftsbereich mit einem Schild mit Ihrem Namen. Foto und Kennzeichen finden Sie in der App.",
     "ru": "Водитель ждёт в зоне встречи с табличкой с вашим именем. Фото и номер машины — в приложении.",
     "es": "Su conductor le espera en la zona de llegadas con un cartel con su nombre. Su foto y matrícula están en la app.",
     "fr": "Votre chauffeur vous attend dans la zone des arrivées avec une pancarte à votre nom. Sa photo et la plaque figurent dans l'application.",
     "it": "Il suo autista l'attende nell'area arrivi con un cartello con il suo nome. Foto e targa sono nell'app.",
     "pt": "Seu motorista espera na área de desembarque com uma placa com seu nome. A foto e a placa do carro estão no app.",
     "ar": "ينتظرك السائق في منطقة الوصول حاملًا لافتة باسمك. صورته ورقم اللوحة في التطبيق.",
     "zh": "司机会在到达区举着写有您姓名的接机牌等候。司机照片和车牌号可在应用中查看。",
     "ja": "ドライバーはお名前を書いたボードを持って到着エリアでお待ちしています。顔写真とナンバーはアプリで確認できます。",
     "ko": "기사님이 입국장에서 고객님 이름이 적힌 피켓을 들고 기다립니다. 사진과 차량 번호는 앱에 있습니다."},
    {"tr": "Göremezseniz uygulamadan sürücünüze yazın; mesajınız onun diline çevrilir.",
     "en": "Can't spot them? Message your driver in the app; your message is translated into their language.",
     "de": "Sie sehen ihn nicht? Schreiben Sie Ihrem Fahrer in der App; Ihre Nachricht wird übersetzt.",
     "ru": "Не видите водителя? Напишите ему в приложении — сообщение будет переведено.",
     "es": "¿No lo ve? Escriba a su conductor desde la app; su mensaje se traduce a su idioma.",
     "fr": "Vous ne le voyez pas ? Écrivez à votre chauffeur dans l'application ; votre message est traduit dans sa langue.",
     "it": "Non lo vede? Scriva al suo autista nell'app; il messaggio viene tradotto nella sua lingua.",
     "pt": "Não o encontrou? Escreva ao motorista pelo app; sua mensagem é traduzida para o idioma dele.",
     "ar": "لا تراه؟ راسل السائق من التطبيق؛ تُترجم رسالتك إلى لغته.",
     "zh": "没看到司机？在应用中给司机发消息，您的消息会被翻译成司机的语言。",
     "ja": "見つからない場合は、アプリからドライバーにメッセージを送ってください。ドライバーの言語に翻訳されます。",
     "ko": "기사님이 보이지 않나요? 앱에서 메시지를 보내세요. 기사님의 언어로 번역됩니다."},
]


def run(db: Session) -> None:
    ensure_roles(db)

    existing_regions = set(db.scalars(select(Region.code)))
    for code, province, name, rtype, iata, lat, lng in REGIONS:
        if code not in existing_regions:
            db.add(Region(code=code, province=province, name=name, type=rtype, iata_code=iata,
                          latitude=D(lat), longitude=D(lng)))

    types = {vt.code: vt for vt in db.scalars(select(VehicleType))}
    for code, name, cap, lug, mult in VEHICLE_TYPES:
        if code not in types:
            vt = VehicleType(code=code, name=name, capacity=cap, luggage_capacity=lug, price_multiplier=mult)
            db.add(vt)
            types[code] = vt
    for code in RETIRED_VEHICLE_TYPES:
        if code in types:
            types[code].is_active = False
    db.flush()

    # K-03, K-04: 1,10 €/km, minimum 30 €, 5'in katına yuvarlama
    ruled = set(db.scalars(select(PricingRule.vehicle_type_id)))
    for vt in types.values():
        if vt.is_active and vt.id not in ruled:
            db.add(PricingRule(vehicle_type_id=vt.id, base_price_per_km=D("1.10"), minimum_price=D("30"),
                               rounding_step=D("5"), valid_from=EPOCH))

    # K-14
    if db.scalar(select(CancellationPolicy.id).limit(1)) is None:
        db.add(CancellationPolicy(name="Standart (48/24 saat)", valid_from=EPOCH, tiers=[
            CancellationPolicyTier(hours_before_pickup=48, refund_percent=100),
            CancellationPolicyTier(hours_before_pickup=24, refund_percent=50),
            CancellationPolicyTier(hours_before_pickup=0, refund_percent=0),
        ]))

    # K-02, K-75: genel %20
    if db.scalar(select(CommissionRule.id).where(CommissionRule.scope == CommissionScope.GENERAL).limit(1)) is None:
        db.add(CommissionRule(scope=CommissionScope.GENERAL, rate=D("0.20"), valid_from=EPOCH))

    # K-30: gidiş-dönüş indirimi %5
    if db.scalar(select(RoundTripDiscount.id).limit(1)) is None:
        db.add(RoundTripDiscount(type=DiscountType.PERCENT, value=D("5"), valid_from=EPOCH))

    # K-62: havalimanı buluşma rehberi (genel adımlar; admin fotoğraf ve terminal ayrıntısı ekler).
    db.flush()
    for region in db.scalars(select(Region).where(Region.type == RegionType.AIRPORT)):
        if db.scalar(select(MeetingGuide.id).where(MeetingGuide.region_id == region.id).limit(1)) is None:
            db.add(MeetingGuide(region_id=region.id, terminal="", steps=[{"texts": t, "photo_key": None}
                                                                        for t in GUIDE_STEPS]))
    # K-77: varsayılan metni değişmemiş adımlara yeni dillerin karşılığı eklenir; admin'in yazdığına dokunulmaz.
    for guide in db.scalars(select(MeetingGuide)):
        steps = [dict(st) for st in guide.steps or []]
        changed = False
        for i, st in enumerate(steps[: len(GUIDE_STEPS)]):
            texts = dict(st.get("texts") or {})
            if texts.get("tr") != GUIDE_STEPS[i]["tr"]:
                continue
            missing = {k: v for k, v in GUIDE_STEPS[i].items() if k not in texts}
            if missing:
                st["texts"] = {**texts, **missing}
                changed = True
        if changed:
            guide.steps = steps

    have = set(db.execute(select(NotificationTemplate.code, NotificationTemplate.locale,
                                 NotificationTemplate.channel)).all())
    for code, locale, channel, body in TEMPLATES:
        if (code, locale, channel) not in have:
            db.add(NotificationTemplate(code=code, locale=locale, channel=channel, body=body))
    db.flush()
