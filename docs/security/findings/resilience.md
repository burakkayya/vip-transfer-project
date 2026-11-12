# Alan 10: Saldırılara dayanıklılık ve izleme

- Tarih: 2026-11-12
- Dal / taban: `claude/security-audit-hardening-5c0e1f` / `0f13f2b`
- Yöntem: statik okuma (çalışan servis yok, dinamik test yapılmadı). Kod değiştirilmedi.
- Etiketler: **verified** = dosya:satır doğrudan okundu; **belief** = çıkarım, bağımsız doğrulanmalı.
- Bağlam: proje geliştirme aşamasında (SMS konsol, ödeme fake, prod dağıtım topolojisi repoda yok). Önem dereceleri **üretime çıkıldığında** oluşacak etkiye göre verildi; dev'deki mevcut etki ayrıca not edildi.
- Secret değeri yazılmadı.

## Özet

| Önem | Adet | ID'ler |
|---|---|---|
| Yüksek | 3 | MON-01, MON-02, MON-03 |
| Orta | 7 | MON-04 … MON-10 |
| Düşük | 4 | MON-11 … MON-14 |
| Bilgi | 1 | MON-15 |

Uygulama katmanı hız sınırı kapsamı (verified, `grep -rn "rate_limit|incr(|TooManyRequests" backend/app`):

| Uç | Sınır | Not |
|---|---|---|
| GET `/places/autocomplete`, GET `/places/{id}`, POST `/routes/preview` | IP başına 60/dk (ortak sayaç) | IP başlıktan alınıyor, sahtelenebilir (MON-01) |
| POST `/auth/otp/request` | telefon başına 5/saat (DB sayımı) | IP / ülke / küresel sınır yok (MON-02) |
| POST `/auth/otp/verify` | challenge başına 5 deneme | IP sınırı yok |
| POST `/me/bookings/{code}/messages`, POST `/driver/trips/{id}/messages` | 10 dk'da 40 mesaj | `services/messages.py:22-23` |
| POST `/quotes` | **yok** | ücretli Routes API (MON-03) |
| POST `/auth/staff/login`, POST `/auth/staff/2fa` | **yok** | Argon2 + TOTP (MON-04) |
| POST `/payments/paytr/callback` | **yok** | her istek DB satırı (MON-05) |
| POST `/driver/documents` | **yok** (yalnızca 10 MB/dosya) | MON-06 |
| WS `/ws/bookings/{code}/location` | **yok** | MON-07 |
| GET `/driver/trips/{id}/approach` | **yok** | ücretli Routes API, önbelleksiz koordinat (MON-12) |
| Diğer tüm uçlar | yok | global middleware yok (`main.py:28-58`) |

---

## MON-01: Hız sınırı ve denetim IP'si istemcinin gönderdiği `cf-connecting-ip` başlığından alınıyor

- **OWASP/CWE:** API4:2023 Unrestricted Resource Consumption; CWE-348 (Use of Less Trusted Source), CWE-290
- **Önem:** Yüksek. Mevcut tek IP tabanlı sınırı (places/routes, Google maliyeti) tümüyle devre dışı bırakır ve tüm `audit_logs.ip`, `sessions.ip`, `otp_challenges.ip` alanlarını sahtelenebilir kılar; olay incelemesinde IP kanıtı güvenilmez olur. Backend `0.0.0.0`'da dinliyor ve mobil istemci doğrudan backend'e bağlanıyor, yani başlığı ayıklayan bir proxy yolda garanti değil. Dev'de etki yok; prod topolojisi (Cloudflare) repoda doğrulanamadığından önem yüksek tutuldu.
- **Konum:**
  - `backend/app/api/deps.py:29-31` `request.headers.get("cf-connecting-ip") or request.client.host`
  - `backend/app/services/places.py:106-113` anahtar `places_rl:{ip}:{dakika}`
  - `web/app/bff/[...path]/route.ts:48-50,73-74`, `admin/app/bff/[...path]/route.ts:56-57`: BFF, gelen `cf-connecting-ip` ya da `x-forwarded-for` ilk değerini olduğu gibi backend'e iletir (istemci kontrolünde).
  - `.vscode/tasks.json:42-43` `--host 0.0.0.0`
