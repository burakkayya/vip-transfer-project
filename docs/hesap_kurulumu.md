# Dış Hesap Kurulumu (ücretsiz adımlar)

Bu hesapları yalnızca şirket sahibi açabilir (kimlik, kart veya şirket bilgisi ister). Kod tarafı hazır; anahtar alınca yalnızca ortam değişkeni girilir. Anahtarlar repoya yazılmaz, sunucunun `.env` dosyasına veya gizli değişken yöneticisine girilir.

| # | Hesap | Ücret | Ne yapılır | Anahtar nereye girilir |
|---|---|---|---|---|
| 1 | Authenticator (Google Authenticator, Microsoft Authenticator veya 1Password) | Ücretsiz | Telefona kurun. `http://localhost:3001` admin girişinde çıkan QR kodu okutun, 6 haneli kodu girin, sonra **Parolamı değiştir**. | Kod yok, cihazda kalır |
| 2 | Google Cloud | Aylık ücretsiz kota; kart ister | Proje açın. **Places API (New)** ve **Routes API**'yi etkinleştirin. **Faturalandırma > Bütçeler**'de 10 $ bütçe uyarısı kurun. **API anahtarı** oluşturun, **Uygulama kısıtlaması: IP adresleri** (sunucu IP'si), **API kısıtlaması**: yalnızca bu iki API. | `backend/.env`: `GETAWAY_GOOGLE_MAPS_API_KEY`, `GETAWAY_GOOGLE_ROUTES_API_KEY`, `GETAWAY_PLACES_PROVIDER=google`, `GETAWAY_ROUTING_PROVIDER=google` |
| 2a | Google Cloud: Maps SDK for Android (mobil harita, K-37) | Mobil yerel harita yüklemeleri şu an ücretlendirilmiyor; aynı proje ve faturalandırma | Aynı projede **Maps SDK for Android**'i etkinleştirin. Ayrı bir **API anahtarı** oluşturun: **Uygulama kısıtlaması: Android uygulamaları**, paket adları `com.getawaytransfers.app` ve `com.getawaytransfers.driver` ve her biri için imza sertifikası SHA-1 (EAS: `npx eas-cli credentials`); **API kısıtlaması**: yalnızca Maps SDK for Android. Expo Go ile geliştirmede gerekmez. iOS Apple Maps anahtar istemez. | Derleme ortamı / EAS gizli değişkeni: `GETAWAY_GOOGLE_MAPS_ANDROID_KEY` (`mobile/app.config.ts` → `android.config.googleMaps.apiKey`) |
| 3 | PayTR test mağazası | Başvuru ve test modu ücretsiz | paytr.com > Mağaza başvurusu. Onaydan sonra **Mağaza Paneli > Bilgi**'den Merchant ID, Key, Salt alınır. **Bildirim URL** olarak `https://api.getawaytransfers.com/api/v1/payments/paytr/callback` girilir. | `GETAWAY_PAYMENT_PROVIDER=paytr`, `GETAWAY_PAYTR_MERCHANT_ID`, `GETAWAY_PAYTR_MERCHANT_KEY`, `GETAWAY_PAYTR_MERCHANT_SALT`, `GETAWAY_PAYTR_TEST_MODE=true` |
| 4 | Firebase (FCM) | Ücretsiz | Firebase konsolunda proje açın, Android uygulaması ekleyin: `com.getawaytransfers.app` ve `com.getawaytransfers.driver`. **Proje ayarları > Hizmet hesapları > Yeni özel anahtar** ile JSON indirin. iOS için Apple Developer hesabı (ücretli) gerekir. | JSON dosyası sunucuda gizli konumda; push gönderici bağlanınca yolu ortam değişkenine girilecek (bkz. `acik_konular.md`) |
| 5 | Expo (EAS) | Ücretsiz katman | expo.dev'de hesap açın. Bilgisayarda `npx eas-cli login`, sonra `mobile` klasöründe `npx eas-cli init`. Derleme profilleri hazır: `mobile/eas.json` (`preview`, `preview-driver`, `production`, `production-driver`). Android test APK'sı: `npx eas-cli build -p android --profile preview`. | `eas init` proje kimliğini `app.config.ts`'e ekler |
| 6 | Mağaza hesapları | Apple 99 $/yıl, Google Play 25 $ tek sefer | Ücretli; yayın aşamasında. | `eas submit` |
| 7 | Netgsm | Hesap ücretsiz, SMS kredisi ücretli | Hesap açın, **SMS başlığı** (ör. GETAWAY) için başvurun. Başlık onaylanınca kredi alın. | `GETAWAY_SMS_PROVIDER=netgsm`, `GETAWAY_NETGSM_USERCODE`, `GETAWAY_NETGSM_PASSWORD`, `GETAWAY_NETGSM_HEADER` |
| 8 | Cloudflare | Ücretsiz | Hesap açın, alan adını ekleyin, ad sunucularını Turhost'ta Cloudflare'inkilerle değiştirin. **Zero Trust > Access**'te `admin.getawaytransfers.com` için uygulama tanımlayıp yalnızca şirket e-postalarına izin verin (50 kullanıcıya kadar ücretsiz). | DNS, kod gerekmez |
| 9 | Hukukçu | Ücretli | Şirket unvanı, adres, TÜRSAB belge no, MERSİS no hazırlanır. | `web/lib/site.ts` içindeki `[...]` yer tutucuları |

## Sıra önerisi

1. Authenticator (admin paneline girebilmek için şart, eşleştirme ekranı planlı rezervasyonlar için gerekli).
2. Google Cloud (gerçek adres arama ve mesafe; şu an örnek yerler ve kuş uçuşu mesafe).
3. PayTR test mağazası (gerçek ödeme sayfası denemesi).
4. Expo hesabı ve ilk Android APK (telefonda deneme).
5. Firebase, Netgsm, Cloudflare (canlıya çıkmadan önce).
