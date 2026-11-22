# K-83: Olay kaydı, hata bildirimi, yolculuk geçmişi ve saklama süreleri

Tarih: 2026-11-23. Kullanıcı kararları (soru-cevap):

- Saklama: **amaca göre süre**. Her veri türünün yasal dayanağı ve süresi var; süresi dolan veri otomatik silinir ya da anonimleşir. Kişisel alanlar veritabanında şifreli.
- Bildirim: **admin paneli + e-posta**. Veri yurt dışına çıkmaz, harici izleme servisi yok.
- Yolculuk geçmişi: **adımlar + önemli anda konum**. Tam GPS izi tutulmaz.
- Erişim: **admin + operasyon, gerekçeyle**. Destek göremez; kişisel ayrıntı (yolculuk geçmişi) gerekçe yazılarak açılır ve açılış denetim kaydına düşer (K-55 ile aynı model).

## Neden "her şeyi süresiz tut" değil

KVKK m.4 ve GDPR m.5: veri amaçla sınırlı, ölçülü ve gerektiği kadar saklanır. Şifreleme bu ilkenin yerine geçmez. Bu yüzden her yeni kayıt türü bir saklama süresiyle birlikte gelir ve süreler tek bir politika dosyasında (`backend/app/retention.py`) toplanır.

## Bileşenler

### 1. İstek kimliği ve yapılandırılmış log

- Her istek bir `request_id` alır (gelen `X-Request-ID` geçerliyse o, yoksa yeni). Yanıtta `X-Request-ID` döner; 500 yanıtında da gövdede `error.request_id` bulunur. Kullanıcı "hata kodu" olarak bunu iletebilir.
- Web ve admin BFF backend'e giden her isteğe kendi ürettiği kimliği ekler; tarayıcı hata raporu aynı kimliği taşır. Böylece tek bir olay web → BFF → backend boyunca izlenir.
- Loglar üretimde tek satır JSON: zaman, seviye, ileti, `request_id`, yöntem, yol şablonu (`/bookings/{code}`; sorgu dizesi yazılmaz), durum, süre, aktör tipi ve kimliği (UUID; telefon/e-posta değil).

### 2. Olaylar (incident) ve bildirim

- `incidents`: aynı hatanın tekrarları tek kayıtta toplanır (parmak izi = kaynak + tür + kod + kod konumu). Alanlar: seviye, kaynak (backend, worker, web, admin, mobil müşteri, mobil sürücü), tür, başlık, ayrıntı (şifreli, maskelenmiş), durum (açık / incelemede / çözüldü), tekrar sayısı, ilk ve son görülme, çözüm notu.
- `incident_occurrences`: her tekrarın senaryosu: zaman, `request_id`, yol şablonu, durum kodu, aktör, ilgili rezervasyon/bacak, platform ve uygulama sürümü, kod konumu (dosya:satır). Bağlam maskelenir ve şifreli tutulur.
- Kaynaklar: yakalanmamış istisna (500), zamanlanmış iş hatası, mevcut "GÜVENLİK ALARMI" noktaları, ödeme bildirimi reddi, iade hataları, dış sağlayıcı hataları (SMS, push, uçuş, rota), istemci hata raporu (web, admin, mobil; `POST /api/v1/client-errors`, IP başına sınırlı).
- E-posta: hata ve kritik seviyede yeni ya da yeniden açılan olayda; aynı olay için en fazla saatte bir. E-posta kişisel veri içermez: başlık, seviye, kaynak, tekrar sayısı ve admin bağlantısı. Sağlayıcı: `console` (geliştirme) veya `smtp` (üretim; TLS zorunlu). Alıcılar ortam değişkeninden.
- Admin "Olaylar" ekranı: liste (durum, seviye, kaynak süzgeci), ayrıntı (senaryo: tekrarlar, ilgili rezervasyonun geçmişine bağlantı), "İncelemeye al" ve "Çözüldü" (not zorunlu). Menüde açık olay sayısı.

### 3. Yolculuk geçmişi (rezervasyon bazında)

- `booking_activities`: yalnızca eklenebilir (veritabanı tetikleyicisi; yalnızca saklama görevi silebilir). Alanlar: rezervasyon, bacak, zaman, aktör tipi (müşteri, sürücü, personel, sistem) ve kimliği, olay kodu, platform (web, ios, android, admin, sistem), uygulama sürümü, `request_id`, ayrıntı (kişisel veri içermez), konum (yalnızca önemli anlarda; şifreli).
- Kaydedilen adımlar: rezervasyon oluşturma, ödeme başlatma ve sonucu, iptal, iade, eşleştirme teklifi (gönderildi, kabul, ret, süre doldu), atama, sürücü adımları (yola çıktı, vardı, yolcu alındı, bitti, yolcu gelmedi; konumlu), operasyonun zorla ilerletmesi, müşteri bitirişi, mesaj gönderimi (yalnızca sayı, metin değil), değerlendirme, bahşiş, uçuş saati değişimi, bildirim gönderimi ve hatası, rezervasyona bağlı olaylar (incident).
- Admin görünümü bu tabloyu, mevcut `trip_events` ve rezervasyona bağlı denetim kayıtlarıyla birleştirip zaman sırasıyla gösterir (eski rezervasyonlar da boş kalmaz).

### 4. Saklama süreleri (taslak, hukukçu teyidi)

| Veri | Süre | İşlem | Dayanak |
|---|---|---|---|
| Yolculuk geçmişi (`booking_activities`) | 2 yıl | Silinir | Uyuşmazlık ve şikâyet incelemesi |
| Olay anındaki konum (geçmiş ve `trip_events`) | 180 gün | Konum boşaltılır | Kanıtlı bekleme / şikâyet; sonra gereksiz |
| Denetim kaydı (`audit_logs`) | 2 yıl | Silinir | 5651 erişim kayıtları, güvenlik incelemesi |
| Olay tekrarları (`incident_occurrences`) | 180 gün | Silinir | Teşhis |
| Çözülmüş olay (`incidents`) | Son görülmeden 1 yıl | Silinir | Teşhis, tekrar analizi |
| Süresi dolmuş oturumlar (`sessions`, IP içerir) | Bitişten 90 gün | Silinir | Güvenlik incelemesi |
| Uçuş bilgisi | Yolculuk bitince | Silinir | K-31 (değişmedi) |
| Sohbet mesajları | Yolculuktan 30 gün | Silinir | K-50 (değişmedi) |
| SMS kodları | 1 gün | Silinir | (değişmedi) |
| Rezervasyon, ödeme, fatura | 10 yıl | Saklanır | VUK / TTK (değişmedi; silme talebinde kişisel alanlar anonimleşir, K-70) |

Silme, veritabanı tetikleyicisini yalnızca saklama görevinin işlem içi bayrağıyla (`SET LOCAL getaway.retention_purge = 'on'`) geçer; uygulamanın başka hiçbir yolu kayıt değiştiremez.
