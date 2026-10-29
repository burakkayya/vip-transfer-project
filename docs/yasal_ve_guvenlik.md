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
- Uçuş verisi yolculuktan 24 saat sonra silinir (K-18).
- Kart verisi tutulmaz, ödeme sağlayıcının sayfası kullanılır.
- Hassas alanlar (telefon, e-posta, belge yolu, 2FA sırrı) alan düzeyinde şifrelenir. Anahtarlar KMS ile yönetilir.
- Her erişim (admin dahil) `audit_logs` tablosuna yazılır. Log kayıtları değiştirilemez.
- Admin girişi 2FA ile korunur. Paylaşımlı admin hesabı yoktur.
- Sürücüye yalnızca karşılama için gereken bilgiler gösterilir.
- Google Routes ve FCM gibi servislere yalnızca koordinat ve rota veya bildirim tokenı gönderilir, kimlik bilgisi gönderilmez.
- Yedekleme, şifreli ve Türkiye'de tutulur. Felaket kurtarma senaryosu yazılır.

## Veri saklama süreleri (taslak, doğrulanacak)

| Veri | Süre |
|---|---|
| Uçuş bilgisi | Yolculuk bitimi + 24 saat |
| Müşteri hesabı | Son rezervasyondan itibaren belirlenen süre (hukukçu teyidi) |
| Rezervasyon ve fatura kayıtları | Vergi mevzuatına göre (hukukçu teyidi) |
| Sürücü belgeleri | Sürücü aktif olduğu süre + yasal saklama süresi |
| Denetim kayıtları | Hukukçu teyidi ile belirlenecek |

## Müşteri hakları

- Aydınlatma metni, açık rıza ve pazarlama onayı ayrı alınır.
- Erişim, düzeltme ve silme talepleri için `data_requests` akışı kurulur.
- Yurt dışı müşteriler için GDPR haklarının karşılığı uygulanır.
