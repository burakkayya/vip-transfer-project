# Yasal Uyum ve Güvenlik

Bu dosya hukuki danışmanlık değildir. Maddeler bir hukukçuyla doğrulanmalıdır.

## Mevzuat

| Konu | Açıklama | Durum |
|---|---|---|
| TÜRSAB | Seyahat acentesi üyeliği, hizmetin acente üzerinden satışı | Mevcut, doğrulanacak |
| Turizm taşımacılığı yetki belgesi | Sürücü ve araç bazında Ulaştırma Bakanlığı belgesi | Sürücü kaydında kontrol edilecek |
| Araç ticari plaka ve yetki | Araç bazında belge | Sürücü kaydında kontrol edilecek |
| KVKK | Kişisel verilerin işlenmesi, aydınlatma, açık rıza, veri talebi | Tasarımda kapsanıyor |
| GDPR | AB'deki müşteriler için ek gereksinimler | Tasarımda kapsanıyor |
| Mesafeli Sözleşmeler Yönetmeliği | Ön bilgilendirme, cayma hakkı istisnaları | Hukuki teyit bekliyor |
| e-Arşiv Fatura | GİB onaylı fatura zorunluluğu | Entegratör ile çözülecek |
| Sigorta mevzuatı | Tam iade garantisi ürününün yapısı | Hukuki teyit bekliyor |

## Veri güvenliği

- Pasaport bilgisi sistemde tutulmaz, yalnızca yetkili kurumlara iletilir (K-17).
- Uçuş verisi yolculuk tamamlanınca silinir (K-31). Kuruma bildirim gerekiyorsa bildirimden sonra silinir.
- Kart verisi tutulmaz, ödeme sağlayıcının sayfası kullanılır.
- Hassas alanlar (telefon, e-posta, belge yolu, 2FA sırrı) alan düzeyinde şifrelenir. Anahtarlar şu an ortam değişkeninden okunur; KMS ile yönetim hedeftir, henüz kurulmadı (`docs/security/findings.md` MON-10, DB-08, DB-09). Kesin alış ve bırakış koordinatları şifresizdir (DB-04).
- K-83: hatalar ve alarmlar `incidents` tablosunda (ayrıntı maskelenmiş ve şifreli), rezervasyon adımları `booking_activities` tablosunda (yalnızca eklenebilir, konum yalnızca önemli anda ve şifreli) tutulur. Admin'de yalnızca admin ve operasyon görür; yolculuk geçmişi gerekçeyle açılır ve denetime düşer. Olay e-postası kişisel veri içermez; istemci hata raporları e-posta göndermez ve başlıkları sabittir. Silme talebinde olay anı konumları da boşaltılır. Konum admin'de koordinat olarak gösterilir, harita servisine gönderilmez. Loglarda telefon, e-posta ve gerçek yol yazılmaz; istek kimliği ve yol şablonu yazılır.
- Yazma işlemleri, girişler, belge ve sohbet görüntüleme ile güvenlik olayları `audit_logs` tablosuna yazılır. Admin rezervasyon detayı gibi okuma işlemlerinin tamamı kayda girmez (PRIV-07). Kayıtlar veritabanı tetikleyicisiyle değiştirilemez; veritabanı sahibi rolü tetikleyiciyi atlatabilir (DB-02).
- Admin girişi 2FA ile korunur. Paylaşımlı admin hesabı yoktur.
- Sürücüye yalnızca karşılama için gereken bilgiler gösterilir.
- Google Routes ve FCM gibi servislere yalnızca koordinat ve rota veya bildirim tokenı gönderilir, kimlik bilgisi gönderilmez.
- İstisna (K-62, hukuki teyit bekliyor, varsayılan kapalı): sohbet çevirisi açıksa mesaj metni Google Cloud Translation'a gider; telefon ve e-posta gönderilmeden maskelenir.
- Yedekleme hedefi: şifreli ve Türkiye'de. Yedekleme yapılandırması ve felaket kurtarma senaryosu henüz yok (DB-12, `acik_konular.md`).
- Güvenlik denetimi (2026-11-14): tehdit modeli, bulgular ve düzeltme planı `docs/security/` altındadır. Açık bildirimi: kök `SECURITY.md`.

## Veri saklama süreleri (K-83, taslak, hukukçu teyidi bekliyor)

Tek kaynak `backend/app/retention.py`; günlük görev (`retention.purge`) uygular. Şifreleme saklama süresinin yerine
geçmez (KVKK m.4, GDPR m.5).

| Veri | Süre | İşlem | Dayanak |
|---|---|---|---|
| Yolculuk geçmişi (`booking_activities`) | 2 yıl | Silinir | Uyuşmazlık ve şikâyet incelemesi |
| Olay anındaki konum (geçmiş ve `trip_events`) | 180 gün | Konum boşaltılır | Kanıtlı bekleme ve şikâyet |
| Denetim kaydı (`audit_logs`) | 2 yıl | Silinir | 5651 erişim kaydı, güvenlik incelemesi |
| Olay tekrarları (`incident_occurrences`) | 180 gün | Silinir | Teşhis |
| Olay (`incidents`, açık ya da çözülmüş) | Son görülmeden 1 yıl | Silinir | Teşhis, tekrar analizi |
| Biten oturumlar (`sessions`, IP içerir) | Bitişten 90 gün | Silinir | Güvenlik incelemesi |
| Uçuş bilgisi | Yolculuk tamamlanınca (bildirim gerekiyorsa bildirimden sonra) | Silinir | K-31 |
| Sohbet mesajları | Yolculuktan 30 gün | Silinir | K-50 |
| SMS doğrulama kodları | 1 gün | Silinir | Kimlik doğrulama |
| Rezervasyon, ödeme ve fatura | 10 yıl | Saklanır; silme talebinde kişisel alanlar anonimleşir (K-70) | VUK 253, TTK 82 |
| Müşteri hesabı | Son rezervasyondan itibaren belirlenecek süre | Henüz uygulanmadı | Hukukçu teyidi |
| Sürücü belgeleri | Sürücü aktif olduğu süre + yasal saklama süresi | Henüz uygulanmadı | Hukukçu teyidi |

## Müşteri hakları

- Aydınlatma metni, açık rıza ve pazarlama onayı ayrı alınır.
- Erişim, düzeltme ve silme talepleri için `data_requests` akışı kurulur.
- Yurt dışı müşteriler için GDPR haklarının karşılığı uygulanır.