- **Kavramsal etki:** Saldırgan her istekte farklı rastgele `cf-connecting-ip` göndererek her istek için yeni bir sayaç anahtarı üretir; 60/dk sınırı hiç tetiklenmez. Google Places/Routes faturası sınırsız büyür. Ayrıca `staff.login_failed` gibi denetim kayıtlarına keyfi IP yazdırılabilir.
- **Öneri:** Güvenilen proxy listesi (ör. Cloudflare IP aralıkları veya yalnızca BFF host'u) dışındaki kaynaklardan gelen `cf-connecting-ip`/`x-forwarded-for` başlıklarını yok say (uvicorn `--proxy-headers --forwarded-allow-ips` ile ya da middleware'de `request.client.host` kontrolüyle). BFF'de istemciden gelen başlığı değil, platformun güvenilir kaynağını kullan; BFF→backend için paylaşılan bir iç başlık/secret ile kaynağı doğrula. Backend'i prod'da yalnızca proxy'den erişilebilir yap.
- **Durum:** verified (kod yolu); prod'da önde başlığı yeniden yazan Cloudflare olup olmadığı belief.

## MON-02: OTP isteği yalnızca telefon başına sınırlı; SMS pompalama (toll fraud) açık

- **OWASP/CWE:** API4:2023 / API6:2023 Unrestricted Access to Sensitive Business Flows; CWE-770, CWE-799
- **Önem:** Yüksek (prod). Netgsm ücretli; numara her ülkeden E.164 kabul ediliyor, sınır yalnızca numara başına 5/saat. Dev'de `sms_provider=console`, maliyet yok.
- **Konum:**
  - `backend/app/api/auth.py:80-91` kimliksiz uç, IP yalnızca kayda yazılıyor
  - `backend/app/services/otp.py:55-63` sayım yalnızca `phone_hash`
  - `backend/app/security/crypto.py:22,52-59` `^\+[1-9]\d{7,14}$` (ülke kısıtı yok)
- **Kavramsal etki:** Bot, premium/uluslararası numara aralıklarına (her numaraya 5/saat) sınırsız sayıda farklı numara için SMS tetikler; SMS faturası ve Netgsm başlık itibarı zarar görür. Ayrıca her istek `otp_challenges` satırı yazar (DB büyümesi; saatlik temizlik var, `worker.py:35`).
- **Öneri:** IP başına (MON-01 düzeltildikten sonra) ve küresel saatlik/günlük OTP bütçesi; izin verilen ülke kodu listesi (hizmet verilen pazarlar); CAPTCHA/Turnstile veya cihaz doğrulaması (App Attest/Play Integrity) eşiği; günlük SMS harcaması için Netgsm tarafında limit ve alarm (MON-09).
- **Durum:** verified

## MON-03: Kimliksiz POST `/quotes` hiç hız sınırına tabi değil ve ücretli Google Routes çağrısı yapıyor

- **OWASP/CWE:** API4:2023; CWE-770, CWE-400
- **Önem:** Yüksek (prod). Fiyat ucu kimliksiz, her çağrı 1 (gidiş-dönüşte 2) Routes API çağrısı yapabilir; önbellek süreç içi, 512 girişle sınırlı ve dolunca tamamen temizleniyor. Dev'de `routing_provider` fake ise etki yok.
- **Konum:**
  - `backend/app/api/public.py:97-100` (sınır yok; karşılaştırma: `public.py:109,125,132` diğer uçlarda var)
  - `backend/app/services/quotes.py:177,183` her teklifte bir veya iki `router.route`
  - `backend/app/providers/routing.py:67-84` süreç belleği önbelleği, `cache_size=512`, dolunca `clear()`
  - `backend/app/services/places.py:71-83` adres jetonu `place_token_hours` boyunca tekrar kullanılabilir
