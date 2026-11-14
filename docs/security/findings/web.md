# Güvenlik denetimi: Alan 3, web uygulamaları (web/ ve admin/)

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Kapsam: `web/`, `admin/` (Next.js 15.5.28), BFF vekilleri, `next.config.ts`, `web/middleware.ts`, backend CORS ve güvenlik başlıkları (`backend/app/main.py`). Kod değiştirilmedi.
- Etiketler: `verified` doğrudan okundu veya yerel olarak simüle edildi; `belief` çıkarım, uçtan uca doğrulanmadı.
- Secret değeri yazılmadı.

## Özet

| ID | Başlık | Önem | Durum |
|---|---|---|---|
| WEB-01 | BFF yol izin listesi, kodlanmış `..` ve `%2F` ile atlatılıyor (web ve admin) | Orta | verified (eşleyici simülasyonu), uçtan uca belief |
| WEB-02 | BFF, istemcinin gönderdiği `cf-connecting-ip` / `x-forwarded-for` değerini backend'e taşıyor (IP sahteleme) | Orta | verified (kod) |
| WEB-03 | Origin denetimi `x-forwarded-host` değerine güveniyor | Düşük | kod verified, istismar edilemezlik belief |
| WEB-04 | CSP `script-src 'unsafe-inline'` (web ve admin) | Düşük | verified |
| WEB-05 | HSTS başlığı hiçbir katmanda yok | Düşük | verified (repo), CDN tarafı belief |
| WEB-06 | Admin `[id]` rota parametreleri doğrulanmadan BFF yoluna ekleniyor (istemci tarafı yol geçişi, CSPT) | Düşük | belief |
| WEB-07 | Origin denetimi GET isteklerini kapsamıyor, yan etkili GET'ler var | Bilgi | verified (kod) |
| WEB-08 | Çerezlerde `__Host-` öneki yok, `Secure` yalnızca `NODE_ENV` ile belirleniyor | Bilgi | verified |

Sayılar: Kritik 0, Yüksek 0, Orta 2, Düşük 4, Bilgi 2.

---

## WEB-01: BFF yol izin listesi, kodlanmış `..` ve `%2F` ile atlatılıyor

- OWASP: A01:2021 Broken Access Control, A10:2021 SSRF (sınırlı). CWE-22 (Path Traversal), CWE-180 (Validate Before Canonicalize).
- Önem: Orta. BFF izin listesi kodda güvenlik kontrolü olarak tanımlanmış ("admin ve sürücü uçları kapalı"), ancak doğrulama kanonikleştirmeden önce yapılıyor. Hedef uçlarda backend rol denetimi hâlâ çalıştığı ve backend mobil için zaten dışa açık olduğu için doğrudan yetki yükseltme görülmedi. Bu yüzden Yüksek değil.
- Dosya:satır:
  - `web/app/bff/[...path]/route.ts:103-104` (`path.join("/")` sonrası regex), `:76` (`fetch(\`${API_URL}/api/v1/${path}${req.nextUrl.search}\`)`)
  - `admin/app/bff/[...path]/route.ts:88-89`, `:59`
