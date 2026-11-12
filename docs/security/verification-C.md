# Bağımsız bulgu doğrulaması C: web, mobil, gerçek zamanlı, altyapı

- Tarih: 2026-11-12, dal `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Girdi: `docs/security/findings/{web,mobile,realtime,infra}.md` (43 bulgu)
- Yöntem: Her iddianın dosya:satır konumu kod üzerinde yeniden okundu. Kod değiştirilmedi, servis çalıştırılmadı, paket kurulmadı. Kurulu kütüphane kaynakları (Next 15.5.28, next-intl 4.3.12, arq 0.28.0) ana checkout'taki `web/node_modules` ve `backend/.venv` içinden yalnızca okundu.
- Secret değeri yazılmadı.

## Karar dağılımı

| Karar | Sayı |
|---|---|
| DOĞRULANDI | 35 (bunların 6'sında kod yolu doğrulandı, istismar kısmı belirsiz: WEB-01, WEB-06, MOB-02, MOB-05, RT-08, RT-10) |
| MÜKERRER (kısmi dahil) | 7 (WEB-02, RT-02, RT-06, RT-09, INF-01, INF-02 kısmi, INF-10 kısmi) |
| BELİRSİZ | 1 (MOB-11) |
| YANLIŞ POZİTİF | 0 tam bulgu; 2 alt iddia çürütüldü (WEB-01 "jetonlar JS'e döner" istismarı, INF-03'ün bu yapılandırmada istismar edilebilirliği) |

43 = WEB 8 + MOB 11 + RT 10 + INF 14.

## Tablo

| ID | Karar | Kanonik ID | Önerilen önem | Gerekçe (dosya:satır) |
|---|---|---|---|---|
| WEB-01 | DOĞRULANDI (statik; dinamik test gerekli) | WEB-01 (API-13 bunun mükerrer'i) | Orta -> **Düşük** | `web/app/bff/[...path]/route.ts:103-104` parçaları `join("/")` sonrası regex'e sokuyor, `:76` ham yolu `fetch`'e veriyor; aynısı `admin/.../route.ts:88-89,59`. Next 15.5.28 `shared/lib/router/utils/route-matcher.js:18-36` catch-all'ı `split('/').map(decodeURIComponent)` ile çözüyor (doğrulandı). Next `resolve-routes.js:94` istek yolunu WHATWG değil eski `url.parse` ile ayrıştırıyor, yani `%2e%2e` sunucuda normalize edilmiyor; `..%2F` varyantı her istemciden, `%2e%2e` varyantı yalnızca tarayıcı dışı istemciden (tarayıcı kendisi normalize eder) çalışır. Middleware `bff`'yi hariç tutuyor (`web/middleware.ts:8`). **Önem düşürme gerekçesi:** "jetonlar JS'e döner" senaryosu çürüdü: `auth/otp/verify` dolaylı çağrısı yeni bir OTP kodu ister, `auth/staff/2fa` mfa jetonu + TOTP ister; XSS bunlara sahip değil, `auth/refresh` gövdesi httpOnly çerezdeki RT'yi istiyor. Geriye kalan: savunma katmanı atlatması; backend rol denetimi çalışıyor ve backend zaten doğrudan açık. Uçtan uca `GET /bff/me/..%2Fdriver%2Fme` denemesi (403 rol hatası beklenir, 404 değil) ile kesinleşir. |
| WEB-02 | MÜKERRER | AUTH-05 (kök neden backend `client_ip`) | Orta | `web/.../route.ts:48-50,73-74`, `admin/.../route.ts:56-57` istemci başlığını taşıyor; `backend/app/api/deps.py:29-31` koşulsuz güveniyor; Places sınırı `backend/app/api/public.py:109,125,132`. BFF konumu AUTH-05'e ek konum olarak eklenmeli. |
| WEB-03 | DOĞRULANDI | WEB-03 | Düşük -> **Bilgi** | `admin/.../route.ts:39-48`, `web/.../route.ts:52-61`. Bulgunun kendi analizi tarayıcıdan istismar yolu olmadığını gösteriyor; sertleştirme önerisi. |
| WEB-04 | DOĞRULANDI | WEB-04 | Düşük | `web/next.config.ts:19`, `admin/next.config.ts:14` (`'unsafe-inline'`; admin satırı 16 değil 14). |
| WEB-05 | DOĞRULANDI | WEB-05 | Düşük | `web/next.config.ts:9-32`, `admin/next.config.ts:3-24`, `backend/app/main.py:51-58`; repoda `Strict-Transport` yok. CDN tarafı belirsiz. |
| WEB-06 | DOĞRULANDI (kod yolu), istismar BELİRSİZ | WEB-06 | Düşük | `admin/app/(panel)/bookings/[id]/page.tsx:108-110,132,147`, `drivers/[id]/page.tsx:28-29,37` `id`'yi doğrulamadan ekliyor. İlk GET `Detail` biçimli dönmezse sayfa `data.booking` ile çöker; hedef uç POST kabul etmeli. Tarayıcıda hazırlanmış bağlantıyla denenmeli. MOB-02 ile aynı sınıf, farklı platform. |
| WEB-07 | DOĞRULANDI | WEB-07 | Bilgi | `web/.../route.ts:107`; yan etkili GET kesin: `backend/app/api/trips.py:246-249` -> `services/messages.py:47-52` karşı tarafın mesajlarını `read_at=now` yapıyor (belief değil, verified). |
| WEB-08 | DOĞRULANDI | WEB-08 | Bilgi | `web/.../route.ts:28-36`, `admin/.../route.ts:19-27`. |
| MOB-01 | DOĞRULANDI | MOB-01 | Orta -> **Düşük** | `mobile/lib/session.tsx:38-47` `stopBackgroundTracking` çağırmıyor; `mobile/lib/tracking.ts:35` yalnızca `trip_not_active`/`not_found`'ta duruyor; backend 401 kodu `unauthorized` (`backend/app/errors.py:35-37`), yani görev durmaz (belief kısmı doğrulandı). Düşürme: oturum yokken konum cihazdan çıkmıyor (401), ön plan bildirimi görünür; ikinci sürücü senaryosunda backend `NotFound` (`backend/app/api/driver.py` `post_location`, `errors.py:20-22` kod `not_found`) döner ve görev kendini durdurur. Mağaza öncesi kapatılmalı. |
| MOB-02 | DOĞRULANDI (kod yolu), istismar BELİRSİZ | MOB-02 | Orta -> **Düşük** | `mobile/app/booking/[code].tsx:52,66,78,118,150,179`; `pay=1` otomatik ödeme `:62,88-94` yalnızca kendi `odeme_bekliyor` rezervasyonunda ödeme tarayıcısını açar. Backend her uçta rol/sahiplik denetliyor, kullanıcı kendi yetkisinin dışına çıkamaz. `UpdatesWatcher.tsx:21-31` verisi backend'den geliyor (güvenilir kaynak). expo-router `%2F` çözümü ve RN `fetch` normalizasyonu cihazda denenmeli. |
| MOB-03 | DOĞRULANDI | MOB-03 | Düşük | Negatif arama tekrarlandı; pinning yok. |
| MOB-04 | DOĞRULANDI | MOB-04 | Düşük | `mobile/app.config.ts:9,11,46-50`, `mobile/eas.json:10`; profil bazlı https zorlaması yok (Google anahtarı kontrolü `app.config.ts:90-101` var, URL kontrolü yok). |
| MOB-05 | DOĞRULANDI (gömülme); kısıtlama BELİRSİZ | MOB-05 | Düşük | Google Cloud konsolu kontrolü gerekir. |
| MOB-06 | DOĞRULANDI | MOB-06 | Düşük | `mobile/app.config.ts:108` yalnızca özel şema. |
| MOB-07 | DOĞRULANDI (kısmen) | MOB-07 | Düşük | `mobile/lib/session.tsx:41-43` hata yutuluyor. Bulgudaki belief kısmı çözüldü: backend `bind_push_token` (`backend/app/services/notifications.py:113-122`) aynı türdeki önceki hesaptan jetonu yeni girişte siliyor; push sızıntısı yalnızca cihaz devri ile yeni giriş arasındaki pencerede (ve müşteri/sürücü tabloları arasında) geçerli. |
| MOB-08 | DOĞRULANDI | MOB-08 (GPS kısmı BIZ-02 ile ilişkili) | Bilgi | `mobile/lib/tracking.ts:26-31` `mocked` kontrolü yok. |
| MOB-09 | DOĞRULANDI | MOB-09 (kök neden AUTH-03) | Bilgi | `mobile/app/login.tsx:107-108`; `backend/app/services/otp.py:78` koşulu `env != "prod"` olduğu için `GETAWAY_ENV=production` + konsol SMS'te `dev_code` döner (AUTH-03 zinciri). |
| MOB-10 | DOĞRULANDI | MOB-10 | Bilgi | `mobile/lib/storage.web.ts:1-8`. |
| MOB-11 | BELİRSİZ | MOB-11 | Bilgi | `mobile/lib/storage.ts:6` `keychainAccessible` yok (doğrulandı); `allowBackup`/SecureStore yedek hariç tutma varsayılanı prebuild çıktısı (`npx expo prebuild` sonrası AndroidManifest) ve `expo-secure-store` kaynağı okunarak doğrulanmalı. |
| RT-01 | DOĞRULANDI | RT-01 (INF-10 Redis kısmı buna katılır) | Yüksek (dev, koşullu) korunur | `docker-compose.yml:18-21` parola yok, host IP yok; `backend/app/worker.py:44-46` `job_deserializer` yok. arq 0.28.0 (`backend/.venv/.../arq-0.28.0.dist-info`): `arq/jobs.py:295-296` varsayılan `pickle.loads`; `arq/worker.py:519-521` `deserialize_job_raw` fonksiyon adı aramasından (`:532-536`) önce çalışıyor, `functions=[]` korumaz. Worker dev'de hostta çalışıyor (`.vscode/tasks.json:56-57`), yani RCE geliştirici makinesinde. LAN erişilebilirliği (Docker Desktop + Windows güvenlik duvarı) dinamik test ister. |
| RT-02 | MÜKERRER | INF-02 (validator kapsamı; DB-11 de buraya) | Orta | `backend/app/config.py:26,114-130` `redis_url` denetimi yok. |
| RT-03 | DOĞRULANDI | RT-03 (AUTH-09 ve MON-07'nin oturum kısmı bunun mükerrer'i) | Orta | `backend/app/api/customer.py:272-282`: kimlik yalnızca ilk mesajda, döngüde yalnızca `db.get(Booking, booking_id)`; çıkış koşulu yok. |
| RT-04 | DOĞRULANDI | RT-04 (MON-07 senkron DB kısmı) | Orta | `customer.py:268` `async def` içinde senkron `SessionLocal` (`:273-280`) ve senkron Redis (`live_location.py:24-26,46`, zaman aşımı yok). |
| RT-05 | DOĞRULANDI | RT-05 (MON-07 bağlantı sınırı kısmı) | Düşük | `customer.py:267-286` sayaç/süre sınırı yok; 10 sn ön zaman aşımı `:272`. uvicorn `ws_max_size` varsayılanı belief kalıyor. |
| RT-06 | MÜKERRER | PRIV-04 (DB-06 ve PRIV-12 ilişkili) | Düşük | `services/messages.py:92-96`, `services/trip_updates.py:75-80,86,114-133`, `models/booking.py:224` (`EncryptedString`) vs `:245` (`String(500)`), `providers/push.py:51`. |
| RT-07 | DOĞRULANDI | RT-07 | Düşük | `api/trips.py:153-157,229-232`, `services/messages.py:53-56`; `:88-90` yorumu sürücü kimliğinin şikâyet için tutulduğunu söylüyor, görüntüleme süzgeci yok. |
| RT-08 | DOĞRULANDI (kod); istismar belief | RT-08 | Düşük | `api/trips.py:336-351` biçim denetimi yok (`max_length=255`); `notifications.py:113-122` yalnızca aynı modelde temizliyor. |
| RT-09 | MÜKERRER | BIZ-02 | Bilgi (BIZ-02 önemine tabi) | `api/driver.py:356-391` hız/sıçrama kontrolü yok; `:364-365` FINISHED'da son Redis konumu kullanılıyor. |
| RT-10 | DOĞRULANDI (kod); yarış BELİRSİZ | RT-10 | Bilgi | `services/messages.py:79-91` say-sonra-ekle, `trips.py:243` bacak kilitsiz (`_own_leg` `db.get`). Eşzamanlı 50 POST ile 40 sınırının aşılması dinamik olarak ölçülmeli. |
| INF-01 | MÜKERRER | AUTH-03 (BIZ-01 ödeme yönü alt kümesi) | Orta | `config.py:24,116`, `main.py:24-26`, `otp.py:78`, `api/payments.py:64`, `demo.py:77` tümü tam `== "prod"` / `!= "prod"`. |
| INF-02 | MÜKERRER (kısmi) | INF-02 kanonik önerilir; AUTH-03 "kapsam boşlukları", RT-02, DB-11, PRIV-02 buraya katılır | Orta | `config.py:25-26,28-33,49,92-96,114-130`; `providers/sms.py:30` OTP'yi WARNING loga yazıyor. Boş PayTR anahtarı: `providers/payments.py:109,144-145` HMAC boş anahtar ve tuzla hesaplanır, saldırgan aynı imzayı üretebilir (kod verified; ancak boş anahtarla ödeme başlatma PayTR'de zaten başarısız olacağından fark edilme olasılığı yüksek). `push_provider=console` prod'da reddediliyor (`config.py:129-130`), INF-02 listesinde doğru olarak yer almıyor. |
| INF-03 | DOĞRULANDI (sürüm); istismar bu yapılandırmada olası değil | INF-03 | Orta -> **Düşük** | `web/package.json:18` ve `web/package-lock.json:4329-4330` next-intl 4.3.12. Kurulu kaynak `next-intl/dist/esm/development/middleware/middleware.js:16,25` `decodeURI` sonrası `sanitizePathname` (`middleware/utils.js:183-188`: `\` -> `%5C`, `/+` -> `/`). `web/i18n/routing.ts:4-7` `localePrefix` varsayılanı `always`, `domains` yok: tüm yönlendirmeler (`middleware.js:119,143,149`) `/<locale>` önekiyle kuruluyor, `new URL(..., request.url)` aynı köken kalıyor; ön eksiz yönlendirme dalları (`:126,129`) yalnızca `never`/`as-needed`'de. Matcher noktalı yolları da dışlıyor (`web/middleware.ts:8`). Yine de yükseltilmeli; `/%09/evil`, `/%5C%5Cevil`, `//evil` ile dinamik regresyon testi önerilir. |
| INF-04 | DOĞRULANDI | INF-04 | Düşük -> **Bilgi** | `web/package-lock.json:4675-4676`, `admin/package-lock.json:4606-4607` postcss 8.4.31; yalnızca build zamanı, güvenilir CSS. |
| INF-05 | DOĞRULANDI | INF-05 | Düşük | `mobile/package-lock.json:17095-17096` node-forge 1.4.2, `:20655-20656` zod 3.25.76; dev/build zinciri. |
| INF-06 | DOĞRULANDI | INF-06 | Orta -> **Düşük** | `.github/workflows/android-emulator.yml:30` workflow env, `:140` `curl \| bash`, `:143` üçüncü taraf action etiketle; `ios-simulator.yml:30,169`. Tetikleyici yalnızca push `ci/*` + dispatch (`:8-11`), fork PR secret almaz; sızan değer tek bir kota sınırlanabilir API anahtarı; tedarik zinciri ele geçirme olasılığı düşük. |
| INF-07 | DOĞRULANDI | INF-07 | Düşük | `grep uses:` çıktısı rapordaki satırlarla eşleşiyor; `permissions: contents: read` üç iş akışında. |
| INF-08 | DOĞRULANDI | INF-08 | Orta -> **Düşük** | `.github` altında yalnızca `scripts`, `workflows`; `git ls-files` dependabot/renovate/SECURITY/CODEOWNERS bulmadı. Süreç eksikliği, doğrudan açık değil. |
| INF-09 | DOĞRULANDI | INF-09 | Düşük | `backend/requirements.txt:1-17` (pytest satır 17), hash yok. |
| INF-10 | MÜKERRER (kısmi) | Redis -> RT-01, Postgres -> DB-10; yalnızca `uvicorn --host 0.0.0.0` + LAN'da `dev_code` kısmı özgün | Düşük | `docker-compose.yml:6-10,18-21`, `.vscode/tasks.json:42-43`. Özgün kalan kısım için Düşük uygun. |
| INF-11 | DOĞRULANDI | INF-11 | Düşük | `docker-compose.yml:4,19`, `ci.yml:25,36` (16-3.4 / 7-alpine), `android-emulator.yml:42,51` (17-3.5 / 7). |
| INF-12 | DOĞRULANDI | INF-12 | Düşük | `.gitignore:26-31`; `git check-ignore -v mobile/google-services.json fcm-sa.json` rc=1 (yoksayılmıyor); geçmişte firebase/servis hesabı dosyası eklenmemiş. |
| INF-13 | DOĞRULANDI | INF-13 | Düşük | `mobile/eas.json:12-24` preview profilleri canlı API. |
| INF-14 | DOĞRULANDI | INF-14 (kök log davranışı PRIV-02) | Bilgi | `android-emulator.yml:78,158-164`, `ios-simulator.yml:88,227-233` (retention 14). |