- **Kavramsal etki:** Saldırgan sınırlı sayıda (ör. 50) geçerli adres jetonu toplar (places sınırı da MON-01 ile aşılabilir); N jetondan N² farklı çift + gidiş-dönüş ile önbelleği sürekli ıskalatır ve Routes faturasını sınırsız büyütür. Önbellek temizlenmesi meşru kullanıcıların da maliyetini artırır. İşçi başına ayrı önbellek olduğundan çoklu worker'da etki katlanır.
- **Öneri:** `/quotes` için IP + küresel hız sınırı (preview ile aynı ya da ayrı sayaç); rota önbelleğini Redis'e taşı (LRU, worker'lar arası paylaşımlı); Google Cloud Console'da Routes/Places için günlük kota ve bütçe alarmı; isteğe bağlı olarak jetonları oturuma/IP'ye bağla.
- **Durum:** verified

## MON-04: Personel girişi ve 2FA uçlarında throttling/kilitleme yok (Argon2 CPU tüketimi ve TOTP deneme)

- **OWASP/CWE:** API2:2023 Broken Authentication, API4:2023; CWE-307, CWE-400
- **Önem:** Orta. 2FA zorunlu olduğundan parola tahmini tek başına hesap ele geçirmez, ancak (a) her istek Argon2 hesaplar (kullanıcı yoksa da), bu da kimliksiz CPU tüketimi demek; (b) parola bilinirse `mfa` jetonu süresince (varsayılan 5 dk) TOTP denemesi sınırsız, `valid_window=1` ile her an 3 geçerli kod var. Kimlik alanıyla çakışabilir; burada dayanıklılık açısından raporlandı.
- **Konum:** `backend/app/api/auth.py:147-175`; `backend/app/services/auth.py:244-253,265-281`; `backend/app/security/passwords.py` (Argon2 varsayılan parametreler, recon §3.5)
- **Kavramsal etki:** Birkaç yüz istek/sn ile backend CPU'su doyurulur (uvicorn sync worker havuzu dolar, tüm API yavaşlar). Parolası sızmış bir personel hesabında 5 dk içinde yüksek hızda TOTP denemesi.
- **Öneri:** IP + hesap başına kademeli gecikme / kilitleme (Redis sayaç); `staff.login_failed` / `staff.2fa_failed` eşiği aşınca alarm (MON-09); `mfa` jetonu başına en fazla N TOTP denemesi; kullanılmış TOTP kodunun tekrar kabulünü engelle.
- **Durum:** verified (sınır yokluğu); CPU etkisi belief (ölçülmedi)

## MON-05: PayTR webhook ucu kimliksiz, sınırsız ve geçersiz imzalı her istek için kalıcı DB satırı yazıyor

