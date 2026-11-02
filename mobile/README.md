# Mobil (müşteri ve sürücü)

Expo SDK 58 (React Native 0.88, React 19.3) + expo-router + TypeScript. Tasarım: Uber tarzı siyah-beyaz, araç fotoğraflı seçim. Tek kod tabanından iki uygulama çıkar.
Kapsam: `docs/ekranlar.md`, "Müşteri mobil" ve "Sürücü mobil".

| Uygulama | Web önizleme (VS Code) | Telefonda | Paket kimliği | Dil |
|---|---|---|---|---|
| Müşteri | `npm run web` → http://localhost:8081 | `npm start` | `com.getawaytransfers.app` | tr, en, de, ru (cihaz diline göre) |
| Sürücü | `npm run web:driver` → http://localhost:8082 | `npm run start:driver` | `com.getawaytransfers.driver` | tr |

## VS Code içinde test

1. Kök dizinde **Tasks: Run Task** → **Getaway: Tümünü başlat** (backend, web, admin ve iki mobil önizleme).
2. `Ctrl+Shift+P` → **Simple Browser: Show** → `http://localhost:8081` (müşteri) veya `http://localhost:8082` (sürücü).
3. Uygulama telefon boyutunda bir çerçevede açılır. SMS kodu ekranda sarı kutuda görünür. Senaryolar: `docs/test_senaryolari.md`.

Web önizlemesi yalnızca geliştirme içindir. Jetonlar orada `localStorage`'da tutulur (`lib/storage.web.ts`); mağaza uygulamaları Keychain ve Keystore kullanır. Tarih seçici web'de tarayıcının alanıdır (`DateTimeField.web.tsx`).
İki çeşidin önbellekleri ayrıdır (`metro.config.js`). Biri diğerinin derlemesini almaz, ikisi aynı anda açılabilir.

## Test ve lint

- `npm test` → jest-expo + React Native Testing Library (`__tests__/`). RNTL 14'te `render` asenkrondur: `await render(<... />)`.
- Yerel modüller `jest.setup.ts` içinde taklit edilir (Reanimated, haptics, secure-store). Reanimated 4 için `jest.config.js` paketin kendi çözücüsünü kullanır.
- `npm run lint` → ESLint 9 (`eslint-config-expo/flat`). Mevcut bulgular `docs/ui-review/lint-taban.md` "mobile" bölümünde.
- `npm run typecheck` → `tsc --noEmit`.

## Android emülatöründe

Bu bilgisayarda Android SDK ve `getaway_pixel7` sanal cihazı (Pixel 7, Android 15) kurulu: `%LOCALAPPDATA%\Android\Sdk`. Android Studio gerekmez.

1. **Tasks: Run Task** → **Getaway: Android emülatörünü aç**.
2. **Getaway: Mobil müşteri (Android emülatör)** veya **Getaway: Mobil sürücü (Android emülatör)**. Expo, emülatöre Expo Go'yu kurar ve uygulamayı açar.
3. İki uygulama arasında Expo Go ana ekranındaki **Recent history** listesinden geçilir.

- Emülatör bilgisayarın backend'ine `10.0.2.2:8000` üzerinden ulaşır (görevler bu adresi verir).
- Kod değişince uygulama kendiliğinden yenilenir (Fast Refresh). Yenilenmezse emülatörde `R` tuşuna iki kez basın.
- Sahte ödeme sayfası uygulama içi tarayıcıda açılır, "Ödemeyi onayla"dan sonra pencereyi kapatıp uygulamaya dönün.
- Sistemdeki `JAVA_HOME` artık var olmayan bir Android Studio klasörünü gösteriyor. Expo Go için gerekmez; ileride yerel derleme (EAS dışı) yapılırsa `C:\Program Files\Java\jdk-21` olarak düzeltilmeli.

## Telefonda (Expo Go)

```
set GETAWAY_API_URL=http://192.168.1.20:8000     # bilgisayarın yerel ağ IP'si; telefon localhost'a ulaşamaz
set GETAWAY_WEB_URL=http://192.168.1.20:3000
npm start                                        # Expo Go ile QR okutun (Expo Go SDK 58 sürümü)
```