## Önem değişiklikleri özeti

| ID | Eski | Önerilen | Kısa gerekçe |
|---|---|---|---|
| WEB-01 | Orta | Düşük | Jeton sızdırma senaryosu OTP/TOTP gerektirdiği için çöktü; geriye savunma katmanı atlatması kaldı (backend rol denetimi var). |
| WEB-03 | Düşük | Bilgi | Bulgu kendi içinde istismar yolu bulunmadığını gösteriyor. |
| MOB-01 | Orta | Düşük | Veri cihazdan çıkmıyor; ikinci hesap senaryosu `not_found` ile kendini durduruyor. |
| MOB-02 | Orta | Düşük | Kullanıcı kendi yetkisinin dışına çıkamıyor; istismar cihazda doğrulanmadı. |
| INF-03 | Orta | Düşük | `localePrefix: always` + sanitize ile bu projede açık yönlendirme yolu statik olarak bulunamadı. |
| INF-04 | Düşük | Bilgi | Build zamanı, güvenilir girdi. |
| INF-06 | Orta | Düşük | Yazma yetkisi + tedarik zinciri ele geçirme gerekir, etki tek API anahtarı. |
| INF-08 | Orta | Düşük | Süreç eksikliği. |

## Kümeler arası mükerrer adayları

| Kanonik (önerilen) | Birleşecekler | Not |
|---|---|---|
| AUTH-05 | WEB-02, API-03, MON-01, PRIV-09 | `cf-connecting-ip` güveni; WEB-02 BFF konumu (`web/.../route.ts:48-50`, `admin/.../route.ts:56-57`) eklenmeli. |
| WEB-01 | API-13 | API-13 "belief" etiketli; WEB-01 Next eşleyici kaynağıyla daha ayrıntılı. Önem Düşük öneriliyor. |
| RT-01 | INF-10 (Redis kısmı) | DB-10 Postgres için ayrı kalır; INF-10'un Postgres kısmı DB-10'a. |
| AUTH-03 | INF-01, BIZ-01 (ödeme sonucu), MOB-09 (zincir) | `env` serbest metin. BIZ-01 "Yüksek" önemi ile AUTH-03/INF-01 "Orta" çelişiyor; aynı kök neden tek önemle raporlanmalı (BIZ-01 ödeme etkisi gerekçesiyle Yüksek savunulabilir). |
| INF-02 | AUTH-03 (kapsam boşlukları kısmı), RT-02, DB-11, PRIV-02 | Prod validator kapsamı. |
| RT-03 | AUTH-09, MON-07 (oturum kısmı) | MON-07 RT-03/04/05'in birleşimi; MON-07 ya kaldırılmalı ya da RT-03..05'e bölünmeli. |
| RT-04 / RT-05 | MON-07 (senkron DB, bağlantı sınırı kısımları) | |
| PRIV-04 | RT-06; ilişkili DB-06 (sürücü adı/plaka kopyası), PRIV-12 (konsol push logu) | |
| BIZ-02 | RT-09, MOB-08 (`mocked` alanı) | GPS sahteciliği. |
| PRIV-02 | INF-14 (log içeriği kaynağı), INF-02 SMS maddesi | |
| (ilişkili, mükerrer değil) | WEB-06 <-> MOB-02 | Aynı sınıf (istemci tarafı yol geçişi), farklı platform; düzeltmeler ayrı. |
| (ilişkili) | API-12 <-> BIZ-01 <-> INF-01 | Sahte ödeme ucunun kimliksizliği. |

## Dinamik test gerektirenler

1. WEB-01: Yerel `next start` ile `curl --path-as-is` `GET /bff/me/..%2Fdriver%2Fme` ve `/bff/me/%2e%2e/driver/me` (müşteri çereziyle); 403 backend yanıtı atlatmayı, 404 BFF yanıtı korumayı gösterir.
2. INF-03: Yerel web'de `/%09/evil`, `/%5C%5Cevil`, `//evil`, `/en/%09/evil` için `Location` başlığı.
3. RT-01: Docker Desktop'ın 6379'u LAN arayüzünde dinleyip dinlemediği (`netstat -ano`, başka makineden `redis-cli -h`).
4. MOB-02 / WEB-06: cihaz ve tarayıcıda hazırlanmış derin bağlantı.
5. RT-10: eşzamanlı mesaj gönderimi.
6. MOB-11: prebuild çıktısı.