- Kök neden: Next.js catch-all parametresini `/` ile bölüp her parçaya `decodeURIComponent` uyguluyor (`next/dist/shared/lib/router/utils/route-matcher.js`, `params[key] = match.split('/').map(decode)`). Bu yüzden `%2F` ve `%2e%2e` çözülüp `..` ve `/` olarak birleşiyor. Regex (`^me\/.+$`, `^places\/.+$`, `^admin\/.+$`) bu ham dizeyi kabul ediyor. Ardından `fetch` (WHATWG URL) `..` parçalarını normalize ediyor.
- Doğrulama (verified, yerel simülasyon; Next'in kendi `getRouteRegex` ve `getRouteMatcher` fonksiyonlarıyla, scratchpad betiği):
  - `/bff/me/..%2Fdriver%2Fme` -> path `me/../driver/me` -> izinli -> upstream `/api/v1/driver/me`
  - `/bff/me/%2e%2e/driver/me` -> aynı sonuç
  - `/bff/places/..%2F..%2Fadmin%2Fusers` -> upstream `/api/admin/users` (önek dışına çıkılabiliyor)
  - `/bff/me/x%3Fa%3D1` -> upstream `/api/v1/me/x?a=1` (sorgu dizesi enjeksiyonu)
  - Next sunucusunun istek yolunu eşleyiciden önce ayrıca normalize edip etmediği canlı sunucuda denenmedi: belief.
- Kavramsal istismar:
  - Web vekili üzerinden izin listesi dışındaki `driver/*`, `admin/*`, `payments/*`, `auth/refresh`, `/health` ve prod dışında `/docs` uçlarına ulaşılabiliyor. Müşteri çerezindeki jeton bu isteklere otomatik ekleniyor.
  - Özel işlenen yol `auth/otp/verify` ya da admin'de `auth/staff/2fa` dolaylı yazılırsa (örn. `me/..%2Fauth%2Fotp%2Fverify`), jetonlar çereze yazılmak yerine yanıt gövdesinde JavaScript'e dönüyor. Bu "jetonlar JS'e açılmaz" ilkesini deliyor. XSS ile birleşince oturum jetonu sızdırılabilir.
  - Web relay upstream `content-type` değerini olduğu gibi taşıyor (`web/.../route.ts:98`). Backend'in HTML dönen uçları (sahte ödeme sayfası, Swagger) web kökeninde çizilebiliyor. Bugün okunan HTML uçlarında yansıtma görülmedi, risk ileriye dönük.
- Önerilen düzeltme:
  - Parçaları birleştirmeden önce reddet: herhangi bir parça `.`, `..` ise ya da `/`, `\`, `?`, `#`, `%` veya kontrol karakteri içeriyorsa 400 dön.
  - Upstream URL'yi `new URL(...)` ile kur, `url.pathname`'in `/api/v1/` ile başladığını ve kanonik biçimin izin listesine uyduğunu yeniden kontrol et.
  - Parçaları `encodeURIComponent` ile yeniden kodlayarak birleştir.
  - Önce açığı gösteren test: `/bff/me/..%2Fdriver%2Fme` için 404/400 beklenmeli.

## WEB-02: BFF, istemci kaynaklı IP başlıklarını backend'e güvenilir olarak taşıyor

- OWASP: A04:2021 Insecure Design, A09:2021 Logging Failures. CWE-348 (Use of Less Trusted Source), CWE-290.
- Önem: Orta. IP, Google Places ücretli çağrılarının hız sınırında (`backend/app/api/public.py:109,125,132` -> `places.check_rate_limit(ip)`) ve denetim kayıtlarında (personel girişi, 2FA, admin işlemleri) kullanılıyor. Sahteleme sınırı tamamen etkisiz kılıyor ve denetim izini bozuyor. Kimlik doğrulama atlatması olmadığı için Yüksek değil.
- Dosya:satır: `web/app/bff/[...path]/route.ts:48-50,73-74`, `admin/app/bff/[...path]/route.ts:56-57`, `backend/app/api/deps.py:29-31`
- Kavramsal istismar: Saldırgan her istekte farklı `cf-connecting-ip` (veya `x-forwarded-for`) başlığı gönderir. BFF bu değeri istemci IP'si diye backend'e iletir. Backend IP başına dakikalık Places sınırını her istekte yeni IP olarak görür: maliyet DoS. Personel giriş denemelerinde denetim kaydına keyfi IP yazılır. Cloudflare arkasında CF bu başlığı ezer, ancak origin doğrudan erişilebilirse ya da CF yoksa (repoda dağıtım yapılandırması yok, recon) sahteleme çalışır. Backend de aynı başlığa doğrudan güveniyor (mobil doğrudan bağlanıyor).
- Önerilen düzeltme:
  - BFF'de IP'yi yalnızca yapılandırılmış güvenilir proxy'den al (örn. `TRUSTED_PROXY=cloudflare` iken `cf-connecting-ip`, aksi halde soket adresi veya proxy zincirinin sağdan N'inci değeri). İstemcinin gönderdiği başlığı asla olduğu gibi aktarma.
  - BFF -> backend arasında paylaşılan gizli bir başlık (veya mTLS) kullan. Backend `cf-connecting-ip`'yi yalnızca güvenilir kaynak IP aralıklarından gelince dikkate alsın (uvicorn `--proxy-headers --forwarded-allow-ips`).

## WEB-03: Origin denetimi `x-forwarded-host` değerine güveniyor (keşif ipucu değerlendirmesi)

- OWASP: A01:2021 / A05:2021. CWE-352 (CSRF) için savunma zayıflığı, CWE-346 (Origin Validation Error).
- Önem: Düşük. Tarayıcı tabanlı istismar yolu bulunamadı. Gerekçeleri aşağıda.
- Dosya:satır: `admin/app/bff/[...path]/route.ts:39-48` (satır 42), aynı kod `web/app/bff/[...path]/route.ts:52-61` (satır 55)
- Değerlendirme:
  - CSRF'de istek kurbanın tarayıcısından çıkar. Çapraz kökenli sayfa `x-forwarded-host` gibi özel bir başlık ekleyemez: form ve basit istekler başlık taşımaz, `fetch` ile eklenirse CORS ön kontrolü (preflight) tetiklenir. Vekilde `Access-Control-Allow-*` yanıtı olmadığı için ön kontrol başarısız olur. `Host` başlığını da saldırgan değil tarayıcı belirler.
  - Başlığı serbestçe kuran saldırgan (curl) kurbanın çerezine sahip değil. DNS rebinding'de `Origin` ve `Host` saldırgan alan adı olur, ama çerezler hedef alan adına bağlı olduğu için gönderilmez.
  - `Origin` yoksa veya `null` ise reddediliyor (fail-closed), olumlu.
  - Kalan risk: Kontrol yapılandırılmış sabit kökene değil istek başlıklarına dayanıyor. Ön tarafta istemcinin `X-Forwarded-Host` değerini olduğu gibi geçiren bir proxy, önbellek zehirlemesi ya da gelecekte açılacak bir CORS izni bu varsayımı kırabilir.