Backend'i `uvicorn ... --host 0.0.0.0` ile başlatın (VS Code görevi böyle başlatır).

## Ekranlar

| Müşteri | Dosya |
|---|---|
| 1 Giriş (telefon + SMS kodu) | `app/login.tsx` |
| 2 Rezervasyonlarım ve detay (zaman çizelgesi, sürücü kartı) | `app/(customer)/bookings.tsx`, `app/booking/[code].tsx` |
| 3 Yeni rezervasyon: adres arama (ilçe bazlı fiyat), araç, bilgiler, onaylar | `app/(customer)/book.tsx`, `components/AddressField.tsx` |
| 4 Canlı sürücü takibi (WebSocket) | `app/booking/[code].tsx` |
| 5 İptal (iade önizlemeli) | `app/booking/[code].tsx` |
| 6 Profil, pazarlama tercihi, veri talebi | `app/(customer)/profile.tsx` |

| Sürücü | Dosya |
|---|---|
| 1 Kayıt ve belge yükleme | `app/driver-register.tsx`, `app/(driver)/documents.tsx` |
| 2 Onay bekleme ve belge durumu | `app/(driver)/home.tsx`, `app/(driver)/documents.tsx` |
| 3 Çevrimiçi/çevrimdışı, yaklaşan işler | `app/(driver)/home.tsx` |
| 4 İş teklifi kabul/red (geri sayımlı) | `app/(driver)/home.tsx` |
| 5 Yolculuk akışı (yola çıktım, vardım, yolcu alındı, tamamlandı) | `app/trip/[legId].tsx` |
| 6 Navigasyon bağlantısı ve karşılama bilgisi | `app/trip/[legId].tsx` |
| 7 Kazanç ve hakediş geçmişi | `app/(driver)/earnings.tsx` |
| 8 Belge takibi ve süre uyarıları | `app/(driver)/documents.tsx` |
| 9 Canlı konum paylaşımı (geliştirmede "konum gönder" düğmesi) | `app/trip/[legId].tsx` |

Tasarım bileşenleri `components/ui.tsx` içindedir: renkler, Ionicons, başlık bandı, adım göstergesi, zaman çizelgesi, seçim kartları.

## Güvenlik

- Jetonlar cihazın güvenli deposunda (iOS Keychain, Android Keystore) tutulur. Yenileme jetonu her kullanımda değişir; eşzamanlı yenilemeler tek istekte birleştirilir.
- Adres araması backend üzerinden yapılır. Google anahtarı uygulamada yoktur. Fiyat backend'in imzaladığı adres jetonuyla istenir.
- WebSocket'te jeton URL'de değil ilk mesajda gönderilir.
- Ödeme sağlayıcının sayfası uygulama içi tarayıcıda açılır. Uygulama kart verisine erişmez.
- Konum yalnızca aktif yolculukta ve yolculuk ekranı açıkken paylaşılır. Arka plan konum izni istenmez.

## SDK 58 yükseltmesi (53 → 58)

- Tüm Expo modülleri `npx expo install --fix` ile SDK 58'e hizalandı, `npx expo install --check` temiz.
- SDK 53'teki `expo-router` paketleme hatası (`query-string` bağımlılığı eksikti) 58'de giderildiği için geçici bağımlılık kaldırıldı.
- Web önizlemesi için `react-native-web` ve `@expo/metro-runtime`, ikonlar için `@expo/vector-icons` eklendi.
- TypeScript 6.0 ve `@types/react` 19.3 kullanılıyor.

## Bekleyenler

- Push bildirimi (FCM) hesabı açılınca `expo-notifications` eklenecek. O zamana kadar sürücü, çevrimiçiyken teklifleri 8 saniyede bir yokluyor.
- Arka planda konum paylaşımı (`expo-task-manager`) mağaza izin gerekçesiyle birlikte değerlendirilmeli.
- EAS Build yapılandırması (`eas.json`) eklendi (2026-10-31). Mağaza hesapları (EAS, Apple, Google Play) açılınca derleme alınacak.