- **OWASP/CWE:** API4:2023; CWE-770, CWE-400; izleme açısından CWE-778
- **Önem:** Orta. İmza doğrulaması doğru (`hmac.compare_digest`), ama geçersiz istek de `payment_webhooks` tablosuna commit ediliyor; IP allowlist, hız sınırı ve satırda kaynak IP yok. Prod'da PayTR etkin olunca geçerli; dev'de sağlayıcı fake ise uç 404.
- **Konum:** `backend/app/api/payments.py:20-29`; `backend/app/services/payments.py:99-111` (önce `db.add(hook)`, sonra imza kontrolü ve `db.commit()`)
- **Kavramsal etki:** Saldırgan sahte form gövdeleriyle tabloyu şişirir (depolama ve yedek büyümesi, admin ödeme ekranları yavaşlar); gerçek imza saldırısı denemeleri gürültüde kaybolur, kaynak IP kaydı olmadığı için iz sürülemez. İmza hatası yalnızca `log.error` ile stderr'e gider, alarm yok.
- **Öneri:** PayTR'nin yayımladığı çıkış IP'leri için allowlist (proxy'de); geçersiz imzada satır yazmak yerine örneklenmiş/sayaçlı kayıt ve kaynak IP; uç başına hız sınırı; geçersiz imza sayısı eşiğinde alarm.
- **Durum:** verified

## MON-06: Sürücü belge yükleme sayısı sınırsız; global istek gövdesi boyut sınırı yok

- **OWASP/CWE:** API4:2023; CWE-400, CWE-770
- **Önem:** Orta. Sürücü kaydı OTP ile herkese açık ve onay beklemeden belge yüklenebiliyor; dosya başına 10 MB, adet/kota yok. Disk dolması tüm uygulamayı etkiler (yerel disk depolama).
- **Konum:**
  - `backend/app/api/driver.py:70-86` (kayıt yalnızca OTP'li sürücü kullanıcısı ister), `driver.py:113-139` (yükleme)
  - `backend/app/services/documents.py:24-25,45-64` (yalnızca tür, boyut, magic byte kontrolü; adet/kota yok)
  - `backend/app/main.py:19-71` gövde boyutu sınırlayan middleware yok
- **Kavramsal etki:** Script birçok numarayla (MON-02 maliyetine rağmen dev/console ortamında sınırsız) sürücü hesabı açar ve her hesaptan döngüde 10 MB dosya yükler; `var/storage` diski dolar, ayrıca her yükleme değiştirilemez `audit_logs` satırı üretir. Starlette multipart'ı handler'dan önce geçici dosyaya tamamen yazdığından 10 MB üstü dosyalar da önce diske iner.
- **Öneri:** Sürücü/araç başına belge adedi ve toplam boyut kotası, belge türü başına tek "aktif + bekleyen" kayıt; reverse proxy'de `client_max_body_size` (ör. 12 MB yükleme ucu, 1 MB diğerleri); yükleme ucuna hız sınırı; disk doluluk alarmı.
- **Durum:** adet/kota yokluğu verified; Starlette'in multipart'ı tamamen spool etmesi ve proxy'de gövde sınırı olmaması belief (prod proxy yapılandırması repoda yok).

## MON-07: WebSocket konum ucu: bağlantı sınırı yok, olay döngüsünde senkron DB, oturum iptali akışı durdurmuyor, hatalar sessiz

- **OWASP/CWE:** API4:2023; CWE-400, CWE-613 (Insufficient Session Expiration), CWE-778
- **Önem:** Orta. (a) `accept()` kimlik doğrulamadan önce, 10 sn bekleme ile; IP/kullanıcı başına bağlantı sınırı yok. (b) `async def` içinde senkron `SessionLocal()` ve `db.get` her 3 sn'de olay döngüsünü bloklar. (c) Jeton yalnızca ilk mesajda doğrulanıyor; sonra oturum iptal edilse veya erişim jetonu süresi dolsa da bağlantı süresiz konum akıtmaya devam eder (olay müdahalesinde "oturumu düşür" WS'i kesmez). (d) `except Exception` hiçbir şey loglamadan 4401 ile kapatır.
- **Konum:** `backend/app/api/customer.py:267-286`
- **Kavramsal etki:** Binlerce kimliksiz bağlantı açılıp 10 sn tutularak ya da birkaç geçerli müşteri jetonuyla çok sayıda kalıcı bağlantıyla olay döngüsü ve DB bağlantı havuzu tüketilir; tüm async uçlar yavaşlar. Çalınmış bir jetonla açılan bağlantı, jeton iptalinden sonra da sürücü konumunu almaya devam eder. Hatalar görünmez.
- **Öneri:** Kullanıcı ve IP başına eşzamanlı bağlantı sınırı; DB/Redis çağrılarını `run_in_threadpool` ile ya da async istemciyle yap; döngüde periyodik olarak `get_active_session` ve jeton `exp` kontrolü, iptalde kapat; rezervasyon bitince kapat; istisnayı logla.
- **Durum:** verified (kod); yük altındaki etki belief.

## MON-08: Denetim kaydı kapsamında güvenlik olayı boşlukları; politika ile uygulama uyuşmuyor

- **OWASP/CWE:** A09:2021 Security Logging and Monitoring Failures; CWE-778, CWE-223
- **Önem:** Orta. Personel giriş/2FA hataları kaydediliyor (iyi), ancak müşteri/sürücü kimlik olayları, yetki redleri ve PII okumaları kaydedilmiyor. `docs/yasal_ve_guvenlik.md:24` "Her erişim (admin dahil) `audit_logs` tablosuna yazılır" diyor; kod bunu karşılamıyor (KVKK erişim izi gereksinimi).
- **Kanıt (yazılan olaylar):** `grep -rn "audit.record(" backend/app` sonucu: staff.login, staff.login_failed, staff.2fa_failed, staff.2fa_enabled, staff_user.create/update/change_password, document.view/upload/review, booking.chat_view, customer.anonymize, katalog/finans değişiklikleri, payment.paid/manual, driver.register vb.
- **Yazılmayan olaylar (aramam `audit.record` çağrısını bulamadı):**
  - OTP isteği ve başarısız OTP doğrulaması: `backend/app/api/auth.py:80-115`, `services/otp.py:105-109`
  - Refresh başarısızlığı / iptal edilmiş jetonla deneme: `services/auth.py:60-69`
  - Çıkış ve oturum iptali (`revoke_session`, `revoke_other_sessions`): `services/auth.py:80-89`; personel kullanıcı devre dışı bırakmada oturum kapatma (`admin/people.py:166-169`) yalnızca `staff_user.update` olarak, iptal sayısı yok
  - Yetki redleri (403/401): `backend/app/api/deps.py` içinde `Forbidden`/`Unauthorized` fırlatılan yerlerde kayıt yok; `main.py:36-41` handler da kaydetmiyor
  - Geçersiz webhook imzası: yalnızca `payment_webhooks.signature_valid=false` + stderr log (`services/payments.py:108-111`), denetim kaydı yok
  - Admin PII okumaları: GET `/admin/customers` (`admin/people.py:40`), GET `/admin/bookings/{id}` (`admin/operations.py:132`), GET `/admin/customers/lookup` (`admin/manual_bookings.py:106`), GET `/admin/payouts/export.csv` kayıtlı (iyi) ama müşteri listesi/detayı değil
- **Kavramsal etki:** Müşteri hesabı ele geçirme denemeleri, toplu yetki tarama (IDOR denemesi) ve iç personelin PII gezintisi iz bırakmaz; olay sonrası kapsam tespiti ve KVKK ihlal bildirimi yapılamaz.
- **Öneri:** Güvenlik olayları için ayrı kategori (`security.*`): otp.request/verify_failed, auth.refresh_failed, auth.forbidden (handler'da, örneklenmiş), webhook.invalid_signature, session.revoke; admin PII okuma uçlarına `*.view` kaydı; yüksek hacimli olaylar için DB yerine yapılandırılmış log + merkezi toplama (MON-09).
- **Durum:** verified

## MON-09: Merkezi log, hata izleme ve alarm mekanizması yok

- **OWASP/CWE:** A09:2021; CWE-778
- **Önem:** Orta (dev aşamasında beklenen eksik; prod öncesi zorunlu). Başarısız giriş patlaması, imza hatası, SMS/Google harcama artışı, worker hataları için hiçbir uyarı yolu yok.
- **Kanıt (negatifler):**
  - Hata izleme: aramam Sentry/OpenTelemetry/Prometheus kullanımı bulamadı (`grep -rn -E "sentry|Sentry|opentelemetry|prometheus" --glob '!**/node_modules/**'`; yalnızca `docs/teknoloji.md:25` planı ve `docs/acik_konular.md:28` açık madde, `backend/requirements.txt` içinde paket yok).
  - Log yapılandırması: aramam backend uygulamasında `logging.basicConfig|dictConfig` bulamadı (yalnızca `backend/alembic/env.py:1` `fileConfig`); `log.error`/`log.warning` çağrıları uvicorn varsayılan stderr'ine gider, yapılandırılmış (JSON) format ya da istek kimliği yok.
  - Alarm: aramam `staff.login_failed` veya `signature_valid` sayan bir iş/eşik bulamadı (`backend/app/worker.py:27-51` cron listesi yalnızca iş mantığı).
  - `backend/app/main.py:16` `log` tanımlı ama kullanılmıyor; genel `Exception` handler yok (500'ler yalnızca uvicorn tarafından loglanıyor).
- **Kavramsal etki:** Kaba kuvvet, SMS pompalama veya maliyet saldırısı fatura gelene kadar fark edilmez; prod'da hatalar sunucu konsolunda kaybolur.
- **Öneri:** Sentry (AB bölgesi, PII scrubbing; `docs/acik_konular.md:28` kararıyla) backend + worker + Next.js; JSON log + istek kimliği + merkezi toplama (Loki/CloudWatch vb.); alarmlar: personel başarısız giriş > N/5 dk, OTP istek oranı, webhook geçersiz imza > 0, 5xx oranı, worker iş hatası, Google/Netgsm günlük bütçe.
- **Durum:** verified (negatif aramalar)

## MON-10: Olay müdahale hazırlığı: doküman yok, toplu oturum düşürme yok, secret rotasyonu zor

- **OWASP/CWE:** A09:2021; CWE-613; CWE-320 (Key Management Errors)
- **Önem:** Orta. Tek tek parçalar düşük, birlikte bir olayda müdahaleyi ciddi yavaşlatır.
- **Kanıt:**
  - Olay müdahale dokümanı: aramam `docs/` altında incident/olay müdahale/runbook/ihlal bildirimi içeriği bulamadı (`grep -i "olay müdahale|incident|runbook|72 saat|breach" docs`); `docs/yasal_ve_guvenlik.md:28` yalnızca "felaket kurtarma senaryosu yazılır" diyor.
  - Toplu oturum iptali: kullanıcı başına iptal var (`admin/people.py:112-114` müşteri anonimleştirme, `people.py:166-169` personel devre dışı, `services/auth.py:86-89` parola değişikliği). Tüm oturumları ya da belirli bir türün (ör. tüm personel) oturumlarını düşüren CLI/uç yok (`backend/app/cli.py:21-25` yalnızca seed, seed-demo, create-admin).
  - JWT secret rotasyonu oturumları düşürmez: erişim jetonları geçersizleşir ama refresh jetonları DB'de SHA-256 özetiyle tutulduğundan (`services/auth.py:60-77`) yeni secret ile yeni erişim jetonu alınır. Ayrıca tek anahtar, `kid` yok, çoklu doğrulama anahtarı desteklenmiyor (`security/tokens.py:41,58`); aynı `jwt_secret` adres jetonları (`services/places.py:83,88`), MFA jetonları ve FakeProvider imzası için de kullanılıyor, yani rotasyon kesintisiz yapılamaz.
  - `blind_index_key` rotasyonu için yeniden indeksleme aracı yok (`security/crypto.py:47-49`); anahtar değişirse tüm telefon/e-posta aramaları ve OTP kod özetleri kırılır. Fernet tarafı `MultiFernet` ile rotasyona hazır (`crypto.py:25-28`), ancak eski veriyi yeni anahtarla yeniden şifreleyen araç yok (belief: `grep -rn rotate backend/app` sonuç vermedi).
  - Sürücü askıya alma (`services/documents.py:110` `driver.status`) kullanıcı oturumlarını iptal etmiyor; `get_active_session` yalnızca `User.status` bakıyor (`services/auth.py:96`). Askıya alınan sürücünün oturumu açık kalır; uç bazında `Driver.status` kontrolü olup olmadığı bu alanda okunmadı. belief
  - WS akışı oturum iptalinden etkilenmiyor (MON-07).
- **Kavramsal etki:** Secret sızıntısında (ör. `jwt_secret`) tüm oturumları hızla düşürmek için DB'de elle SQL gerekir; adres jetonları ve ödeme akışı aynı anda kırılır; kimin, ne zaman, kime haber vereceği tanımsız (KVKK 72 saat bildirimi).
- **Öneri:** `docs/olay_mudahale.md` (roller, iletişim, KVKK bildirim akışı, secret başına rotasyon adımları); CLI `revoke-sessions --all|--kind staff|--user`; `jwt_secret`'ı amaçlara göre ayır (access, mfa, place_token, fake_payment) ve `kid` + çoklu doğrulama anahtarı; blind index için sürüm alanı ve yeniden indeksleme komutu; Fernet yeniden şifreleme komutu; sürücü askıya alındığında oturumları iptal et.
- **Durum:** verified (aksi belirtilenler hariç)

## MON-11: Refresh jetonu yeniden kullanım tespiti ve alarmı yok

- **OWASP/CWE:** A07:2021; CWE-613, CWE-778
- **Önem:** Düşük (kimlik alanıyla çakışır; burada izleme açısından). Döndürme var ama eski jeton kullanılınca yalnızca 401 dönüyor; oturum ailesi iptal edilmiyor, kayıt/alarm üretilmiyor.
- **Konum:** `backend/app/services/auth.py:60-77`
- **Kavramsal etki:** Çalınan refresh jetonu meşru kullanıcıdan önce kullanılırsa saldırgan oturumu sürdürür, meşru kullanıcı yalnızca "oturum geçersiz" görür; olay tespit edilemez.
- **Öneri:** Önceki özetleri sakla; eski özetle gelen istekte ilgili oturumu iptal et, `security.refresh_reuse` kaydı ve alarm.
- **Durum:** verified

## MON-12: Sürücü `approach` ucu her çağrıda keyfi koordinatla ücretli Routes API'ye gidiyor

- **OWASP/CWE:** API4:2023; CWE-770
- **Önem:** Düşük. Atanmış yolculuğu olan onaylı sürücü gerekir; ancak koordinat her çağrıda değişebildiği için önbellek işe yaramaz ve sınır yok.
- **Konum:** `backend/app/api/trips.py:160-184` (`get_routing().route(at, target)`)
- **Kavramsal etki:** Kötü niyetli ya da hatalı istemci (sıkı döngüde poll eden uygulama) Routes faturasını artırır.
- **Öneri:** Sürücü başına hız sınırı (ör. 6/dk), koordinatı yuvarlayıp kısa süreli Redis önbelleği.
- **Durum:** verified

## MON-13: Sayfalama: offset üst sınırı yok, bazı liste uçları sınırsız

- **OWASP/CWE:** API4:2023; CWE-400
- **Önem:** Düşük. Admin listeleri `limit ≤ 200` (iyi), müşteri/sürücü listelerinde sabit `limit` var. Kalan uçlar kimlikli ve veri hacmi küçük.
- **Konum:**
  - `backend/app/api/admin/common.py:15-16` `offset` için üst sınır yok (büyük offset'li sorgu tam tarama yapar)
  - `.limit(` bulunmayan liste uçları (grep çıktısında yok, tek tek okunmadı): GET `/admin/dispatch/pending` (`operations.py:234`), GET `/admin/drivers/online` (`operations.py:282`), GET `/admin/documents/expiring` (`fleet.py:178`), GET `/admin/payouts/export.csv` (`finance.py:159-174`, yalnızca PENDING), GET `/admin/regions`, `/pricing-rules` vb. katalog listeleri, GET `/me/consents`, GET `/me/data-requests`, GET `/driver/documents`, GET `/driver/vehicles`, GET `/driver/jobs` (`trips.py:105-112`, her satırda ek sorgu)
  - `admin/fleet.py:100` ve `trips.py:62-73` satır başına ek sorgu (N+1)
- **Kavramsal etki:** Veri büyüdükçe bu uçlar yavaşlar; ele geçirilmiş personel hesabı ile pahalı sorgu tekrarı. Kimliksiz istismar yok.
- **Öneri:** `offset ≤ 10_000` veya cursor sayfalama; sınırsız uçlara sabit üst limit; N+1 için `selectinload`.
- **Durum:** limit/offset kısmı verified; "sınırsız" listesi belief (grep negatifi, her uç okunmadı).

## MON-14: Worker cron grupları tek hata ile kesiliyor, iş hatası için alarm yok

- **OWASP/CWE:** CWE-755 (Improper Handling of Exceptional Conditions), CWE-778
- **Önem:** Düşük. Güvenlik etkisi dolaylı: `cancel_unpaid_bookings` veya `purge_otp_challenges` / `purge_trip_messages` (KVKK saklama süresi) bir önceki işin istisnasıyla atlanabilir.
- **Konum:** `backend/app/worker.py:18-41` (`_run` çağrıları ardışık, try/except yok)
- **Kavramsal etki:** Ör. `refresh_flights` dış API hatasıyla patlarsa aynı dakikadaki sonraki işler çalışmaz; saatlik grupta `purge_flight_data` patlarsa OTP ve mesaj temizliği yapılmaz; kimse fark etmez.
- **Öneri:** Her işi ayrı try/except ile çalıştır, hatayı Sentry'ye ve sayaca gönder; temizlik işleri için "son başarılı çalışma" metriği ve alarm.
- **Durum:** verified (kod); alt işlerin kendi içinde istisnayı yutup yutmadığı tek tek okunmadı (`flight_tracking.py:177,180` bazılarını yakalıyor), belief.

## MON-15: `/health` bilgi sızdırmıyor, ancak yalnızca canlılık döndürüyor

- **OWASP/CWE:** yok (bilgi)
- **Önem:** Bilgi. `{"status": "ok"}` sabit yanıt; sürüm, ortam, bağımlılık bilgisi yok. DB/Redis kontrolü yapılmadığı için dağıtım/izleme tarafında hazır olma sinyali olarak yetersiz.
- **Konum:** `backend/app/main.py:60-62`
- **Öneri:** Ayrı `/ready` (DB `SELECT 1`, Redis `PING`), yalnızca iç ağdan erişilebilir; ayrıntılı durum herkese açık yanıta konmamalı.
- **Durum:** verified

---

## Olumlu gözlemler (verified)

- Mesaj gönderimi kullanıcı başına sınırlı (`services/messages.py:22-23`).
- OTP doğrulamasında challenge başına deneme sınırı ve `FOR UPDATE` (`services/otp.py:93-109`).
- Personel başarısız giriş ve 2FA hataları denetim kaydına yazılıyor, `audit_logs` UPDATE/DELETE tetikleyiciyle engelli (recon §4).
- Admin listelerinde `limit ≤ 200` (`admin/common.py:15`).
- Places rate limit Redis erişilemezse istisna fırlatır (fail-closed, `services/places.py:109`).
- Prod'da `/docs` ve `/openapi.json` kapalı (`main.py:24-26`).

## Bu alanda atlananlar / doğrulanmayanlar

- Dinamik yük testi (WS, Argon2 CPU, multipart spool davranışı) yapılmadı.
- Prod reverse proxy / Cloudflare / WAF yapılandırması repoda yok; tüm "proxy'de sınır yok" ifadeleri belief.
- Next.js BFF'lerde istek gövdesi boyut sınırı ve hız sınırı ayrıntılı incelenmedi (yalnızca IP iletimi okundu).
- Admin dashboard (`operations.py:29`) ve rapor sorgularının maliyeti okunmadı.
- `services/jobs.py` iş gövdeleri ve sürücü uçlarında `Driver.status` kontrolü okunmadı.
- Google/Netgsm/AeroDataBox tarafındaki kota/bütçe ayarları repo dışı; doğrulanamadı (AeroDataBox için günlük kullanım sayacı var: `services/flight_tracking.py:61-63`).
