# Güvenlik denetimi: Alan 5, Mobil (`mobile/`)

- Tarih: 2026-11-12, dal `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Kapsam: Expo tek kod tabanı (müşteri + sürücü varyantı). Yalnızca statik okuma; kod değiştirilmedi, cihazda veya derlemede dinamik test yapılmadı.
- Bağlam: uygulama geliştirme aşamasında, mağaza dağıtımı yapılmadı. Önem dereceleri bu durum dikkate alınarak verildi; "mağaza öncesi" notu, derece yükselmeden önce kapatılması gerekenleri belirtir.
- `mobile/node_modules` bu worktree'de kurulu değil; kütüphane varsayılanlarına dayanan maddeler `belief` olarak işaretli.
- Secret değeri yazılmadı; yalnızca değişken adı ve konum.

## Özet

| Önem | Sayı | ID |
|---|---|---|
| Kritik | 0 | |
| Yüksek | 0 | |
| Orta | 2 | MOB-01, MOB-02 |
| Düşük | 5 | MOB-03, MOB-04, MOB-05, MOB-06, MOB-07 |
| Bilgi | 4 | MOB-08, MOB-09, MOB-10, MOB-11 |

## Olumlu gözlemler (negatif bulgular)

- Jetonlar native'de `expo-secure-store` (Keychain / Keystore) ile saklanıyor; AsyncStorage kullanımı yok. verified: `mobile/lib/storage.ts:2-7`, `mobile/lib/api.ts:34-44`; `grep -rn AsyncStorage mobile/app mobile/lib mobile/components` boş.
- WebView yok: `react-native-webview` bağımlılığı yok, kodda `WebView` kullanımı yok. Ödeme sayfası `expo-web-browser` (`openBrowserAsync`, sistem tarayıcısı / SFSafariViewController / Custom Tabs) ile açılıyor; uygulama kart verisine erişmiyor. verified: `mobile/app/booking/[code].tsx:81`, grep çıktısı.
- WebSocket kimliği URL'de değil ilk mesajda gönderiliyor; `wsUrl` `https` -> `wss` dönüşümünü koruyor. verified: `mobile/lib/api.ts:116-118`, `mobile/app/booking/[code].tsx:176-181`.
- Log sızıntısı: kodda yalnızca bir `console.warn` var, yalnızca hata iletisini yazıyor (jeton/telefon/konum yok). verified: `mobile/lib/session.tsx:24`; `grep -rn "console\." mobile/app mobile/lib mobile/components mobile/widgets`.
- Google Maps anahtarları repoda değil, yalnızca ortam değişkeninden okunuyor; `mobile/.env.example` değerleri boş; `mobile/android/`, `mobile/ios/` (prebuild çıktısı) git dışı. verified: `mobile/app.config.ts:16,22`, `mobile/.env.example:3,5,8`, `.gitignore:23-24`.
- Backend'in sunucu anahtarı (`GETAWAY_GOOGLE_MAPS_API_KEY`) mobil `app.config.ts` içinde okunmuyor; yalnızca platforma özel anahtarlar gömülüyor. verified: `mobile/app.config.ts:16,22`.
- Müşteri varyantında konum izinleri `blockedPermissions` ve Info.plist temizleme eklentisiyle kaldırılıyor. verified: `mobile/app.config.ts:32-42,137-139,180`.
- Push jetonu çıkışta backend'e verilip hesaptan silinmesi isteniyor; iOS APNs jetonu FCM'e yanlışlıkla kaydedilmiyor. verified: `mobile/lib/session.tsx:38-47`, `mobile/lib/notify.ts:81-94`.

---

## Bulgular

### MOB-01: Çıkış yapıldığında arka plan konum görevi durdurulmuyor

- OWASP: MASVS-PRIVACY-1, MASVS-PLATFORM-1; CWE-359 (Exposure of Private Personal Information), CWE-672 (Operation on a Resource after Expiration or Release)
- Önem: Orta. Gerekçe: sürücü çıkış yaptıktan sonra da cihazda yüksek doğruluklu konum toplama sürüyor (`killServiceOnDestroy: false` ile uygulama kapansa da). Jeton silindiği için konum backend'e ulaşmaz (401) ama KVKK açısından "yalnızca aktif yolculukta" taahhüdü (K-52, izin metinleri) ihlal edilir; aynı cihazda başka bir sürücü giriş yaparsa eski `leg_id` için yeni sürücünün jetonuyla konum gönderilir (backend yetki kontrolüne kalır). Mağaza dağıtımı olmadığı için şu an etki geliştirici cihazlarıyla sınırlı; mağaza öncesi kapatılmalı (Google Play arka plan konum incelemesinde de sorun olur).
- Konum:
  - `mobile/lib/session.tsx:38-47` (`signOut` içinde `stopBackgroundTracking` çağrısı yok)
  - `mobile/app/(driver)/home.tsx:369-372` (sürücü çıkışı: yalnızca `is_online=false` + `signOut`)
  - `mobile/lib/tracking.ts:21-40` (görev `LEG_KEY` varsa her konumda `loadSession` + POST yapar; yalnızca `trip_not_active` / `not_found` kodlarında durur)
  - `mobile/lib/tracking.ts:63` (`killServiceOnDestroy: false`)
- Kavramsal istismar: sürücü aktif yolculuk sırasında (veya yolculuk bitişi sunucuya ulaşmadan) çıkış yapar. Ön plan hizmeti çalışmaya devam eder; her 10 sn / 25 m'de GPS okunur, `api()` 401 alır, yenileme başarısız olur, `clearTokens` çağrılır, hata kodu `trip_not_active`/`not_found` olmadığı için görev durmaz. Sürücü "Yolculuk sürüyor" bildirimini görmeye devam eder; cihazda konum toplama süresiz sürer. Aynı cihazda ikinci hesap girişi yapılırsa görev yeni jetonla eski bacağa konum yollamayı dener.
- Önerilen düzeltme: `signOut` içinde (varyant sürücüyse) `stopBackgroundTracking()` ve `endLiveTrip` çağrılsın; konum görevi 401/403 (veya oturum yoksa: `loadSession()` false) aldığında da kendini durdursun; çıkışta `ga_tracking_leg` ve `ga_updates_cursor` anahtarları silinsin. Test: oturum kapatıldığında `Location.stopLocationUpdatesAsync` çağrıldığını doğrulayan birim testi.
- Durum: verified (kod yolu). Backend'in 401 yanıtındaki `error.code` değerinin `trip_not_active`/`not_found` olmadığı varsayımı belief (backend kodu bu alanda okunmadı; 401 yolunda `ApiError` kodu backend gövdesinden gelir).

### MOB-02: Rota parametreleri (deep link ile dışarıdan gelebilir) API yoluna kodlanmadan ekleniyor

- OWASP: MASVS-PLATFORM-1 (IPC/deep link girdisi), MASVS-CODE-4 (girdi doğrulama); CWE-20, CWE-22 (yol geçişi, istemci tarafında API yolu)
- Önem: Orta (doğrulanmadı kısmı nedeniyle alt sınırda). Gerekçe: expo-router tüm ekranları özel şema (`getaway://`, `getawaydriver://`) üzerinden derin bağlantıya açar; `code`, `id`, `legId` parametreleri `encodeURIComponent` olmadan kimlikli `fetch` yoluna ekleniyor. Saldırgan bağlantısıyla uygulama, kullanıcının jetonuyla `/api/v1/` altında saldırganın seçtiği başka bir yola istek atabilir. Etki kullanıcının kendi yetkisiyle sınırlı (yetki yükseltme yok) ve POST'ların çoğu kullanıcı dokunuşu gerektirir; ancak GET'ler ve ekran açılışındaki otomatik çağrılar etkileşimsiz tetiklenir. Mağaza dağıtımı yok; mağaza öncesi düzeltilmeli.
- Konum:
  - `mobile/app/booking/[code].tsx:52,66,78,118,140,150,160,179` (`me/bookings/${code}` ve alt yolları; `pay=1` ile otomatik ödeme başlatma `:62,90-94`)
  - `mobile/app/chat/[id].tsx:36,42,72` (`base` yolu; mesaj gönderme POST)
  - `mobile/app/trip/[legId].tsx:77,114,143,190,201,233` (sürücü: olay POST'u, konum POST'u)
  - `mobile/app/job/[legId].tsx:42,65,78` (sürücü: iş kabul/ret POST'u)
  - `mobile/components/UpdatesWatcher.tsx:21-31` (bildirim verisinden rota)
  - `mobile/app.config.ts:108` (şema tanımı)
- Kavramsal istismar: SMS/WhatsApp ile gönderilen `getaway://booking/<kodlanmış ../../…>` benzeri bir bağlantı açıldığında `useLocalSearchParams` çözülmüş değeri verir, `fetch` yolu `..` segmentlerini normalize eder ve istek beklenen kaynak yerine başka bir uç noktaya gider (ör. `me/bookings/../../<başka-yol>?`). Sorgu ayırıcı `?` ile sonraki sabit ek (`/payments`, `/messages`) etkisizleştirilebilir. Sürücü uygulamasında `getawaydriver://job/<legId>` bağlantısıyla sürücüye sahte bağlamlı bir iş ekranı açtırılıp kabul dokunuşuna yönlendirme (sosyal mühendislik) de mümkün; burada yetki backend'de kontrol edilir.
- Önerilen düzeltme: rota parametrelerini kullanmadan önce biçim doğrulaması (rezervasyon kodu için `^[A-Z0-9]{6,12}$`, `leg_id` için UUID regex) ve yola eklerken `encodeURIComponent`; geçersizse ekran hata göstersin. `pay=1` gibi yan etkili sorgu parametreleri yalnızca uygulama içi geçişte kabul edilsin (derin bağlantıdan gelen `pay` yok sayılsın). Test: `../` içeren `code` ile ekran render edildiğinde `fetch`'in çağrılmadığını veya kodlanmış yolla çağrıldığını doğrulayan jest testi.
- Durum: belief (doğrulanmadı). Kod yolu verified; expo-router'ın `%2F` içeren segmenti çözüp tek parametre olarak verdiği ve RN `fetch`'in (Android OkHttp, iOS NSURLSession) `..` segmentlerini normalize ettiği varsayımı cihazda denenmedi.

### MOB-03: Certificate pinning yok

- OWASP: MASVS-NETWORK-2; CWE-295
- Önem: Düşük. Gerekçe: aramam pinning desenini bulamadı (komut: `grep -rn -i "pinning|ssl|trustkit" mobile/app mobile/lib mobile/components`, `mobile/package.json` bağımlılıklarında pinning kütüphanesi yok, `network_security_config` eklentisi yok). Varsayılan platform TLS doğrulaması geçerli; saldırgan için cihaza kendi CA'sını kurmak veya güvenilir bir CA'yı ele geçirmek gerekir. Uygulama ödeme, telefon ve sürücü konumu taşıdığı için mağaza öncesi değerlendirilmeli; geliştirme aşamasında risk düşük.
- Konum: `mobile/lib/api.ts:53,79` (doğrudan `fetch`), `mobile/lib/api.ts:116-118` (WebSocket)
- Kavramsal istismar: kullanıcı cihazına MDM veya kötü niyetli profil ile kök sertifika yüklenmişse (veya rootlu cihazda), ağdaki saldırgan `api.getawaytransfers.com` trafiğini çözerek erişim/yenileme jetonlarını ve OTP doğrulamasını okuyabilir.
- Önerilen düzeltme: mağaza öncesi karar verilsin (`docs/kararlar.md`). Seçenekler: Android `network_security_config` ile `<pin-set>` (yedek pin + son kullanma tarihli), iOS `NSPinnedDomains` (Info.plist), veya `react-native-ssl-public-key-pinning`. Pin rotasyon planı (Cloudflare kenar sertifikası değişimi) olmadan uygulanmamalı.
- Durum: verified (negatif arama).

### MOB-04: API adresinin HTTPS olduğu derleme zamanında zorlanmıyor; varsayılan düz HTTP

- OWASP: MASVS-NETWORK-1; CWE-319
- Önem: Düşük. Gerekçe: üretim profilleri `https://` veriyor (`mobile/eas.json:15,21,27,33`), ancak `GETAWAY_API_URL` verilmezse derleme `http://localhost:8000` ile tamamlanıyor ve `GETAWAY_ANDROID_CLEARTEXT=1` ile `usesCleartextTraffic=true` eklenebiliyor; bunu mağaza profilinde engelleyen kontrol yok. Yanlış yapılandırılmış bir derleme (ör. `preview` APK'sının dev ortam değişkeniyle üretilmesi) jetonları düz metin taşır. Şu an yalnızca dahili dağıtım olduğu için düşük.
- Konum: `mobile/app.config.ts:9,11,46-52,182`, `mobile/lib/config.ts:7`, `mobile/eas.json:10`
- Kavramsal istismar: `development` profiliyle (`http://10.0.2.2:8000`) veya cleartext bayrağıyla üretilmiş bir APK gerçek ağda kullanılırsa, aynı Wi-Fi'daki saldırgan OTP verify yanıtındaki jetonları ve `Authorization` başlıklarını pasif olarak okur.
- Önerilen düzeltme: `EAS_BUILD_PROFILE` `production*`/`preview*` iken `apiUrl`/`webUrl` `https://` ile başlamıyorsa veya `GETAWAY_ANDROID_CLEARTEXT` tanımlıysa `app.config.ts` hata fırlatsın (mevcut Google anahtarı kontrolü gibi, `app.config.ts:90-101`). iOS ATS istisnası eklenmediği prebuild çıktısında doğrulansın.
- Durum: verified (yapılandırma). iOS prebuild çıktısındaki ATS varsayılanları (`NSAllowsLocalNetworking` vb.) belief: `mobile/ios/` git dışı, okunmadı.

### MOB-05: Google Maps SDK anahtarları uygulama paketine gömülü; kısıtlama repodan doğrulanamıyor

- OWASP: MASVS-STORAGE-1 / MASVS-RESILIENCE (paket içi secret); CWE-798 (yalnızca kısıtlamasız ise)
- Önem: Düşük. Gerekçe: mobil Maps SDK anahtarlarının pakette bulunması platformun gereği; kod yorumu Android anahtarının paket adı + SHA-1, iOS anahtarının bundle ID ile kısıtlandığını söylüyor. Kısıtlamalar ve hangi API'lerin anahtara açık olduğu (yalnızca Maps SDK mı, yoksa Places/Routes/Directions da mı) Google Cloud konsolunda; repodan doğrulanamıyor. Kısıtlamasız ise ücretli API kötüye kullanımı (fatura) riski olur.
- Konum (yalnızca ad ve konum):
  - `GETAWAY_GOOGLE_MAPS_ANDROID_KEY`: `mobile/app.config.ts:16,142` -> AndroidManifest `meta-data` (APK içinde düz metin)
  - `GETAWAY_GOOGLE_MAPS_IOS_KEY`: `mobile/app.config.ts:22,59,81` -> Info.plist `GMSApiKey` ve üretilen `AppDelegate.swift` kaynağına string olarak yazılıyor
  - `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`: `mobile/.env.example:8` (web önizleme JS paketine gömülür)
  - CI: `.github/workflows/android-emulator.yml:109`, `.github/workflows/ios-simulator.yml:112`; CI artefaktları (`android-emulator.yml:156-164`, `ios-simulator.yml:224-232`) derlenmiş uygulamayı içeriyorsa anahtar artefakta da girer (içerik yolu okunmadı).
- Kavramsal istismar: APK `apktool`/`unzip` ile açılıp manifestten anahtar çıkarılır; anahtar yalnızca uygulama imzasıyla kısıtlıysa SDK dışı REST çağrılarında (`X-Android-Package`/`X-Android-Cert` başlıkları taklit edilerek) kullanılabilir; API kısıtlaması yoksa Places/Routes gibi ücretli API'ler çağrılır.
- Önerilen düzeltme: her anahtar için konsolda (a) uygulama kısıtlaması (paket adı + imza SHA-1, bundle ID), (b) API kısıtlaması (yalnızca "Maps SDK for Android/iOS") ve (c) kota/bütçe uyarısı uygulandığı `docs/kararlar.md`'ye kayıt düşülsün. Müşteri ve sürücü varyantı ile EAS imza sertifikası SHA-1'leri anahtara eklensin. iOS anahtarının hem Info.plist hem AppDelegate'e yazılması tek kaynağa indirilebilir (Info.plist'ten okuma).
- Durum: verified (gömülme yolu); kısıtlamaların varlığı belief.

### MOB-06: Özel URL şeması; App Links / Universal Links yok, şema başka uygulamalarca ele geçirilebilir

- OWASP: MASVS-PLATFORM-1; CWE-939 (Improper Authorization in Handler for Custom URL Scheme)
- Önem: Düşük. Gerekçe: yalnızca `getaway` / `getawaydriver` özel şemaları var; aramam `associatedDomains`, `intentFilters`, `autoVerify` desenini bulamadı (komut: `grep -rn -i "associatedDomains|intentFilters|autoVerify" mobile/app.config.ts mobile/lib mobile/app mobile/components`). Özel şema sahipliği doğrulanmaz. Şu an şemayla taşınan veri yalnızca rezervasyon kodu (canlı etkinlik bağlantısı) ve ödeme dönüşü şema kullanmıyor; bu nedenle düşük.
- Konum: `mobile/app.config.ts:108`, `mobile/app/booking/[code].tsx:105` (`getaway://booking/<kod>` canlı etkinlik URL'si)
- Kavramsal istismar: Android'de aynı şemayı kaydeden kötü niyetli uygulama, kullanıcı seçici diyalogda onu seçerse canlı etkinlik / bildirimden açılan bağlantıdaki rezervasyon kodunu alır. Kod tek başına kimlik doğrulaması sağlamaz (backend sahiplik kontrolü yapar) ama kişisel transfer bilgisiyle eşleştirilebilir tanımlayıcıdır. MOB-02 ile birleşince şemaya gelen girdiler tamamen güvenilmez kabul edilmelidir.
- Önerilen düzeltme: mağaza öncesi `https://getawaytransfers.com/app/...` için Android App Links (`autoVerify` + `assetlinks.json`) ve iOS Universal Links (`associatedDomains` + `apple-app-site-association`) kurulsun; özel şema yalnızca uygulama içi kullanımda kalsın. Derin bağlantı girişinde parametre doğrulaması MOB-02 ile birlikte yapılsın.
- Durum: verified (yapılandırma, negatif arama).

### MOB-07: Çıkış ağ hatasında sessizce yerel tarafta tamamlanıyor; sunucu oturumu ve push jetonu kalıyor

- OWASP: MASVS-AUTH-1 (oturum sonlandırma); CWE-613
- Önem: Düşük. Gerekçe: `auth/logout` hatası yutuluyor, yerel jetonlar siliniyor; yenileme jetonu (30 gün) sunucuda geçerli kalıyor ve cihazın push jetonu hesaba bağlı kalıyor. Yerel kopya silindiği için istismar, jetonun daha önce başka yolla ele geçirilmesini gerektirir; paylaşılan cihazda ise sonraki kullanıcı önceki hesabın push bildirimlerini (yolculuk/mesaj metinleri) görebilir.
- Konum: `mobile/lib/session.tsx:38-47`, `mobile/lib/notify.ts:71-78`
- Kavramsal istismar: sürücü çevrimdışıyken çıkış yapar ve cihazı başka sürücüye verir; FCM push'ları (backend `push_token` kaydı silinmediği için) önceki sürücünün teklif/mesaj bildirimlerini yeni kullanıcının bildirim çekmecesine düşürür.
- Önerilen düzeltme: başarısız logout isteği (yenileme jetonu ve push jetonuyla) güvenli depoda kuyruklanıp sonraki ağ erişiminde tekrar denensin; yeni girişte backend aynı push jetonunu önceki hesaptan ayırsın (backend tarafı, doğrulanmadı).
- Durum: verified (istemci); backend'in yeni kayıtta jetonu önceki hesaptan ayırıp ayırmadığı belief.

### MOB-08: Root / jailbreak tespiti ve çalışma zamanı bütünlük kontrolü yok

- OWASP: MASVS-RESILIENCE-1, MASVS-RESILIENCE-2
- Önem: Bilgi. Gerekçe: aramam `jailbreak|root detection|jail-monkey|Play Integrity|App Attest|DeviceCheck` desenini kodda ve `mobile/package.json` bağımlılıklarında bulamadı. Güvenlik kontrolleri backend'de olduğundan bu bir zayıflık değil, savunma derinliği eksikliği. Sürücü uygulamasında sahte GPS (mock location) ile konum yazımı ilgili bir risk: `Location` nesnesinin `mocked` alanı kontrol edilmiyor (`mobile/lib/tracking.ts:26-31`, `mobile/app/trip/[legId].tsx:114,201,233`).
- Önerilen düzeltme: mağaza öncesi karar: sürücü uygulamasında Android Play Integrity / iOS App Attest ile backend'e kanıt gönderimi ve `coords.mocked` (Android) değerinin olaylara eklenip backend'de işaretlenmesi değerlendirilsin. Müşteri uygulaması için gerekli görülmedi.
- Durum: verified (negatif arama).

### MOB-09: OTP `dev_code` uygulamada gösterilip tek dokunuşla doğrulanıyor

- OWASP: MASVS-AUTH-2; CWE-489 (Active Debug Code)
- Önem: Bilgi. Gerekçe: istemci, backend yanıtında `dev_code` varsa gösteriyor. Backend bu alanı yalnızca `env != "prod"` ve `sms_provider == "console"` iken döndürüyor (recon 3.4). Risk istemcide değil, prod dışı ortamın internete açılmasında: staging/preview backend'i konsol SMS ile açıksa herkes herhangi bir telefonla giriş yapar.
- Konum: `mobile/app/login.tsx:69,107-108,203-206`
- Önerilen düzeltme: `preview`/`production` EAS profillerinde (ör. `__DEV__` false iken) `dev_code` gösterimi tamamen kapatılsın; preview backend'in `sms_provider=console` ile çalışmadığı dağıtım kontrol listesine eklensin.
- Durum: verified (istemci), backend koşulu recon'dan.

### MOB-10: Web önizlemesinde jetonlar `localStorage`'da

- OWASP: MASVS-STORAGE-1; CWE-922
- Önem: Bilgi. Gerekçe: yalnızca Metro web önizlemesi (8081/8082) için; dosya yorumu "yalnızca geliştirme". Herhangi bir XSS (ör. `GoogleMapWeb` `innerHTML`, şu an yalnızca sabit renklerle dolduruluyor, `mobile/components/GoogleMapWeb.tsx:92,192-216`) jetonları okuyabilir. Önizleme yerel ağdan erişilebilir sunuluyorsa (`--host lan`) risk artar.
- Konum: `mobile/lib/storage.web.ts:1-7`, `mobile/components/GoogleMapWeb.tsx:84-114`
- Önerilen düzeltme: web önizlemesinin mağaza veya kamuya açık bir ortamda yayınlanmayacağı `docs/kararlar.md`'de kayıtlı olsun; yayınlanacaksa jetonlar `sessionStorage`/bellek veya web BFF çerezine taşınsın. `innerHTML` yerine DOM API kullanımı tercih edilsin (şu an güvenli).
- Durum: verified.

### MOB-11: Hassas ekranlarda ekran görüntüsü / görev değiştirici önizlemesi koruması yok; Keychain erişilebilirlik sınıfı varsayılan

- OWASP: MASVS-PLATFORM-3, MASVS-STORAGE-2
- Önem: Bilgi. Gerekçe: aramam `FLAG_SECURE|preventScreenCapture|expo-screen-capture` desenini bulamadı; OTP, yolcu adı/telefonu, sürücü kazancı ekranları görev değiştiricide görünür. SecureStore çağrılarında `keychainAccessible` belirtilmiyor (`mobile/lib/storage.ts:5`); kütüphane varsayılanı (`WHEN_UNLOCKED`, belief) güvenli taraftadır, ancak iOS'ta kilitli cihazda arka plan konum görevi jetonu okuyamayabilir (`mobile/lib/tracking.ts:28`), bu güvenlik değil işlevsellik notu. Android otomatik yedeklemede SecureStore verisinin hariç tutulması `expo-secure-store` eklentisinin varsayılanına bağlı (belief; `node_modules` kurulu değil, okunmadı).
- Önerilen düzeltme: OTP ve ödeme ekranlarında `expo-screen-capture` değerlendirilsin; prebuild çıktısında `android:allowBackup` / `dataExtractionRules` değerleri kontrol edilsin.
- Durum: belief (kütüphane varsayılanları), negatif arama verified.

---

## Kapsam dışı bırakılan / okunmayanlar

- `mobile/node_modules` yok: expo-secure-store, expo-router, expo-notifications varsayılanları kaynak koddan doğrulanmadı.
- `mobile/android/`, `mobile/ios/` prebuild çıktısı git dışı; AndroidManifest (exported activity, intent filter, allowBackup) ve Info.plist (ATS) son hali okunmadı.
- Bağımlılık açık taraması (`npm audit`) çalıştırılmadı.
- Backend tarafı (push jetonu kaydının önceki hesaptan ayrılması, `driver/trips/{leg_id}/location` yetki kontrolü, 401 hata kodu) bu alanda okunmadı.
- `mobile/widgets/*` (canlı etkinlik) ve `mobile/app/(driver)/documents.tsx` belge yükleme akışı yalnızca API çağrı satırları düzeyinde tarandı.