- Önerilen düzeltme: `ALLOWED_ORIGINS` (örn. `https://admin.getawaytransfers.com`) ortam değişkeni tanımla. `new URL(origin).origin` değerini bu listeyle tam eşleştir (şema dahil). `x-forwarded-host` ve `host` başlıklarını kullanma. İsteğe bağlı olarak `Sec-Fetch-Site: same-origin` de denetlenebilir.

## WEB-04: CSP `script-src 'unsafe-inline'`

- OWASP: A05:2021 Security Misconfiguration. CWE-1021 / CWE-79 savunma katmanı.
- Önem: Düşük. Doğrudan XSS bulunamadı. Ancak bir XSS oluşursa CSP onu engellemez. Admin panelinde bu, personel oturumuyla tüm `/bff/admin/*` uçlarının çağrılabilmesi demek.
- Dosya:satır: `web/next.config.ts:19`, `admin/next.config.ts:16` (dosyadaki `script-src` satırı)
- Önerilen düzeltme: Next.js middleware ile istek başına nonce üret, `script-src 'self' 'nonce-...' 'strict-dynamic'` kullan. Admin'de dış betik yok, öncelik orada olmalı.

## WEB-05: HSTS yok

- OWASP: A02:2021 Cryptographic Failures / A05. CWE-319, CWE-523.
- Önem: Düşük. TLS'in ön katmanda (Cloudflare) sonlandırıldığı ve HSTS'nin orada açılmış olabileceği varsayımı doğrulanamadı (belief).
- Dosya:satır: `web/next.config.ts:9-32`, `admin/next.config.ts:3-25`, `backend/app/main.py:51-58`. `grep -rn "Strict-Transport" web admin/next.config.ts backend/app` sonuç vermedi.
- Kavramsal istismar: İlk ziyarette veya `http://` bağlantısında SSL strip yapılabilir. Çerezler `Secure` olsa da oturum açma sayfası değiştirilebilir.
- Önerilen düzeltme: Üretimde `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ekle (yalnızca `NODE_ENV=production`), ya da CDN'de açıldığını belgelendir.

## WEB-06: Admin `[id]` rota parametreleri doğrulanmadan BFF yoluna ekleniyor (CSPT)

- OWASP: A01:2021. CWE-22 (istemci tarafı), CWE-352'ye köprü.
- Önem: Düşük. İstismar için personelin hazırlanmış bir bağlantıyı açıp işlem düğmesine basması gerekiyor. Sayfanın açılması için ilk GET'in de geçerli bir `Detail` yapısı dönmesi lazım. Bu iki koşul istismarı çok zorlaştırıyor.
- Dosya:satır: `admin/app/(panel)/bookings/[id]/page.tsx:108-110,132,147`, `admin/app/(panel)/drivers/[id]/page.tsx:28-29,37`. Karşılaştırma: web tarafı `GA[A-Z0-9]{6}` ile doğruluyor (`web/app/[locale]/bookings/[code]/page.tsx:14`, `.../pay/page.tsx:14`), orada sorun yok.
- Kavramsal istismar: `/bookings/<kodlanmış ../ ve ?>` bağlantısı, tarayıcının `fetch('/bff/admin/bookings/' + id + '/cancel')` isteğini başka bir admin ucuna yönlendirmesine yol açar. İstek aynı kökenden geldiği için Origin denetimini geçer.
- Önerilen düzeltme: Sayfada `id` için UUID regex'i uygula, uymuyorsa `notFound()`. `api()` içinde yol parçalarını `encodeURIComponent` ile kodla. WEB-01 düzeltmesi de bunu ikinci katmanda keser.

## WEB-07: Origin denetimi GET'leri kapsamıyor

- CWE-352. Önem: Bilgi.
- Dosya:satır: `web/app/bff/[...path]/route.ts:107`, `admin/app/bff/[...path]/route.ts:92`
- Not: Web çerezi `SameSite=Lax`, bu yüzden çapraz siteden üst düzey GET gezinmesinde çerez gidiyor. Yan etkili GET örnekleri: müşteri sohbet okuma (`backend/app/api/trips.py:246-249`, `now` alıyor, okundu işaretlemesi olabilir, belief) ve belge görüntüleme denetim kaydı (`backend/app/api/admin/fleet.py:196-205`; admin çerezi `Strict`, etkisi yok). Yanıtlar CORS nedeniyle okunamıyor, etki düşük.
- Öneri: Yan etkili işlemleri POST'a taşı ya da GET'lerde de `Sec-Fetch-Site` kontrolü yap.

## WEB-08: Çerez öneki ve Secure bayrağı

- CWE-614 / CWE-1275. Önem: Bilgi.
- Dosya:satır: `web/app/bff/[...path]/route.ts:28-36` (`httpOnly`, `sameSite: lax`, `path: /bff`), `admin/app/bff/[...path]/route.ts:19-27` (`sameSite: strict`)
- Not: Bayraklar iyi durumda. `Secure` bayrağı `NODE_ENV === "production"` koşuluna bağlı. Staging ortamı `development` olarak çalışırsa bayrak düşer. `path=/bff` olduğu için `__Host-` öneki kullanılamıyor. Alt alan adından çerez enjeksiyonuna (cookie tossing) karşı `__Secure-` öneki düşünülebilir.

---

## Negatif bulgular (aranıp bulunamayanlar)

- XSS sink'leri: `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` yok. Arama: Grep `dangerouslySetInnerHTML|innerHTML|...` glob `{web,admin}/{app,components,lib,i18n}/**/*.{ts,tsx}`.
- `href` enjeksiyonu: Dinamik `href` değerleri yalnızca iç yollar, `mailto:` (sabit şirket e-postası) ve sayısal lat/lng içeren harita bağlantıları (`admin/app/(panel)/page.tsx:100`, `web/components/BookingDetail.tsx:559`). `javascript:` riski görülmedi.
- Token saklama: `localStorage` kullanılmıyor. `sessionStorage` yalnızca rezervasyon kodu ve rota taslağı tutuyor (`web/lib/booking.ts:24-48`, `web/lib/trip.ts:59-67`). Jetonlar yalnızca httpOnly çerezde. `document.cookie` kullanılmıyor.
- Açık yönlendirme: `redirect(`, `next=`/`returnTo` parametresi yok. `router.replace/push` hedefleri sabit ya da `BOOKING_CODE_RE` ile doğrulanmış (`web/components/PaymentResult.tsx:16-19,42`, `BookingsHome.tsx:53`). `window.top.location.href = window.location.href` aynı URL.
- SSRF: BFF upstream host'u sabit `GETAWAY_API_URL`. Yol her zaman `/api/v1/` sonrasına eklendiği için host değiştirilemiyor (`//`, `@` denendi). Yalnızca WEB-01'deki yol geçişi var. `web/lib/server.ts` sabit yollar kullanıyor.
- Backend CORS: açık köken listesi, `allow_credentials=False`, joker yok (`backend/app/main.py:28-34`, `config.py:28-33`). Prod köken listesinin ortamda nasıl ayarlandığı görülmedi.
- Admin belge indirme: içerik tipi izin listesi (`pdf/jpeg/png`) ve sihirli bayt denetimi var (`backend/app/services/documents.py:24-49`), `nosniff` başlığı var. HTML/SVG ile depolanmış XSS bulunamadı.
- 2FA QR kodu tarayıcıda üretiliyor, sır üçüncü tarafa gitmiyor (`admin/app/login/page.tsx:26-29`).
- Clickjacking: web `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`, admin `'none'` + `DENY`.
- Web BFF `PUT` dışa aktarmıyor. Admin vekili relay'de yalnızca `content-type`, `content-disposition` ve `cache-control` başlıklarını geçiriyor, upstream `set-cookie` taşınmıyor.

## Atlananlar ve doğrulanmayanlar

- Canlı Next sunucusunda uçtan uca WEB-01 denemesi yapılmadı (worktree'de `node_modules` yok, prod/dev servislere dokunulmadı). Yalnızca Next eşleyicisi ve WHATWG URL davranışı yerelde simüle edildi.
- Üretim dağıtımı (Cloudflare, reverse proxy, HSTS, prod CORS kökenleri) repoda yok.
- `npm audit` / bağımlılık CVE taraması bu alanda yapılmadı.
- Admin rol bazlı menü gizlemesi istemci tarafında. Yetki backend'de, ayrıntılı RBAC incelemesi bu alanın dışında.
- Telefon başına OTP sınırı var ama IP başına sınır yok (`backend/app/services/otp.py:55-63`). SMS pumping riski backend alanına bırakıldı.
