
# Güvenlik denetimi: birleştirilmiş bulgular

- Tarih: 2026-11-12
- Dal / taban: `claude/security-audit-hardening-5c0e1f` / `0f13f2b`
- Kaynaklar: `docs/security/findings/{auth,api,resilience,db,business,privacy,web,mobile,realtime,infra}.md` (121 ham bulgu), `docs/security/verification-{A,B,C}.md` (bağımsız doğrulama) ve yönetici kararları (kanonik ID'ler, önem düzeltmeleri, sahiplenilmemiş iki yeni bulgu).
- Yöntem: statik okuma. Dinamik test yapılmadı. Kod değiştirilmedi. Secret değerleri yazılmadı.
- Düzeltme planı: `docs/security/remediation-plan.md`.

## Özet

| Önem | Sayı |
|---|---|
| Kritik | 0 |
| Yüksek | 5 |
| Orta | 25 |
| Düşük | 47 |
| Bilgi | 17 |
| **Toplam kanonik bulgu** | **94** |

- 121 ham bulgu ile 2 yeni bulgu (EXT-01, EXT-02) toplam 123 kayıt ediyor. Bunların 29'u mükerrer olarak kanonik bir bulguya birleştirildi ya da bölündü.
- Birleşenler: AUTH-03, BIZ-01, API-12, MOB-09 (INF-01'e). RT-02, DB-11 (INF-02'ye). API-02, API-05, MON-04 (AUTH-01'e). API-01, MON-02 (AUTH-04'e). API-03, MON-01, WEB-02, PRIV-09 (AUTH-05'e). DB-05 (PRIV-01'e). INF-10 (Redis kısmı RT-01'e, Postgres ve `0.0.0.0` kısmı DB-10'a). RT-06, DB-06 (PRIV-04'e). RT-09, MOB-08 (BIZ-02'ye). API-13 (WEB-01'e). MON-07 kaldırıldı ve RT-03, RT-04, RT-05'e bölündü. AUTH-09 RT-03'e birleşti. INF-14 (PRIV-02'ye). API-04 (MON-03'e). MON-05 (API-06'ya). MON-06 (API-07'ye). MON-11 (AUTH-08'e).
- Tüm bulguların durumu: AÇIK.

Doğrulama durumu etiketleri:
- **doğrulandı**: kod yolu bağımsız doğrulayıcı tarafından yeniden okundu.
- **dinamik test gerekli**: kod yolu doğru, istismar çalışan sistemde denenmeli.
- **doğrulanmadı**: yalnızca tek kaynakta görüldü, bağımsız doğrulama yok.

---

## Yüksek

### INF-01: `env` serbest metin ve güvensiz varsayılan; üretim korumaları yalnızca tam `"prod"` eşleşmesine bağlı

- Kategori: OWASP A05:2021 Security Misconfiguration, A04:2021 Insecure Design; CWE-1188, CWE-693, CWE-306 (sahte ödeme ucu).
- Önem: **Yüksek**. Kodda varsayılan güvensiz durum seçilmiş (fail-open). `production`, `staging`, `Prod` gibi tek bir yazım hatası ya da değişkenin unutulması bütün prod korumalarını sessizce kapatıyor. Sonuçları iki doğrudan ele geçirme yolu açıyor: herhangi bir müşteri ödeme yapmadan rezervasyonu "ödendi" yapabiliyor ve konsol SMS ile `dev_code` yanıtta döndüğü için herhangi bir telefonla giriş yapılabiliyor. Ön koşul olarak bir yapılandırma hatası gerektiği için Kritik verilmedi.
- Etkilenen yer:
  - `backend/app/config.py:24` (`env: str = "dev"`, `Literal` değil), `config.py:91` (`payment_provider="fake"`), `config.py:116,125` (validator yalnızca `env == "prod"` olduğunda çalışıyor)
  - `backend/app/services/otp.py:78` (`dev_code` koşulu `env != "prod"`)
  - `backend/app/api/payments.py:62-66,81-96` (sahte ödeme uçları kimliksiz; CSRF koruması yok)
  - `backend/app/main.py:24-26` (`/docs`), `backend/app/demo.py:77` (demo seed)
  - `backend/app/providers/payments.py:224` (FakeProvider imza anahtarı `jwt_secret`)
  - `mobile/app/login.tsx:69,107-108,203-206` (`dev_code` gösterilip tek dokunuşla doğrulanıyor)
- İstismar / etki: Sunucu `GETAWAY_ENV=production` ile ya da değişken verilmeden açılıyor. (a) Repodaki dev JWT, Fernet ve blind index anahtarları kabul ediliyor. Bu durumda jeton sahteciliği mümkün, DB sızarsa PII çözülüyor. (b) Konsol SMS açıksa `/auth/otp/request` yanıtındaki `dev_code` ile herhangi bir hesaba giriliyor. (c) Müşteri `iframe_url` içindeki `oid` değerini alıp `POST /api/v1/payments/fake/{oid}/complete` çağırıyor, rezervasyon CONFIRMED oluyor. (d) `/docs` açılıyor ve demo seed çalışıyor. Not (doğrulayıcı B): (c) için `payment_provider` ayarının da varsayılanda kalmış olması gerekiyor. `FakeProvider.public_api_url` sabit localhost olduğu için yanlış yapılandırma kısa sürede fark edilir. Yönetici kararıyla önem Yüksek tutuldu.
- Önerilen düzeltme: `env: Literal["dev", "test", "prod"]` tanımlanmalı, bilinmeyen değerle uygulama açılmamalı. İleride `stage` eklenirse prod ile aynı korumaları almalı. Koşullar "prod değilse" yerine izin listesine çevrilmeli (`env in {"dev","test"}`). Sahte ödeme router'ı yalnızca dev ve test ortamında `include_router` ile eklenmeli. `dev_code` yalnızca dev ve test ortamında dönmeli. Mobilde `__DEV__` false iken `dev_code` gösterilmemeli. FakeProvider ayrı bir anahtar kullanmalı.
- Birleşen ID'ler: AUTH-03, BIZ-01, API-12, MOB-09.
- Doğrulama: doğrulandı (A, B, C).
- DURUM: AÇIK

### AUTH-01: Personel parola ve 2FA adımında deneme sınırı, hesap kilidi ve MFA jetonu tek kullanımı yok

- Kategori: OWASP A07:2021, API2:2023, API4:2023; CWE-307, CWE-1390, CWE-400.
- Önem: **Yüksek**. Admin paneli rezervasyon, iade, hakediş ve personel yönetimine erişiyor. `valid_window=1` ile her denemenin başarı olasılığı yaklaşık 3/10^6. MFA jetonu 5 dk geçerli ve yeniden alınabiliyor. Doğrulayıcı A'nın hesabına göre 300 istek/sn hızda beklenen kırılma süresi yaklaşık 20 dk. Parola sızmışsa 2FA pratikte koruma sağlamıyor. Ayrıca her parola denemesi Argon2 ile hesaplanıyor (kullanıcı yoksa da), yani kimliksiz CPU ve bellek tüketimi mümkün.
- Etkilenen yer:
  - `backend/app/services/auth.py:244-253` (`staff_login`: başarısızlıkta yalnızca denetim kaydı)
  - `backend/app/services/auth.py:265-288` (`staff_verify_2fa`: sayaç yok)
  - `backend/app/security/tokens.py:44-53` (MFA jetonunda `jti` yok)
  - `backend/app/api/auth.py:147-175` (uçlarda sınır yok)
  - `backend/app/security/passwords.py:8` (varsayılan `PasswordHasher()`)
- İstismar / etki: Parolayı bilen saldırgan `/auth/staff/login` ile MFA jetonu alıyor. Ardından `/auth/staff/2fa` ucuna 000000-999999 aralığını paralel gönderiyor, jetonun süresi dolunca yeniden giriş yapıyor. Parola bilinmiyorsa sınırsız kimlik bilgisi doldurma yapılabiliyor. Paralel isteklerle uvicorn worker'larının CPU ve belleği tüketilebiliyor.
- Önerilen düzeltme: Hesap ve IP başına Redis sayacı kullanılmalı. MFA jetonuna `jti` eklenmeli, jeton başına en fazla 5 deneme hakkı olmalı ve başarılı kullanımdan sonra jeton iptal edilmeli. Kullanıcı başına 15 dk içinde 10 hatada geçici kilit ve artan bekleme uygulanmalı. Kilit olayları denetim kaydına yazılmalı ve bildirim gönderilmeli. Argon2 doğrulaması eşzamanlılık sınırlı bir semafor arkasında çalışmalı. IP sayacı ancak AUTH-05 düzeltildikten sonra güvenilir olur.
- Birleşen ID'ler: API-02, API-05, MON-04.
- Doğrulama: doğrulandı (A).
- DURUM: AÇIK

### AUTH-04: OTP isteğinde IP, ülke ve küresel sınır yok (SMS pompalama / toll fraud)

- Kategori: OWASP API4:2023, API6:2023; CWE-770, CWE-799.
- Önem: **Yüksek**. Kimlik gerektirmiyor, kolayca otomatikleştirilebiliyor ve doğrudan maliyet doğuruyor (Netgsm faturası). Tek sınır telefon başına saatte 5. Numara değiştirilerek bu sınır aşılıyor ve her E.164 numara kabul ediliyor. Hesap ele geçirme riski yok.
- Etkilenen yer:
  - `backend/app/api/auth.py:80-91` (kimliksiz uç)
  - `backend/app/services/otp.py:55-63` (sayım yalnızca `phone_hash` üzerinden), `otp.py:66-76` (her istek bir `otp_challenges` satırı yazıyor)
  - `backend/app/security/crypto.py:22,52-59` (`^\+[1-9]\d{7,14}$`, ülke kısıtı yok)
  - `backend/app/providers/sms.py:35-36` (uluslararası gönderimin açılması planlanıyor)
- İstismar / etki: Bot, yüksek ücretli uluslararası numara aralıklarına (IRSF) sürekli `/auth/otp/request` gönderiyor. Her yeni numara 5 SMS hakkıyla başlıyor. Sonuç olarak SMS faturası büyüyor, gönderici başlığının itibarı zarar görüyor ve DB büyüyor.
- Önerilen düzeltme: IP başına ve /24 (IPv6 için /64) blok başına dakikalık ve saatlik sınır, ayrıca küresel saatlik/günlük OTP bütçesi konmalı (Redis sayacı). Ülke kodu izin listesi ya da TR dışı numaralar için ayrı düşük bir kota tanımlanmalı. Anormal artışta devre kesici ve CAPTCHA (Turnstile) devreye girmeli. Netgsm tarafında günlük limit ve alarm kurulmalı. IP sınırının işe yaraması için AUTH-05 de düzeltilmeli.
- Birleşen ID'ler: API-01, MON-02.
- Doğrulama: doğrulandı (A). Netgsm tarafındaki uluslararası gönderim ayarı doğrulanmadı.
- DURUM: AÇIK

### PRIV-01: Silme talebi hiçbir veriyi silmiyor; anonimleştirme talepten bağımsız ve kapsamı eksik

- Kategori: KVKK m.7 ve m.11/1-e, GDPR m.17 ve m.5/1-e; OWASP A04:2021; CWE-212, CWE-359.
- Önem: **Yüksek**. Silme hakkı yasal bir yükümlülük ve etki tüm müşterileri kapsıyor. Talep "tamamlandı" işaretlenebiliyor ama yolcu adı, adresler, kesin koordinatlar ve not kalıcı olarak duruyor.
- Etkilenen yer:
  - `backend/app/api/admin/people.py:77-91` (`update_data_request` yalnızca durum, not ve `completed_at` alanlarını güncelliyor, `request_type`'a bakmıyor; `OpsOrSupport` kapatabiliyor)
  - `backend/app/api/admin/people.py:94-118` (`anonymize_customer` ayrı bir uç ve `AdminOnly`. Yalnızca `full_name`, `email`, `users.phone/phone_hash`, `deleted_at`, durum ve oturum iptali işleniyor)
  - Admin UI'da iki ekran birbirine bağlı değil: `admin/app/(panel)/data-requests/page.tsx:33`, `admin/app/(panel)/customers/page.tsx:37,87`
  - Kalan veriler: `bookings.passenger_name/note` (`models/booking.py:50-51`), `booking_legs` adres ve koordinatları (`booking.py:124-129`), `customers.push_token/country_code/locale` (`models/customer.py:33-39`), `sessions.ip/device_info` (`models/identity.py:69-70`), `consents.ip` (`customer.py:56`), `data_requests.note` (`customer.py:70`), `trip_updates`, `trip_messages`, `notifications`
  - Sürücü anonimleştirmesi ve sürücü veri talebi ucu yok. Erişim talebi için dışa aktarım ucu yok. Bu akış için test yok.
- İstismar / etki: Silme talebi uygulanmış bir müşterinin adı, yolculuk adresleri ve notları admin rezervasyon detayında, sürücünün geçmiş listesinde (PRIV-06) ve DB dökümünde okunmaya devam ediyor. Destek rolü talebi "tamamlandı" yapabiliyor ama veriyi silemiyor.
- Önerilen düzeltme: `silme` talebinin tamamlanması anonimleştirmeye bağlanmalı (ya anonimleştirme talep id'si istemeli ya da tamamlama yalnızca anonimleştirmeyle mümkün olmalı, AdminOnly). Kapsama yolcu adı ve not, bacak adres ve koordinatları (NULL ya da bölge merkezi), `push_token`, `sessions` IP/UA, `trip_messages` ve `trip_updates` eklenmeli. Yasal olarak saklanan alanlar (tutar, tarih, fatura) açıkça listelenmeli. Sürücü için eşdeğer akış ve erişim talebi için JSON dışa aktarım ucu eklenmeli. Saklanacak alanlar hukukçu teyidi gerektiriyor.
- Birleşen ID'ler: DB-05.
- Doğrulama: doğrulandı (B, satır satır).
- DURUM: AÇIK

### RT-01: Redis parolasız ve tüm arayüzlere açık; ARQ varsayılan pickle ile worker'da kod çalıştırma zinciri

- Kategori: OWASP A05:2021, A08:2021; CWE-306, CWE-502, CWE-668.
- Önem: **Yüksek** (koşullu). Redis'e ağdan erişen kimliği doğrulanmamış biri canlı sürücü konumlarını okuyabilir, sahte konum yazabilir, Places sayaçlarını sıfırlayabilir ve ARQ kuyruğuna pickle yükü koyarak worker sürecinde kod çalıştırabilir. Worker sürecinde DB DSN'i ve alan şifreleme anahtarları bulunuyor. Dev'de RCE geliştirici makinesinde gerçekleşir. Aynı yapılandırma üretimde kullanılırsa etki Kritik olur.
- Etkilenen yer:
  - `docker-compose.yml:18-21` (`requirepass` yok, `"6379:6379"` host IP'si belirtilmemiş)
  - `backend/app/config.py:26` (`redis_url` parolasız, TLS'siz; prod validator denetlemiyor, bkz. INF-02)
  - `backend/app/worker.py:44-46` (`job_deserializer` yok). arq 0.28.0 `arq/jobs.py:295-296` varsayılan olarak `pickle.loads` kullanıyor, `arq/worker.py:519-536` deserializasyon fonksiyon adı kontrolünden önce yapılıyor
  - `backend/app/services/live_location.py:29-35` (`leg_loc:{leg_id}` düz JSON)
  - `.vscode/tasks.json:56-57` (worker dev'de hostta çalışıyor)
- İstismar / etki: Aynı ağdaki saldırgan `SCAN leg_loc:*` ile aktif yolculukları izliyor. `SET leg_loc:<id>` ile sahte konum yazıyor, bu konum FINISHED adımında da kullanılıyor (`driver.py:364-365`). `arq:job:<id>` anahtarına zararlı pickle yazıp kuyruğa ekleyerek worker hostunda komut çalıştırıyor.
- Önerilen düzeltme: ARQ'da `job_serializer/job_deserializer` için JSON kullanılmalı (worker ve `create_pool`). Compose'da `127.0.0.1:6379:6379` ve `--requirepass` kullanılmalı, parola `.env`'den gelmeli. Prod validator Redis parolası ya da ACL kullanıcısı ile `rediss://` şemasını zorunlu tutmalı. Üretimde Redis özel ağda, en az yetkili ACL ile (`-@dangerous`) çalışmalı. `live_location` istemcisine zaman aşımı eklenmeli (RT-04).
- Birleşen ID'ler: INF-10 (Redis kısmı).
- Doğrulama: doğrulandı (C; arq kaynağı okundu). LAN'dan erişilebilirlik (Docker Desktop ve Windows güvenlik duvarı) için dinamik test gerekli.
- DURUM: AÇIK

---

## Orta

### AUTH-02: 2FA kurulmamış personelde parola tek başına TOTP sırrını veriyor; `reset_2fa` oturumları kapatmıyor

- Kategori: OWASP A07:2021; CWE-308, CWE-613.
- Önem: Orta. Saldırı parolanın bilinmesine ve hesabın kurulum penceresinde olmasına bağlı.
- Etkilenen yer: `backend/app/services/auth.py:256-262` (sır yalnızca yoksa üretiliyor ve `provisioning_uri` parola sonrası dönüyor), `auth.py:282-285` (ilk geçerli kod 2FA'yı etkinleştiriyor), `backend/app/api/admin/people.py:170-172` (`reset_2fa` oturumları kapatmıyor; DISABLED dalı `:167-169` kapatıyor).
- İstismar / etki: (a) İlk parolayı ileten kanalı ele geçiren saldırgan, personelden önce giriş yapıp hesabı kendi doğrulayıcısına bağlar. Doğrulayıcı A'nın düzeltmesi: meşru kullanıcı yalnızca iki taraf aynı sırrı kurulum penceresinde aldıysa durumu fark etmez. Saldırgan 2FA'yı önce etkinleştirirse kullanıcı kurulum ekranını görmez ve sorunu fark eder. (b) Cihazı çalınan personel için `reset_2fa` yapılsa bile çalınan cihazdaki oturum ve 30 günlük yenileme jetonu açık kalır.
- Önerilen düzeltme: İlk kurulum tek kullanımlık, kısa ömürlü bir davet bağlantısıyla yapılmalı. Her kurulum başlangıcında yeni sır üretilmeli. İlk girişte parola değişikliği zorunlu olmalı. `reset_2fa` ve rol değişikliğinde kullanıcının tüm oturumları iptal edilmeli.
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (A).
- DURUM: AÇIK

### AUTH-05: İstemci IP'si doğrulanmamış `cf-connecting-ip` / `x-forwarded-for` başlığından alınıyor

- Kategori: OWASP A04:2021, API8:2023, A09:2021; CWE-348, CWE-290.
- Önem: **Orta**. Origin Cloudflare dışından doğrudan erişilebiliyorsa (mobil uygulama `api.getawaytransfers.com` adresine doğrudan bağlanıyor) **Yüksek** olur. Prod topolojisi repodan bilinmiyor.
- Etkilenen yer: `backend/app/api/deps.py:29-31`, `backend/app/services/places.py:106-113` (`places_rl:{ip}:{dakika}`), `backend/app/api/public.py:104-132`, `backend/app/api/customer.py:124-126` (PayTR'a giden `user_ip`), `customer.py:203-206` (`consents.ip`), `web/app/bff/[...path]/route.ts:48-50,73-74`, `admin/app/bff/[...path]/route.ts:56-57`, `.vscode/tasks.json:42-43` (dev `0.0.0.0`).
- İstismar / etki: Her istekte rastgele bir başlık değeri gönderilirse Places/Routes için konan IP başına 60/dk sınırı hiç dolmuyor ve Google faturası büyüyor. Ayrıca `audit_logs.ip`, `sessions.ip`, `consents.ip` (KVKK rıza kanıtı) ve `otp_challenges.ip` alanlarına keyfi IP yazdırılabiliyor. AUTH-01 ve AUTH-04 için önerilen IP sınırları da bu yolla atlatılıyor.
- Önerilen düzeltme: Güvenilir vekil listesi tanımlanmalı (Cloudflare aralıkları ve BFF adresi). Başlık yalnızca `request.client.host` bu listedeyse okunmalı (uvicorn `--proxy-headers --forwarded-allow-ips` ya da middleware). Değer `ipaddress.ip_address` ile doğrulanmalı. BFF istemci başlığını aktarmamalı, BFF ile backend arasında paylaşılan sır ya da iç başlık kullanılmalı. Origin yalnızca Cloudflare ve BFF'den erişilebilir olmalı. Aydınlatma metnine IP işleme amacı eklenmeli (bkz. PRIV-05).
- Birleşen ID'ler: API-03, MON-01, WEB-02, PRIV-09.
- Doğrulama: kod doğrulandı (A, B, C). Prod topolojisi doğrulanmadı.
- DURUM: AÇIK

### AUTH-06: Askıya alınan sürücü atanmış işlere ve yolcu verisine erişmeye devam ediyor

- Kategori: OWASP A01:2021; CWE-285, CWE-613.
- Önem: Orta. Kişisel veri ve yolcu güvenliği etkileniyor.
- Etkilenen yer: `backend/app/api/deps.py:85-89` (`current_driver` durum kontrolü yapmıyor), `backend/app/services/documents.py:95-114` (`set_driver_status` yalnızca `is_online=False` yapıyor; bacak ataması ve oturumlar kalıyor), `backend/app/api/driver.py:258-287,333-391` (yalnızca sahiplik kontrolü), `backend/app/api/trips.py:153-157,229-245`, `backend/app/services/dispatch.py:301-341` (`advance_trip`), `backend/app/services/auth.py:96` (`get_active_session` yalnızca `User.status`'a bakıyor).
- İstismar / etki: Şikâyet üzerine askıya alınan sürücü yarınki işin yolcu adını, ev adresini ve koordinatını görmeye devam ediyor. Konum gönderebiliyor, mesajlaşabiliyor, yolculuğu bitirip hakediş oluşturabiliyor.
- Önerilen düzeltme: İş, yolculuk, konum ve sohbet uçları için `ApprovedDriver` bağımlılığı eklenmeli (APPROVED değilse 403). Askıya alma ve reddetmede ileri tarihli ve aktif bacaklar PENDING'e dönmeli ve operasyona uyarı gitmeli. Sürücü oturumları iptal edilmeli.
- Birleşen ID'ler: yok. İlişkili: PRIV-06, RT-07, MON-10 alt maddesi.
- Doğrulama: doğrulandı (A). Mobil ekranda görünürlük doğrulanmadı.
- DURUM: AÇIK

### API-06: PayTR callback'i geçersiz imzalı her isteği gövdenin tamamıyla `payment_webhooks` tablosuna yazıyor

- Kategori: OWASP API4:2023; CWE-770, CWE-400, CWE-778.
- Önem: Orta. Kimlik gerektirmiyor, kalıcı yazma imza kontrolünden önce yapılıyor ve yükün boyut sınırı yok. Ödeme bütünlüğü etkilenmiyor (imza doğru, bkz. API-15). Uç yalnızca PayTR etkinken açık.
- Etkilenen yer: `backend/app/api/payments.py:20-29` (tüm form alanları alınıyor), `backend/app/services/payments.py:99-111` (önce `db.add(hook)`, geçersiz imzada da `db.commit()`), `backend/app/providers/payments.py:79-80` (`mask_payload` bilinmeyen alanları da kopyalıyor).
- İstismar / etki: Çok alanlı, büyük sahte gövdelerle tablo şişiriliyor ve disk doluyor. Gerçek imza saldırısı denemeleri gürültüde kayboluyor. Kaynak IP saklanmıyor, alarm yok.
- Önerilen düzeltme: Saklanacak yük bilinen PayTR alanlarıyla sınırlanmalı ve her değer kırpılmalı. Geçersiz imzada tam satır yazmak yerine sayaç ve özet log (kaynak IP ile) tutulmalı. Uca hız sınırı ve gövde boyutu sınırı konmalı. PayTR çıkış IP'leri için izin listesi değerlendirilmeli. Geçersiz imza sayısı eşiği aşınca alarm üretilmeli.
- Birleşen ID'ler: MON-05.
- Doğrulama: doğrulandı (A).
- DURUM: AÇIK

### API-07: Sürücü belge yüklemesinde boyut kontrolü gövde alındıktan sonra yapılıyor; adet ve kota yok

- Kategori: OWASP API4:2023; CWE-770, CWE-400.
- Önem: Orta. OTP ile giriş yapan herkes kendini sürücü olarak kaydedebiliyor ve onay beklemeden yükleme yapabiliyor. Disk dolması tüm uygulamayı etkiler.
- Etkilenen yer: `backend/app/api/driver.py:70-86` (kayıt onay istemiyor), `driver.py:113-139` (`file.read(MAX+1)`), `backend/app/services/documents.py:24-25,45-64` (adet ve kota yok, her yükleme bir `audit_logs` satırı), `backend/app/main.py:19-71` (gövde boyutu middleware'i yok).
- İstismar / etki: Script çok sayıda sürücü hesabı açıyor ve her hesaptan döngüde 10 MB dosya yüklüyor. `var/storage` ve geçici disk doluyor, değiştirilemez denetim tablosu şişiyor.
- Önerilen düzeltme: Vekil ya da ASGI katmanında gövde üst sınırı konmalı (yükleme ucu için ör. 11-12 MB, diğer uçlar için 1 MB). Sürücü ve araç başına adet ve toplam boyut kotası tanımlanmalı, `doc_type` başına tek bir bekleyen belge olmalı. Yükleme ucuna hız sınırı ve disk doluluk alarmı eklenmeli.
- Birleşen ID'ler: MON-06.
- Doğrulama: doğrulandı (A). Starlette'in dosyayı spool etmesi ölçülmedi.
- DURUM: AÇIK

### MON-03: Kimliksiz `POST /quotes` hız sınırı olmadan ücretli Google Routes API'yi çağırıyor

- Kategori: OWASP API4:2023; CWE-770, CWE-400 (denial of wallet).
- Önem: Orta. Etki yalnızca maliyetle sınırlı, veri etkisi yok. Google tarafında kota ve bütçe ile kısmen sınırlanabilir.
- Etkilenen yer: `backend/app/api/public.py:97-100` (sınır yok; `:109,125,132` uçlarında sınır var), `backend/app/services/quotes.py:177,183` (teklif başına bir ya da iki rota çağrısı), `backend/app/providers/routing.py:67-84,117` (süreç içi 512 kayıtlık önbellek, dolunca `clear()`, worker başına ayrı), `backend/app/services/places.py:71-83` (adres jetonu 6 saat boyunca tekrar kullanılabiliyor).
- İstismar / etki: Saldırgan N adet adres jetonuyla N² farklı çift üretip önbelleği sürekli ıskalatıyor. Önbellek temizlendiği için meşru kullanıcıların maliyeti de artıyor.
- Önerilen düzeltme: `/quotes` (ve `me/bookings` içindeki teklif hesabı) için IP başına ve küresel sınır konmalı. `places` uçlarının sınırı korunmalı. Rota önbelleği paylaşımlı Redis LRU'ya taşınmalı. Google Cloud'da günlük kota ve bütçe alarmı tanımlanmalı.
- Birleşen ID'ler: API-04.
- Doğrulama: doğrulandı (A).
- DURUM: AÇIK

### MON-08: Denetim kaydı kapsamında güvenlik olayı boşlukları; politika ile uygulama uyuşmuyor

- Kategori: OWASP A09:2021; CWE-778, CWE-223.
- Önem: Orta. `docs/yasal_ve_guvenlik.md:24` "Her erişim (admin dahil) audit_logs'a yazılır" diyor, kod bunu karşılamıyor. KVKK erişim izi ve ihlal kapsamı tespiti etkileniyor.
- Etkilenen yer: OTP isteği ve başarısız doğrulama (`backend/app/api/auth.py:80-115`, `services/otp.py:105-109`). Yenileme hatası ve yeniden kullanım (`services/auth.py:60-69`). Çıkış ve oturum iptali (`services/auth.py:80-89`). 401/403 redleri (`api/deps.py`, `main.py:36-41`). Geçersiz webhook imzası (`services/payments.py:108-111`). Admin PII okumaları: `admin/people.py:40`, `admin/operations.py:132` (bkz. PRIV-07), `admin/manual_bookings.py:106`, canlı konum `admin/operations.py:53`.
- İstismar / etki: Müşteri hesabı ele geçirme denemeleri, toplu IDOR taraması ve iç personelin PII gezintisi iz bırakmıyor.
- Önerilen düzeltme: `security.*` olay kategorisi eklenmeli: `otp.request`, `otp.verify_failed`, `auth.refresh_failed/reuse`, `auth.forbidden` (örneklenmiş), `webhook.invalid_signature`, `session.revoke`. Admin PII okuma uçları `*.view` kaydı yazmalı. Yüksek hacimli olaylar yapılandırılmış log ile merkezi toplamaya gitmeli (MON-09).
- Birleşen ID'ler: yok. İlişkili: PRIV-07 (okuma denetimi), DB-02.
- Doğrulama: doğrulandı (A).
- DURUM: AÇIK

### MON-09: Merkezi log, hata izleme ve alarm mekanizması yok

- Kategori: OWASP A09:2021; CWE-778.
- Önem: Orta. Dev aşamasında beklenen bir eksik, ama prod öncesinde zorunlu. Kaba kuvvet, SMS pompalama ve maliyet saldırıları fatura gelene kadar fark edilmez.
- Etkilenen yer: `backend/requirements.txt` (sentry ya da opentelemetry yok), `backend/app` içinde `basicConfig/dictConfig` yok, `backend/app/main.py:16` (`log` kullanılmıyor, genel exception handler yok), `backend/app/worker.py:27-41` (alarm işi yok).
- Önerilen düzeltme: Backend, worker ve Next.js için Sentry kurulmalı (AB bölgesi, PII temizliği; `docs/acik_konular.md:28`). JSON log, istek kimliği ve merkezi toplama eklenmeli. Alarmlar: personel başarısız girişi > N/5 dk, OTP istek oranı, geçersiz webhook imzası > 0, 5xx oranı, worker iş hatası, Google/Netgsm günlük bütçesi.
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (A; negatif aramalar).
- DURUM: AÇIK

### DB-01: Uygulama, migration ve CI tek bir PostgreSQL superuser hesabıyla çalışıyor; en az yetki ilkesi uygulanmıyor

- Kategori: OWASP A05:2021, A01:2021; CWE-250, CWE-269.
- Önem: **Orta** (Yüksek'ten düşürüldü, doğrulayıcı B). Kendi başına bir açık değil, ama başka bir açığın etkisini (RCE, DSN sızıntısı) superuser yetkisine büyütüyor: `COPY ... PROGRAM`, tetikleyici atlatma. Üretim rolü repoda yok, yani üretim için bir çıkarım.
- Etkilenen yer: `docker-compose.yml:6-8`, `backend/app/config.py:25`, `backend/app/db.py:10`, `backend/alembic/env.py:18-19,42-43`, `.github/workflows/ios-simulator.yml:76` (`CREATE ROLE ... SUPERUSER`), `docs/veritabani.md:83` (uygulama rolüne güncelleme ve silme yetkisi verilmeyeceği vaadi).
- Önerilen düzeltme: Üç rol tanımlanmalı. `getaway_owner` yalnızca migration için kullanılmalı (NOSUPERUSER). `getaway_app` gerekli tablolarda yalnızca CRUD yetkisi almalı, `audit_logs` üzerinde yalnızca SELECT ve INSERT. İsteğe bağlı olarak salt okunur raporlama rolü eklenmeli. `REVOKE ALL ... FROM PUBLIC` yapılmalı. Ayrı bir `GETAWAY_MIGRATION_DATABASE_URL` tanımlanmalı. Prod açılışında `rolsuper` kontrolü yapılmalı.
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (B; repo, dev ve CI). Üretim doğrulanmadı.
- DURUM: AÇIK

### DB-02: `audit_logs` değiştirilemezliği yalnızca tetikleyiciye dayanıyor; sahip veya superuser atlatabilir

- Kategori: OWASP A09:2021; CWE-693, CWE-778.
- Önem: Orta (DB-01'e bağlı). DB-01 düzelirse Düşük'e iner. "Değiştirilemez" iddiası yasal bir taahhüt (`docs/yasal_ve_guvenlik.md:24`).
- Etkilenen yer: `backend/alembic/versions/20261029_0002_audit_logs_immutable.py:19-41` (tetikleyiciler), `:44-48` (downgrade bunları düşürüyor), `backend/app/models/ops.py:44-56` (`created_at` yalnızca `server_default`, istemci ezebilir), hash zinciri yok.
- İstismar / etki: Kötü niyetli personel ya da uygulamayı ele geçiren saldırgan `DISABLE TRIGGER`, `DELETE` ve `ENABLE TRIGGER` sırasıyla izini siliyor ya da geçmiş tarihli sahte kayıt ekliyor.
- Önerilen düzeltme: DB-01'deki rol ayrımı yapılmalı, uygulama rolü tablo sahibi olmamalı. `created_at` INSERT tetikleyicisiyle `now()` değerine zorlanmalı. `prev_hash/row_hash` ile hash zinciri kurulmalı ve son özet periyodik olarak DB dışına yazılmalı. Prod'da pgaudit ya da append-only bir dış kopya kullanılmalı. Doküman ifadesi gerçek garantiye göre düzeltilmeli.
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (B). Atlatma komutları çalıştırılmadı.
- DURUM: AÇIK

### DB-04: Kesin alış ve bırakış koordinatları şifresiz; adres şifrelemesini fiilen anlamsızlaştırıyor

- Kategori: OWASP A02:2021; CWE-311, CWE-359.
- Önem: Orta. 6 ondalıklı koordinat ters coğrafi kodlamayla adresi veriyor. Koordinatlar SQL'de kullanılmıyor (`eta.py:57-64`, `route_line.py:46-52`, `dispatch.py:293`), yani şifrelemenin önünde teknik bir engel yok.
- Etkilenen yer: `backend/app/models/booking.py:124-125` (adres şifreli), `booking.py:126-129` (`Numeric(9,6)` düz).
- İstismar / etki: Bir `pg_dump` dökümünde `booking_legs` ile `bookings.customer_id` birleştirilerek müşterilerin ev adresleri ve rutinleri çıkarılabiliyor.
- Önerilen düzeltme: Koordinatlar `EncryptedString` (ya da şifreli JSON) olarak saklanmalı. Tamamlanmış bacaklarda N gün sonra koordinatlar bölge merkezine indirgenmeli. Anonimleştirmede koordinatlar silinmeli (PRIV-01).
- Birleşen ID'ler: yok. İlişkili: PRIV-03, PRIV-05, PRIV-06.
- Doğrulama: doğrulandı (B).
- DURUM: AÇIK

### BIZ-02: Yolculuk bitirmede zaman kontrolü yok, konum yalnızca istemcinin beyanı (erken ve sahte bitiş)

- Kategori: OWASP A04:2021; CWE-840, CWE-602.
- Önem: Orta. Onaylı sürücü hesabı (içeriden biri) gerekiyor. Sahte hakediş oluşuyor ve müşteri iptal/iade hakkını kaybediyor. Denetim izi var ve admin hakedişi iptal edebiliyor (K-57).
- Başlık düzeltmesi (doğrulayıcı B): "konumsuz bitirme" iddiası yanlış. FINISHED için konum zorunlu (`dispatch.py:320-321`) ve yarıçap kontrolü var (`:322-328`). Sorun, zaman ve süre kontrolünün olmaması ve konumun tamamen istemci beyanı olması.
- Etkilenen yer: `backend/app/services/dispatch.py:53-58,301-341` (yalnızca sıra kontrolü var; `pickup_at` karşılaştırması ve asgari süre yok), `backend/app/api/driver.py:349-391` (konum gövdeden ya da Redis'teki son değerden geliyor; hız ve sıçrama kontrolü yok), `backend/app/api/trips.py:143,160-184` (`approach` hedef koordinatını ve yarıçapı veriyor), `dispatch.py:469-493` (hakediş bitişte yazılıyor), `backend/app/api/admin/trip_review.py:76-104` (erken bitiş raporu yalnızca müşteri bitirişlerini kapsıyor), `mobile/lib/tracking.ts:26-31` (`coords.mocked` kontrol edilmiyor; root/jailbreak ve bütünlük tespiti yok).
- İstismar / etki: Sürücü bir hafta sonraki işi alıp dört olayı art arda gönderiyor ve FINISHED adımında `approach` ucundan aldığı varış koordinatını yolluyor. Rezervasyon COMPLETED oluyor, hakediş toplu ödemeye giriyor ve müşteriye sahte "yaklaşıyor/bitti" bildirimleri gidiyor.
- Önerilen düzeltme: DEPARTED en erken `pickup_at - X`, STARTED en erken `pickup_at - tolerans` zamanında kabul edilmeli. FINISHED için STARTED'dan sonra asgari süre aranmalı (ör. `duration_minutes * 0.5`). Son N konum örneğinde hız ve sıçrama makullük kontrolü yapılmalı. Sürücü erken bitişleri de admin raporuna girmeli. Hakediş için itiraz bekleme süresi konmalı. Mobilde `mocked` bayrağı olaya eklenip işaretlenmeli. Play Integrity / App Attest için mağaza öncesi karar verilmeli.
- Birleşen ID'ler: RT-09, MOB-08.
- Doğrulama: doğrulandı (B, C).
- DURUM: AÇIK

### BIZ-03: İade sağlayıcı çağrısı DB işlemi içinde yapılıyor ve idempotent değil; çift iade riski

- Kategori: OWASP A04:2021; CWE-362, CWE-841.
- Önem: Orta. Para kaybı ödeme tutarının tamamına kadar çıkabiliyor. Tetikleyici bir ağ zaman aşımı ya da commit hatası, kötü niyet gerekmiyor. PayTR tavan davranışı bilinmediği için Yüksek verilmedi.
- Etkilenen yer: `backend/app/services/bookings.py:502-509` ve `backend/app/providers/payments.py:156-172` (zaman aşımı FAILED yazılıyor, UNKNOWN durumu yok, idempotency referansı yok), `backend/app/api/admin/finance.py:68-80` (`retry_refund` Payment satırını kilitlemiyor), `bookings.py:421-428,488-496` (FAILED kayıtlar toplama girmiyor), `bookings.py:331-418` ve `api/customer.py:119`, `api/admin/operations.py:197` (sağlayıcı commit'ten önce çağrılıyor).
- İstismar / etki: (a) PayTR iadeyi işliyor ama yanıt zaman aşımına düşüyor, "tekrar dene" ile ikinci iade çıkıyor. (b) Eşzamanlı yapılan retry ve elle tam iade kontrolü birlikte geçiyor. (c) İade başarılı oluyor, commit başarısız oluyor ve müşteri yeniden iptal ediyor.
- Önerilen düzeltme: Outbox deseni kullanılmalı: Refund önce PENDING olarak commit edilmeli, sağlayıcı işlem dışında çağrılmalı, sonuç ayrı bir işlemle yazılmalı. Zaman aşımında UNKNOWN durumu ve mutabakat sorgusu kullanılmalı. `retry_refund` içinde `paid_payment(lock=True)` ile kalan tutar yeniden kontrol edilmeli. Benzersiz iade referansı gönderilmeli.
- Birleşen ID'ler: yok. İlişkili: BIZ-09.
- Doğrulama: kod yolu doğrulandı (B). (a) ve (b) için dinamik test gerekli: PayTR kümülatif iade tavanı ve iki eşzamanlı istekle entegrasyon testi.
- DURUM: AÇIK

### BIZ-04: Admin fiyat ezme tutarı sınırsız; aynı rol elle "nakit alındı" kaydı da girebiliyor (görev ayrılığı yok)

- Kategori: OWASP A04:2021, A01:2021; CWE-840, CWE-269.
- Önem: Orta. İçeriden kötüye kullanım ya da ele geçirilmiş bir OpsStaff oturumu gerekiyor. Denetim kaydı var.
- Etkilenen yer: `backend/app/api/admin/manual_bookings.py:195,205` (`override_total` üst sınırsız, `reference` isteğe bağlı), `manual_bookings.py:288,325-330,337-348` (oluşturma ve elle tahsilat aynı rolde), `backend/app/services/bookings.py:76-87,158-161`, `backend/app/services/dispatch.py:475` (hakediş ezilen fiyattan hesaplanıyor).
- İstismar / etki: 300 € değerindeki iş `override_total=5000` ile açılıyor ve sahte nakit tahsilatı giriliyor. Sürücü yaklaşık 3750 € hakediş alıyor. Ters yönde fiyat 0,01'e çekilebiliyor.
- Önerilen düzeltme: Ezme oranına yapılandırılabilir bir sınır konmalı (ör. %50-%150). Sınır dışı ezmeler ve elle tahsilatlar için FinanceStaff'ın ikinci onayı aranmalı. `reference` zorunlu olmalı. Ezilmiş rezervasyonun hakedişi onaya düşmeli ya da `min(system_total, override)` üzerinden hesaplanmalı.
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (B).
- DURUM: AÇIK

### PRIV-02: Konsol SMS sağlayıcısı OTP kodunu ve tam telefon numarasını WARNING seviyesinde logluyor

- Kategori: KVKK m.12, GDPR m.32; OWASP A09:2021; CWE-532, CWE-312.
- Önem: **Orta** (Yüksek'ten düşürüldü). Ön koşul bir yanlış yapılandırma. Prod'da konsol sağlayıcıyla hiç SMS gitmeyeceği için sorun kısa sürede fark edilir. Ama bu pencerede log okuyan biri hesap ele geçirebilir. CI artefaktları `backend.log` dosyasını 14 gün saklıyor.
- Etkilenen yer: `backend/app/providers/sms.py:30` (`log.warning("SMS (console) -> %s: %s", phone, text)`), `backend/app/config.py:49` (varsayılan `console`), `backend/.env.example:15`, `.github/workflows/android-emulator.yml:78,158-164`, `.github/workflows/ios-simulator.yml:88,227-233` (artefakt).
- İstismar / etki: `GETAWAY_SMS_PROVIDER` unutulursa tüm OTP'ler ve telefon numaraları log toplama sistemine düz metin gidiyor. Kod 300 sn geçerli.
- Önerilen düzeltme: Konsol sağlayıcıda telefon `mask_phone` ile maskelenmeli, OTP kodu loglanmamalı (testler `outbox` üzerinden okuyor). CI artefaktı yalnızca hata durumunda ve maskeli yüklenmeli. Validator reddi INF-02'de.
- Birleşen ID'ler: INF-14.
- Doğrulama: doğrulandı (B, C).
- DURUM: AÇIK

### PRIV-03: Sürücü tekliflerinde adres gizleniyor ama kesin koordinatlar açık

- Kategori: KVKK m.4/2-ç, GDPR m.5/1-c; CWE-359.
- Önem: **Orta** (Yüksek'ten düşürüldü). Teklif alan kişiler onaylı ve kimliği bilinen sürücüler. Sızan veri ad değil baş harf. Ancak `config.py:111` yorumu tekliflerde kırpma yapılacağını söylüyor ve bu niyet uygulanmamış.
- Etkilenen yer: `backend/app/api/driver.py:296-313` (`list_offers` adresleri `None` yapıyor), `driver.py:256-284` (`_trip_out` koordinatları kırpmadan dolduruyor), karşılaştırma için `backend/app/api/trips.py:37-55` (`JobOut` koordinat içermiyor).
- İstismar / etki: Teklifi reddeden sürücü yolcunun ev ya da otel konumunu, adının baş harfini ve saatini öğreniyor.
- Önerilen düzeltme: Teklif yanıtında koordinatlar `None` olmalı ya da `job_preview_trim_m` ile kırpılmalı (bölge merkezi yeterli).
- Birleşen ID'ler: yok.
- Doğrulama: doğrulandı (B). Mobilde bu alanların gösterilip gösterilmediği doğrulanmadı.
- DURUM: AÇIK

### PRIV-04: Mesaj önizlemesi, ilk ad ve uçuş numarası şifresiz `trip_updates` tablosuna ve FCM yüküne kopyalanıyor

- Kategori: KVKK m.12 ve m.4/2-ç, GDPR m.5/1-c, m.5/1-e, m.28; OWASP A02:2021; CWE-312, CWE-359.
- Önem: Orta. `trip_messages.body` bilinçli olarak şifreli tutuluyor ama metin düz bir sütuna ve üçüncü tarafa (Google FCM) gidiyor. Bu, `docs/yasal_ve_guvenlik.md:27`'deki "FCM'e yalnızca token" vaadini çiğniyor. Uçuş numarası K-31 ile silinen `flight_infos` dışında 30 gün daha kalıyor.
- Etkilenen yer: `backend/app/services/messages.py:92-96` (önizleme ve ilk ad), `backend/app/services/trip_updates.py:28-31,75-80,86,89-92,107,114-133` (`{text}`, `{flight}`, `{driver}`, `{plate}`; kayıt ve push), `backend/app/services/push_outbox.py:44-51,78`, `backend/app/models/booking.py:224` (şifreli) ve `:245` (`String(500)` düz), `backend/app/services/jobs.py:54` (30 gün).
- Not (doğrulayıcı B, DB-06): `trip_updates` sütununa sürücünün tam adı değil yalnızca ilk adı yazılıyor. Plaka zaten şifresiz (DB-07), yani bu yolla şifreli bir değer açığa çıkmıyor. Asıl sorun mesaj metni.
- İstismar / etki: DB yedeğine erişen biri anahtar olmadan yazışmaları okuyabiliyor. Kilitli ekranda mesaj içeriği görünüyor. Google'a serbest metin gidiyor.
- Önerilen düzeltme: `new_message` bildiriminde metin yerine sabit "Yeni mesaj" kullanılmalı ya da `body` `EncryptedString` yapılmalı. Push yükünde içerik olmamalı, istemci mesajı API'den çekmeli. Uçuş bildirimlerinde "uçuşunuz" denmeli ya da bu satırlar uçuş verisiyle birlikte silinmeli. Doküman koda göre düzeltilmeli.
- Birleşen ID'ler: RT-06, DB-06.
- Doğrulama: doğrulandı (B, C).
- DURUM: AÇIK

### PRIV-05: Saklama süresi tanımsız ve temizlik görevi olmayan tablolar ve dosyalar

- Kategori: KVKK m.4/2-d ve m.7, Kişisel Verilerin Silinmesi Yönetmeliği, GDPR m.5/1-e.
- Önem: Orta. Yönetmelik periyodik imha istiyor. IP, cihaz bilgisi, tamamlanmış yolculuk adresleri ve koordinatları ile belge dosyaları süresiz birikiyor.
- Etkilenen yer: `backend/app/worker.py:27-41`, `backend/app/services/jobs.py:43-55,137-139,151-159` (`ALL_JOBS` `purge_trip_messages`'ı içermiyor), `backend/app/providers/storage.py:45` (`storage.delete` hiçbir yerden çağrılmıyor). Temizliği olmayanlar: `sessions`, `booking_legs` adres ve koordinatları, `bookings.passenger_name/note`, `notifications`, `dispatch_offers`, `trip_events`, `payment_webhooks`, `audit_logs.ip`, `consents.ip`, `data_requests`, reddedilen ve süresi dolan belgeler. Ek not (PRIV-09'dan): aydınlatma metninde IP işleme amacı, dayanağı ve süresi yazılı değil.
- Önerilen düzeltme: Tablo bazında saklama matrisi (hukukçu teyidiyle) belirlenmeli ve `jobs.py`'ye görevler eklenmeli: süresi geçen oturumlar silinmeli, tamamlanmış bacaklar X gün sonra bölge merkezine indirgenmeli, belge dosyaları yasal süre sonunda silinmeli, `audit_logs.ip` için süre belirlenmeli (değiştirilemezlik tasarımıyla uyumlu). Worker canlılık kontrolü ve alarm eklenmeli (MON-14).
- Birleşen ID'ler: yok.
- Doğrulama: kod doğrulandı (B). Hukuki süreler doğrulanmadı.
- DURUM: AÇIK

### PRIV-06: Sürücü geçmiş yolculuklarında yolcu adı, tam adres ve koordinat süresiz erişilebilir

- Kategori: KVKK m.4/2-ç, GDPR m.5/1-c ve m.5/1-e; CWE-359.
- Önem: Orta. Karşılama bittikten sonra bu veriye ihtiyaç yok. Anonimleştirilmiş müşteri için de görünür kalıyor.
- Etkilenen yer: `backend/app/api/driver.py:333-338` (`list_trips(include_past=True)`), `driver.py:341-346` (`get_trip`).
- İstismar / etki: Sürücü hesabı ele geçirilirse geçmiş tüm müşterilerin ad, adres ve saat listesi sızıyor. Ayrılan sürücü bu veriyi saklayabiliyor.
- Önerilen düzeltme: COMPLETED ve CANCELLED bacaklarda ad baş harfe indirilmeli, adres ve koordinatlar `None` olmalı.
- Birleşen ID'ler: yok. İlişkili: AUTH-06, DB-04.
- Doğrulama: doğrulandı (B).
- DURUM: AÇIK

### PRIV-07: Admin rezervasyon detayında yolcu adı, not ve adresler tam dönüyor; okuma denetime yazılmıyor

- Kategori: KVKK m.12/1, GDPR m.5/1-f ve m.32; CWE-359.
- Önem: Orta. Destek rolü dahil tüm personel erişebiliyor. Yolcu adı çoğunlukla müşteri adıyla aynı, bu yüzden müşteri adı maskelemesi etkisiz kalıyor.
- Etkilenen yer: `backend/app/api/admin/operations.py:132-148` (`customer_name` maskeli, `audit.record` yok), `backend/app/api/schemas.py:245-266` (`BookingOut.build` `passenger_name` ve `note` alanlarını tam döndürüyor), `backend/app/api/deps.py:115`.
- Önerilen düzeltme: PII içeren detay uçlarına okuma denetimi eklenmeli. Destek rolü için yolcu adı maskelenmeli ya da tam gösterim bilinçli bir karar olarak dokümante edilmeli.
- Birleşen ID'ler: yok. Okuma denetimi kısmı MON-08 ile ortak.
- Doğrulama: doğrulandı (B).
- DURUM: AÇIK

### WEB-01: BFF yol izin listesi kodlanmış `..` ve `%2F` ile atlatılıyor (web ve admin)

- Kategori: OWASP A01:2021, A10:2021 (sınırlı); CWE-22, CWE-180, CWE-863.
- Önem: **Orta** (yönetici kararı; doğrulayıcı C Düşük önerdi). Doğrulama kanonikleştirmeden önce yapılıyor ve savunma katmanı atlatılıyor. Backend rol denetimi çalışmaya devam ediyor.
- Çürütülen alt senaryo: Bulgudaki "jetonlar JS'e döner" senaryosu geçerli değil. `auth/otp/verify` yeni bir OTP kodu, `auth/staff/2fa` MFA jetonu ve TOTP istiyor; `auth/refresh` httpOnly çerezdeki RT'yi istiyor. XSS bunlara sahip değil.
- Etkilenen yer: `web/app/bff/[...path]/route.ts:14-23,76,98,103-104`, `admin/app/bff/[...path]/route.ts:13,59,88-89`, `web/middleware.ts:8` (`bff` hariç tutuluyor). Next 15.5.28 `route-matcher.js:18-36` (`split('/').map(decodeURIComponent)`), `resolve-routes.js:94` (eski `url.parse`, `%2e%2e` normalize edilmiyor).
- İstismar / etki: `/bff/me/..%2Fdriver%2Fme` isteği upstream'de `/api/v1/driver/me` olarak gidiyor. `/bff/places/..%2F..%2Fadmin%2Fusers` önek dışına çıkıyor. `x%3Fa%3D1` sorgu dizgisi enjekte ediyor. İzin listesi dışındaki uçlara müşteri çereziyle ulaşılıyor. Upstream `content-type` taşındığı için backend HTML'i web kökeninde çizilebiliyor.
- Önerilen düzeltme: Segmentler birleştirilmeden önce `.`, `..`, `/`, `\`, `?`, `#`, `%` ya da kontrol karakteri içeren segmentler 400 ile reddedilmeli. Segmentler `encodeURIComponent` ile yeniden kodlanmalı. Upstream URL `new URL()` ile kurulmalı ve kanonik `pathname` izin listesine göre yeniden kontrol edilmeli.
- Birleşen ID'ler: API-13.
- Doğrulama: dinamik test gerekli. Eşleyici simülasyonu ve Next kaynağı doğrulandı (A, C). `next start` ile `curl --path-as-is` denenmeli: 403 backend yanıtı atlatmayı, 404/400 BFF yanıtı korumayı gösterir.
- DURUM: AÇIK

### RT-03: WebSocket jetonu yalnızca bağlantı başında doğrulanıyor; oturum iptali ve jeton süresi akışı kesmiyor

- Kategori: OWASP A07:2021, A01:2021; CWE-613.
- Önem: Orta. Kimlik ve kesin konum kesişiyor. Erişim jetonunun 30 dakikalık ömrü fiilen sınırsız hale geliyor.
- Etkilenen yer: `backend/app/api/customer.py:270-286` (kimlik `:274-276`'da bir kez kontrol ediliyor; döngü `:278-282` yalnızca `db.get(Booking)` yapıyor ve çıkış koşulu yok; `:285-286` istisnayı loglamadan 4401 ile kapatıyor).
- İstismar / etki: Çalınan cihazdaki oturum iptal edilse de açık WebSocket sonraki bacaklarda da sürücü konumunu almaya devam ediyor. Çıkış, pasifleştirme ve anonimleştirme bağlantıyı kesmiyor.
- Önerilen düzeltme: Her ~30 sn'de `get_active_session` ve `exp` yeniden kontrol edilmeli, süre dolunca 4401 ile kapatılmalı. Tüm bacaklar terminal duruma geçince bağlantı kapatılmalı. Mutlak bağlantı ömrü konmalı ve istisnalar loglanmalı.
- Birleşen ID'ler: AUTH-09, MON-07 (oturum ve sessiz hata kısımları).
- Doğrulama: doğrulandı (A, C).
- DURUM: AÇIK

### RT-04: WebSocket döngüsü async içinde senkron DB ve Redis çağrıları yapıyor; Redis istemcisinde zaman aşımı yok

- Kategori: OWASP A04:2021; CWE-400, CWE-1088.
- Önem: Orta. Tek bir uvicorn sürecinde tüm HTTP isteklerini etkileyen bir kullanılabilirlik riski. Kimliği doğrulanmış bir müşteri hesabı yeterli. Etki büyüklüğü ölçülmedi.
- Etkilenen yer: `backend/app/api/customer.py:268,273-281` (senkron `SessionLocal` ve `live_location.for_booking`), `backend/app/services/live_location.py:24-26,46` (`socket_timeout` yok; karşılaştırma için `eta.py:44-45`), HTTP uçlarında `RedisError` 500 dönüyor (`customer.py:137`, `trips.py:300`, `admin/operations.py:53`).
- İstismar / etki: Yüzlerce WebSocket bağlantısı olay döngüsünü sürekli bloke ediyor. Redis gecikirse API tamamen yanıtsız kalıyor.
- Önerilen düzeltme: Çağrılar `asyncio.to_thread` ya da `run_in_threadpool` ile taşınmalı veya `redis.asyncio` kullanılmalı. `socket_connect_timeout` ve `socket_timeout` ayarlanmalı, `RedisError` yakalanmalı. Her tikte yalnızca önbellekteki `leg_id` ile Redis okunmalı.
- Birleşen ID'ler: MON-07 (senkron DB kısmı).
- Doğrulama: doğrulandı (A, C; kod). Yük altındaki etki ölçülmedi.
- DURUM: AÇIK

### INF-02: Prod validator kapsam boşlukları (SMS, PayTR test modu ve boş anahtar, DB/Redis kimlik bilgisi ve TLS, CORS, URL, anahtar uzunluğu)

- Kategori: OWASP A05:2021; CWE-1188, CWE-16, CWE-319.
- Önem: Orta. `env=prod` doğru verilse bile aşağıdaki dev varsayılanları açılışta reddedilmiyor.
- Etkilenen yer (`backend/app/config.py` ve ilgili yerler):
  - `:49` `sms_provider="console"` reddedilmiyor (log etkisi PRIV-02'de).
  - `:95` `paytr_test_mode=True` reddedilmiyor (test modunda canlı işlem; PayTR davranışı doğrulanmadı).
  - `:92-94` PayTR merchant id, key ve salt alanları boş olabiliyor. `providers/payments.py:109,144-145` boş anahtar ve tuzla HMAC hesaplıyor, saldırgan aynı imzayı üretebilir. Kod doğrulandı. Boş anahtarla ödeme başlatılamayacağı için fark edilme olasılığı yüksek.
  - `:25` `database_url` dev kimlik bilgisiyle kabul ediliyor ve `sslmode` denetlenmiyor (`db.py:10`'da `connect_args` yok).
  - `:26` `redis_url` parolasız ve TLS'siz kabul ediliyor (RT-01 zincirinin prod tarafı).
  - `:28-33` `cors_origins` localhost/http varsayılanında, `:96` `public_web_url=http://localhost:3000` kontrol edilmiyor.
  - `jwt_secret` ve `blind_index_key` için uzunluk ve entropi alt sınırı yok.
  - Not: `push_provider=console` prod'da zaten reddediliyor (`config.py:129-130`).
- Önerilen düzeltme: Prod (ve ileride eklenecek stage) dalına şu redler eklenmeli: `sms_provider == "console"`, `paytr_test_mode`, PayTR seçiliyken boş merchant alanları, dev `database_url` ve `sslmode` eksikliği (`verify-full`, en az `require`), parolasız ya da `rediss://` olmayan `redis_url`, `https://` olmayan CORS ve `public_web_url`, 32 bayttan kısa anahtarlar. Her kural için açılmama testi yazılmalı.
- Birleşen ID'ler: RT-02, DB-11.
- Doğrulama: doğrulandı (B, C).
- DURUM: AÇIK

### EXT-01: Hakediş CSV dışa aktarımında formül enjeksiyonu

- Kategori: OWASP A03:2021 Injection; CWE-1236 (CSV Injection).
- Önem: Orta. Sürücü kayıt sırasında `full_name` alanını serbestçe giriyor (onay gerekmiyor). Muhasebe bilgisayarında Excel formülü çalışabilir ve finans verisine ya da makineye etki edebilir. Kullanıcı etkileşimi (dosyayı açma, uyarıyı onaylama) gerektiği için Yüksek verilmedi.
- Etkilenen yer: `backend/app/api/admin/finance.py:168-171` (`/admin/payouts/export.csv`, `csv.writer` kaçışlama yapmıyor), `backend/app/api/driver.py:47,80` (`full_name` girişi).
- İstismar / etki: Sürücü adını `=`, `+`, `-` ya da `@` ile başlatıyor. Dışa aktarılan CSV açıldığında formül çalışıyor (veri sızdırma bağlantısı, DDE).
- Önerilen düzeltme: Bu karakterlerle (ayrıca sekme ve CR ile) başlayan hücrelerin başına `'` eklenmeli. İstenirse `full_name` girişinde karakter kısıtı uygulanmalı.
- Birleşen ID'ler: yok (AUTH kapsam dışı gözleminden sahiplenildi).
- Doğrulama: doğrulanmadı.
- DURUM: AÇIK

---

## Düşük

### AUTH-07: TOTP kodu ve MFA ara jetonu tekrar kullanılabiliyor
- Kategori: OWASP A07:2021; CWE-294. Önem: Düşük. Saldırganın trafiği ya da ekranı gözlemlemesi gerekiyor.
- Etkilenen yer: `backend/app/services/auth.py:265-288` (`verify(valid_window=1)` son adımı kaydetmiyor), `backend/app/security/tokens.py:44-53`.
- İstismar / etki: Aynı jeton ve kodla yaklaşık 90 sn içinde ikinci bir oturum açılabiliyor.
- Önerilen düzeltme: `users.totp_last_step` alanı eklenmeli. MFA jetonuna `jti` eklenip tek kullanımlık yapılmalı (AUTH-01 ile ortak).
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### AUTH-08: Yenileme jetonunda yeniden kullanım tespiti yok; personel oturumu 30 gün ve boşta kalma süresi yok
- Kategori: OWASP A07:2021; CWE-613, CWE-384, CWE-778. Önem: Düşük. Jetonu çalmak için ayrı bir açık gerekiyor.
- Etkilenen yer: `backend/app/services/auth.py:60-77`, `backend/app/config.py:37`, `admin/app/bff/[...path]/route.ts:10-11` (çerez 12 saat).
- İstismar / etki: Çalınan RT meşru kullanıcıdan önce kullanılırsa saldırgan oturumu sürdürüyor. Ne kayıt ne alarm oluşuyor.
- Önerilen düzeltme: `previous_refresh_hash` saklanmalı. Eski jeton gelirse oturum ailesi iptal edilmeli, `security.refresh_reuse` kaydı ve alarm üretilmeli. Personel için 12 saatlik mutlak ömür ve boşta kalma süresi konmalı.
- Birleşen ID'ler: MON-11. Doğrulama: doğrulandı (A). DURUM: AÇIK

### API-08: Sınırsız başlık değerleri sabit uzunluklu kolonlara yazılıyor ve 500 hatası üretiyor
- Kategori: API8:2023; CWE-20, CWE-755. Önem: Düşük. Saldırgan yalnızca kendi isteğini bozuyor, ama IP alanı kirleniyor.
- Etkilenen yer: `backend/app/api/auth.py:99,167` (UA sınırsız), `models/identity.py:69-70,90`, `models/ops.py:54`, `api/deps.py:30`, `alembic/versions/20261029_0001_initial_schema.py:98,183,266-267,356`.
- Önerilen düzeltme: `device_info[:255]` ile kırpılmalı, IP `ipaddress.ip_address` ile doğrulanmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### API-09: Bazı kimliksiz girdi alanları sınırsız ya da aralıksız
- Kategori: API4/API8:2023; CWE-20, CWE-1284. Önem: Düşük. Doğrudan istismar yok, uç değerler 500 üretebiliyor.
- Etkilenen yer: `backend/app/api/auth.py:23,36,47,62`, `backend/app/api/schemas.py:32,108-110,113,167,171`, `api/driver.py:158`, `services/quotes.py:180` (`OverflowError`), `admin/catalog.py:342`.
- Önerilen düzeltme: Jeton alanlarına `max_length`, kod alanlarına desen konmalı. `pickup_at` şu an ile +2 yıl (ya da 365 gün) arasında olmalı. `expected_total` için `ge=0, max_digits=12` kullanılmalı. Ayarlar için anahtar başına aralık doğrulaması eklenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### API-10: PayTR hata ayrıntısı (`reason`) müşteriye aktarılıyor
- Kategori: API8:2023; CWE-209. Önem: Düşük. Mağaza yapılandırması hakkında ipucu veriyor.
- Etkilenen yer: `backend/app/providers/payments.py:137`, `backend/app/main.py:36-41`.
- Önerilen düzeltme: İstemciye genel bir mesaj dönülmeli, `reason` loga ve `payments.failure_reason` alanına yazılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### API-11: Saldırgan kontrolündeki `merchant_oid` doğrudan loga yazılıyor (log enjeksiyonu)
- Kategori: A09:2021; CWE-117. Önem: Düşük.
- Etkilenen yer: `backend/app/services/payments.py:110`.
- Önerilen düzeltme: Değer `repr()` ile ya da CR/LF temizlenip kırpılarak loglanmalı. JSON log kullanılmalı (MON-09).
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### MON-10: Olay müdahale hazırlığı eksik: runbook yok, toplu oturum düşürme yok, anahtar rotasyonu ve `kid` yok
- Kategori: A09:2021; CWE-320, CWE-613. Önem: **Düşük** (Orta'dan düşürüldü). Doğrudan istismar yolu yok, süreç ve hazırlık eksikliği.
- Etkilenen yer: `docs/` altında olay müdahale dokümanı yok (`docs/yasal_ve_guvenlik.md:28`), `backend/app/cli.py:20-27` (`revoke-sessions` yok), `backend/app/security/tokens.py:41,58` (tek anahtar, `kid` yok), `services/places.py:83,88` ve `providers/payments.py:224` (aynı `jwt_secret`), `security/crypto.py:47-49` (sürümsüz blind index, bkz. DB-09), Fernet yeniden şifreleme aracı yok.
- Önerilen düzeltme: `docs/olay_mudahale.md` yazılmalı (roller, KVKK 72 saat bildirimi, secret başına rotasyon adımları). `revoke-sessions --all|--kind|--user` CLI'si eklenmeli. Amaca göre anahtar ayrımı yapılmalı (access, mfa, place, fake) ve `kid` ile çoklu doğrulama anahtarı desteklenmeli. Blind index sürüm alanı ve yeniden indeksleme komutu eklenmeli. Fernet yeniden şifreleme komutu yazılmalı.
- Birleşen ID'ler: yok. Alt maddeleri AUTH-06, RT-03, INF-01 ve DB-09 ile örtüşüyor. Doğrulama: doğrulandı (A). DURUM: AÇIK

### MON-12: Sürücü `approach` ucu her çağrıda keyfi koordinatla ücretli Routes API'yi çağırıyor
- Kategori: API4:2023; CWE-770. Önem: Düşük.
- Düzeltme (doğrulayıcı A): "onaylı sürücü gerekir" ifadesi yanlış. `CurrentDriver` onay kontrolü yapmıyor (AUTH-06) ve bacak durumu da kontrol edilmiyor. Değişken koordinatlar paylaşılan rota önbelleğini de temizletebilir.
- Etkilenen yer: `backend/app/api/trips.py:160-184`, `providers/routing.py:73`.
- Önerilen düzeltme: Sürücü başına sınır konmalı (ör. 6/dk), aktif bacak şartı aranmalı, koordinat yuvarlanmalı ve kısa süreli Redis önbelleği kullanılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### MON-13: Sayfalamada offset üst sınırı yok, bazı liste uçları sınırsız
- Kategori: API4:2023; CWE-400. Önem: Düşük. Uçlar kimlikli.
- Etkilenen yer: `backend/app/api/admin/common.py:15-16`, `admin/operations.py:234-241,282-285` (doğrulandı), listenin geri kalanı (`fleet.py:178`, `trips.py:105-112` vb.) tek tek okunmadı. N+1 sorgular: `admin/fleet.py:100`, `trips.py:62-73`.
- Önerilen düzeltme: `offset <= 10000` ya da cursor sayfalama kullanılmalı. Sınırsız uçlara sabit limit konmalı, N+1 için `selectinload` kullanılmalı.
- Birleşen ID'ler: yok. Doğrulama: kısmen doğrulandı (A). DURUM: AÇIK

### MON-14: Worker cron grupları tek bir hatayla kesiliyor, iş hatası için alarm yok
- Kategori: CWE-755, CWE-778. Önem: Düşük. KVKK temizlik işleri atlanabiliyor.
- Düzeltme (doğrulayıcı A): `refresh_flights` örneği yanlış. Doğru örnek: `purge_flight_data` hata verirse OTP ve mesaj temizliği atlanıyor (`worker.py:34-36`).
- Etkilenen yer: `backend/app/worker.py:18-41`, `services/jobs.py:63-65`.
- Önerilen düzeltme: Her iş ayrı try/except içinde çalışmalı, hatalar Sentry'ye gitmeli, "son başarılı çalışma" metriği ve alarm eklenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (A). DURUM: AÇIK

### DB-03: Test fikstürü ortamdan gelen herhangi bir veritabanında `alembic downgrade base` çalıştırıyor
- Kategori: A05:2021; CWE-1188. Önem: **Düşük** (Orta'dan düşürüldü). Saldırgan senaryosu yok, kaza riski var: geri alınamaz veri kaybı.
- Etkilenen yer: `backend/tests/conftest.py:14-16` (`setdefault`), `:54-61`.
- Önerilen düzeltme: DB adı `_test` ile bitmiyorsa ya da host localhost değilse `pytest.exit` çağrılmalı. Yalnızca `GETAWAY_TEST_DATABASE_URL` okunmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### DB-07: Diğer şifresiz kişisel ve hassas alanlar; audit maskelemesinde `reason` ve `reference` eksik
- Kategori: A02:2021; CWE-312. Önem: Düşük.
- Etkilenen yer: IP alanları (`identity.py:70,90`, `customer.py:56`, `ops.py:54`), `sessions.device_info`, `push_token` (`customer.py:39`, `fleet.py:41`), `vehicles.plate` (`fleet.py:63`), serbest metinler (`customer.py:70`, `fleet.py:35,115`, `booking.py:77,90`, `finance.py:47,78`), `services/audit.py:15-33` (`SENSITIVE_KEYS` içinde `reason` ve `reference` yok; bunları yazan yerler: `bookings.py:459,482`, `trip_review.py:53`, `documents.py:114`, `payments.py:205`).
- Önerilen düzeltme: Serbest metinler `EncryptedString` yapılmalı. `reason` ve `reference` maskelenmeli ya da yalnızca var/yok bilgisi yazılmalı. Plaka için `plate_hash` ile şifreli değer kullanılmalı. IP'ler 90 gün sonra /24'e maskelenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### DB-08: Fernet şifreli metin satıra ve sütuna bağlı değil (ciphertext yer değiştirme)
- Kategori: A02:2021; CWE-649, CWE-345. Önem: Düşük. DB yazma yetkisi gerekiyor.
- Etkilenen yer: `backend/app/security/crypto.py:25-36,80-99`, `api/admin/finance.py:168-170` (IBAN dışa aktarımı).
- İstismar / etki: Saldırgan kendi IBAN şifreli metnini başka bir sürücünün satırına kopyalıyor ve hakediş dosyası saldırganın IBAN'ını gösteriyor.
- Önerilen düzeltme: IBAN, 2FA sırrı ve belge yolu için `table:column:row_id` AAD ile AES-GCM kullanılmalı. IBAN değişikliği denetlenmeli ve ödeme öncesi uyarı gösterilmeli.
- Birleşen ID'ler: yok. Doğrulama: mekanizma doğrulandı (B). İstismar çalıştırılmadı. DURUM: AÇIK

### DB-09: Blind index anahtarı OTP HMAC ile paylaşılıyor; alan ayrımı ve rotasyon yok
- Kategori: A02:2021; CWE-323, CWE-320. Önem: Düşük.
- Etkilenen yer: `backend/app/security/crypto.py:47-49`, `services/otp.py:38-40`, `services/auth.py:108,174`.
- Önerilen düzeltme: HKDF ile amaç başına alt anahtar ya da alan öneki kullanılmalı. `phone_hash_v` sürüm alanı ile rotasyon planı yapılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### DB-10: Yerel geliştirmede PostgreSQL tüm arayüzlere superuser hesabıyla açık; backend `0.0.0.0` üzerinde dinliyor
- Kategori: A05:2021; CWE-1327, CWE-798, CWE-521. Önem: Düşük (yalnızca geliştirme).
- Etkilenen yer: `docker-compose.yml:6-10` (`"5432:5432"`, dev kimlik bilgisi; değer yazılmadı), `backend/app/config.py:15` (repodaki dev Fernet anahtarı), `.vscode/tasks.json:42-43` (`uvicorn --host 0.0.0.0`; LAN'daki biri dev modda `/docs` ve `dev_code` ile test hesaplarına girebilir).
- Önerilen düzeltme: `"127.0.0.1:5432:5432"` ve `${POSTGRES_PASSWORD:?}` kullanılmalı. Uvicorn görevi `--host 127.0.0.1` ile çalışmalı, fiziksel cihaz testi için ayrı bir görev tanımlanmalı.
- Birleşen ID'ler: INF-10 (Postgres ve `0.0.0.0` kısımları). Doğrulama: doğrulandı (B, C). İşletim sistemi güvenlik duvarı etkisi doğrulanmadı. DURUM: AÇIK

### BIZ-05: Bölge seçiminde fiyat ilçe merkezinden hesaplanıyor, gerçek adres serbest metin
- Kategori: A04:2021; CWE-840. Önem: Düşük. Bilinçli bir tasarım (`docs/fiyatlandirma.md:30`).
- Etkilenen yer: `backend/app/api/public.py:56`, `services/quotes.py:126-129`, `services/dispatch.py:291-294`.
- Önerilen düzeltme: Serbest adres girildiyse sürücüye "konum doğrulanmadı" uyarısı gösterilmeli ya da serbest adres yalnızca jetonlu seçimde kabul edilmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### BIZ-06: Para birimini istemci seçiyor (`country_code`); kur arbitrajı mümkün
- Kategori: A04:2021; CWE-840. Önem: Düşük (Bilgi'ye yakın).
- Etkilenen yer: `backend/app/api/schemas.py:109,113`, `currency.py:19-23`, `services/quotes.py:200-205`, `api/customer.py:64-66`, `services/bookings.py:163-171`.
- Önerilen düzeltme: Para birimi profil ülkesine bağlanmalı. `pickup_at` için azami ileri tarih konmalı (API-09 ile ortak).
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### BIZ-07: Ödeme bildiriminde para birimi doğrulanmıyor; `total_amount` eksikse tutar kontrolü atlanıyor
- Kategori: A08:2021; CWE-345. Önem: Düşük. Alanlar PayTR imzası kapsamında.
- Etkilenen yer: `backend/app/services/payments.py:129`, `providers/payments.py:150`.
- Önerilen düzeltme: `total_amount is None` ise ödeme reddedilmeli. `currency` alanı `payment.currency` ile karşılaştırılmalı.
- Birleşen ID'ler: yok (API-15 notu ile örtüşüyor). Doğrulama: doğrulandı (A, B). DURUM: AÇIK

### BIZ-08: `accept_job` ile `accept_offer` kilit sırası ters; deadlock olasılığı
- Kategori: A04:2021; CWE-833. Önem: Düşük. Veri bütünlüğü bozulmuyor, kullanıcı 500 alıyor.
- Etkilenen yer: `backend/app/services/dispatch.py:198-205,226-236,432-451`.
- Önerilen düzeltme: Tek bir kilit sırası (önce bacak, sonra teklifler) uygulanmalı. Deadlock hatası 409 olarak dönmeli.
- Birleşen ID'ler: yok. Doğrulama: kilit sırası doğrulandı (B). Dinamik test gerekli (iki eşzamanlı istek). DURUM: AÇIK

### BIZ-09: Ödeme sayfası yeniden kullanım penceresi (25 dk) PayTR sayfa ömründen (30 dk) kısa
- Kategori: A04:2021; CWE-362. Önem: Düşük. İkinci ödeme otomatik iade ediliyor. İade başarısız olursa BIZ-03 ile birleşiyor.
- Etkilenen yer: `backend/app/services/payments.py:31,34-47,140-147`, `providers/payments.py:126`.
- Önerilen düzeltme: Pencere PayTR `timeout_limit` değerinden uzun tutulmalı (ör. 31 dk) ya da yeni sayfa açılırken eskisi geçersiz sayılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### PRIV-08: Netgsm entegrasyonu kimlik bilgisini, telefonu ve OTP metnini GET sorgu dizgisinde gönderiyor
- Kategori: CWE-598, CWE-532; KVKK m.12. Önem: **Düşük** (Orta'dan düşürüldü).
- Çürütülen kısım (doğrulayıcı B): `notifications.py:99` traceback'inin URL içerdiği iddiası büyük olasılıkla yanlış. Kalan risk, httpx INFO loglarının açılması ve TLS sonlandıran bir çıkış vekili.
- Etkilenen yer: `backend/app/providers/sms.py:43-55`, `services/notifications.py:98-99`.
- Önerilen düzeltme: Netgsm'in POST/XML ya da Basic Auth REST API'sine geçilmeli. SMS hata logları URL'siz olmalı.
- Birleşen ID'ler: yok. Doğrulama: GET kullanımı doğrulandı (B). DURUM: AÇIK

### PRIV-10: Uçuş verisi silme (K-31) iptal edilen yolculuklarda 48 saat sürüyor; kopyalar kapsam dışı
- Kategori: KVKK m.7, GDPR m.5/1-e. Önem: Düşük.
- Etkilenen yer: `backend/app/services/dispatch.py:469-474`, `services/bookings.py:53,244`, docstring'ler hâlâ "24 saat" diyor (`models/booking.py:150`, `services/jobs.py:44`), kopyalar `trip_updates.title` ve `flight_tracking.py:177,180`.
- Önerilen düzeltme: İptal anında `purge_at = now` atanmalı, docstring'ler düzeltilmeli, kopyalar PRIV-04 ile kapatılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### PRIV-12: Konsol push sağlayıcısı jeton önekini, ilk adı ve mesaj metnini logluyor
- Kategori: CWE-532. Önem: Düşük. Yalnızca dev ve CI'da geçerli, çünkü prod'da `console` reddediliyor.
- Etkilenen yer: `backend/app/providers/push.py:51`, CI artefaktları (PRIV-02 ile ilişkili).
- Önerilen düzeltme: Gövde loglanmamalı ya da kısaltılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### PRIV-13: Veri talebi notu düz metin ve personel notu müşteri notunun üzerine yazılıyor; uçuş takip logları uçuş numarası içeriyor
- Kategori: KVKK m.12; CWE-312. Önem: Düşük.
- Etkilenen yer: `backend/app/models/customer.py:70`, `api/admin/people.py:84-85`, `services/flight_tracking.py:177,180`.
- Önerilen düzeltme: Not alanı `EncryptedString` yapılmalı ve müşteri notu ile personel notu ayrı alanlarda tutulmalı. Loglarda uçuş numarası maskelenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (B). DURUM: AÇIK

### WEB-04: CSP `script-src 'unsafe-inline'` (web ve admin)
- Kategori: A05:2021; CWE-1021, CWE-79 (savunma katmanı). Önem: Düşük. Doğrudan XSS bulunmadı.
- Etkilenen yer: `web/next.config.ts:19`, `admin/next.config.ts:14`.
- Önerilen düzeltme: Middleware'de istek başına nonce üretilmeli ve `'nonce-...' 'strict-dynamic'` kullanılmalı. Öncelik admin olmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### WEB-05: HSTS hiçbir katmanda yok
- Kategori: A02/A05:2021; CWE-319, CWE-523. Önem: Düşük. CDN tarafında açık olup olmadığı bilinmiyor.
- Etkilenen yer: `web/next.config.ts:9-32`, `admin/next.config.ts:3-24`, `backend/app/main.py:51-58`.
- Önerilen düzeltme: Prod'da `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` eklenmeli ya da CDN'de açık olduğu belgelenmeli.
- Birleşen ID'ler: yok. Doğrulama: repo tarafı doğrulandı (C). DURUM: AÇIK

### WEB-06: Admin `[id]` rota parametreleri doğrulanmadan BFF yoluna ekleniyor (CSPT)
- Kategori: A01:2021; CWE-22 (istemci tarafı). Önem: Düşük. Personelin hazırlanmış bir bağlantıyı açıp işlem düğmesine basması gerekiyor.
- Etkilenen yer: `admin/app/(panel)/bookings/[id]/page.tsx:108-110,132,147`, `admin/app/(panel)/drivers/[id]/page.tsx:28-29,37`.
- Önerilen düzeltme: UUID regex'i uymazsa `notFound()` dönülmeli. Parçalar `encodeURIComponent` ile kodlanmalı (WEB-01 ikinci katman).
- Birleşen ID'ler: yok (MOB-02 ile aynı sınıf). Doğrulama: dinamik test gerekli. DURUM: AÇIK

### MOB-01: Çıkış yapıldığında arka plan konum görevi durdurulmuyor
- Kategori: MASVS-PRIVACY-1; CWE-359, CWE-672. Önem: **Düşük** (Orta'dan düşürüldü). Oturum olmadığı için konum cihazdan çıkmıyor (401). Mağaza öncesi kapatılmalı.
- Etkilenen yer: `mobile/lib/session.tsx:38-47`, `mobile/app/(driver)/home.tsx:369-372`, `mobile/lib/tracking.ts:21-40,63`.
- Önerilen düzeltme: `signOut` içinde `stopBackgroundTracking` ve `endLiveTrip` çağrılmalı. Görev 401/403 ya da oturum yokken durmalı. Yerel anahtarlar silinmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### MOB-02: Derin bağlantıdan gelen rota parametreleri API yoluna kodlanmadan ekleniyor
- Kategori: MASVS-PLATFORM-1, MASVS-CODE-4; CWE-20, CWE-22. Önem: **Düşük** (Orta'dan düşürüldü). Kullanıcı kendi yetkisinin dışına çıkamıyor.
- Etkilenen yer: `mobile/app/booking/[code].tsx:52,62,66,78,88-94,118,140,150,160,179`, `mobile/app/chat/[id].tsx:36,42,72`, `mobile/app/trip/[legId].tsx:77,114,143,190,201,233`, `mobile/app/job/[legId].tsx:42,65,78`, `mobile/app.config.ts:108`.
- Önerilen düzeltme: Biçim doğrulaması yapılmalı (kod regex'i, UUID). Parametreler `encodeURIComponent` ile kodlanmalı. Derin bağlantıdan gelen `pay=1` yok sayılmalı.
- Birleşen ID'ler: yok. Doğrulama: dinamik test gerekli (expo-router `%2F` çözümü ve RN `fetch` normalizasyonu cihazda denenmeli). DURUM: AÇIK

### MOB-03: Sertifika sabitleme (certificate pinning) yok
- Kategori: MASVS-NETWORK-2; CWE-295. Önem: Düşük.
- Etkilenen yer: `mobile/lib/api.ts:53,79,116-118`.
- Önerilen düzeltme: Mağaza öncesi karar verilmeli (`network_security_config` pin-set, `NSPinnedDomains`). Pin rotasyon planı olmadan uygulanmamalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C; negatif arama). DURUM: AÇIK

### MOB-04: API adresinin HTTPS olduğu derleme zamanında zorlanmıyor
- Kategori: MASVS-NETWORK-1; CWE-319. Önem: Düşük.
- Etkilenen yer: `mobile/app.config.ts:9,11,46-52,182`, `mobile/lib/config.ts:7`, `mobile/eas.json:10`.
- Önerilen düzeltme: `production*` ve `preview*` profillerinde `https://` dışındaki adresler ve cleartext bayrağı `app.config.ts`'de hata vermeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### MOB-05: Google Maps SDK anahtarları pakete gömülü; kısıtlamalar repodan doğrulanamıyor
- Kategori: MASVS-STORAGE-1; CWE-798 (yalnızca kısıtlamasızsa). Önem: Düşük.
- Etkilenen yer: `mobile/app.config.ts:16,22,59,81,142`, `mobile/.env.example:8`, CI `android-emulator.yml:109`, `ios-simulator.yml:112`.
- Önerilen düzeltme: Konsolda uygulama kısıtlaması, API kısıtlaması ve bütçe uyarısı tanımlanmalı ve `docs/kararlar.md`'ye kaydedilmeli.
- Birleşen ID'ler: yok. Doğrulama: gömülme doğrulandı (C). Kısıtlamalar doğrulanmadı (Google Cloud konsolunda kontrol gerekli). DURUM: AÇIK

### MOB-06: Yalnızca özel URL şeması var; App Links ve Universal Links yok
- Kategori: MASVS-PLATFORM-1; CWE-939. Önem: Düşük.
- Etkilenen yer: `mobile/app.config.ts:108`, `mobile/app/booking/[code].tsx:105`.
- Önerilen düzeltme: Mağaza öncesi `autoVerify` + `assetlinks.json` ve `associatedDomains` + AASA kurulmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### MOB-07: Çıkışta ağ hatası yutuluyor; sunucu oturumu ve push jetonu kalıyor
- Kategori: MASVS-AUTH-1; CWE-613. Önem: Düşük. Backend yeni girişte jetonu aynı türdeki önceki hesaptan siliyor (`notifications.py:113-122`). Kalan pencere cihaz devri ile yeni giriş arasındaki süre ve müşteri/sürücü tabloları arası geçiş.
- Etkilenen yer: `mobile/lib/session.tsx:41-43`, `mobile/lib/notify.ts:71-78`.
- Önerilen düzeltme: Başarısız logout güvenli depoda kuyruklanmalı ve yeniden denenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### RT-05: WebSocket bağlantı sayısı, süresi ve kimlik öncesi bağlantı için sınır yok
- Kategori: A04:2021; CWE-770. Önem: Düşük. Asıl yük RT-04 ile birleşince anlam kazanıyor.
- Etkilenen yer: `backend/app/api/customer.py:267-286` (10 sn ön zaman aşımı `:272`; ilk mesaj boyutu için yalnızca uvicorn `ws_max_size` varsayılanı geçerli).
- Önerilen düzeltme: Ön zaman aşımı 3-5 sn'ye indirilmeli. İlk mesaj için 4 KiB sınırı konmalı. Oturum başına eşzamanlı bağlantı sınırı ve IP başına bağlantı hız sınırı eklenmeli.
- Birleşen ID'ler: MON-07 (bağlantı sınırı kısmı). Doğrulama: doğrulandı (C). DURUM: AÇIK

### RT-07: Bacak devredilince yeni sürücü önceki sürücüyle yapılan yazışmayı okuyabiliyor
- Kategori: A01:2021; CWE-200, CWE-639. Önem: Düşük.
- Etkilenen yer: `backend/app/api/trips.py:153-157,229-232`, `services/messages.py:53-56,88-90`.
- Önerilen düzeltme: Sürücü görünümü devir anından sonraki mesajlarla sınırlanmalı. Müşteri mesajlarına alıcı sürücü kimliği yazılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). İş kuralı niyeti doğrulanmadı. DURUM: AÇIK

### RT-08: Push jetonu kaydında biçim ve cihaz sahipliği doğrulanmıyor
- Kategori: A01/A04:2021; CWE-639, CWE-345. Önem: Düşük.
- Etkilenen yer: `backend/app/api/trips.py:336-351`, `services/notifications.py:113-131`.
- Önerilen düzeltme: FCM jeton biçimi doğrulanmalı. Başka bir hesaptan taşınan jeton denetim kaydına yazılmalı. Jeton oturuma bağlanmalı ve oturum iptalinde silinmeli.
- Birleşen ID'ler: yok. Doğrulama: kod doğrulandı (C). İstismar (jetonun ele geçirilmesi) doğrulanmadı. DURUM: AÇIK

### INF-03: `next-intl@4.3.12` açık yönlendirme advisory'si (GHSA-8f24-v5vv-gm5j)
- Kategori: A06:2021; CWE-601. Önem: **Düşük** (Orta'dan düşürüldü). `localePrefix: always`, `sanitizePathname` ve matcher nedeniyle bu yapılandırmada statik olarak istismar yolu bulunamadı.
- Etkilenen yer: `web/package.json:18`, `web/package-lock.json:4329-4330`, `web/middleware.ts:1-8`, `web/i18n/routing.ts:4-7`.
- Önerilen düzeltme: 4.15.0 ya da üstüne yükseltilmeli ve yönlendirme regresyon testi yazılmalı.
- Birleşen ID'ler: yok. Doğrulama: dinamik test gerekli (`/%09/evil`, `/%5C%5Cevil`, `//evil`, `/en/%09/evil` için `Location` başlığı kontrol edilmeli). DURUM: AÇIK

### INF-05: Geliştirme ve build araç zinciri açıkları (çalışma anında etkisi yok)
- Kategori: A06:2021; CWE-1395. Önem: Düşük.
- Etkilenen yer: `mobile/package-lock.json:17095-17096` (node-forge 1.4.2), `:20655-20656` (zod 3.25.76), minimatch, `@typescript-eslint`, glob, deepmerge.
- Önerilen düzeltme: SDK 58 yaması uygulanmalı (`npx expo install --fix`) ve lock dosyası yenilenmeli. `npm audit fix --force` kullanılmamalı (sürüm düşürür).
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-06: CI'da Google anahtarı workflow düzeyinde env'de; `curl | bash` kurulumu; üçüncü taraf action etiketle sabitli
- Kategori: A08:2021; CWE-829, CWE-494. Önem: **Düşük** (Orta'dan düşürüldü). Yazma yetkisi ve tedarik zinciri ele geçirme gerekiyor, etki tek bir kota sınırlı anahtar.
- Etkilenen yer: `.github/workflows/android-emulator.yml:30,57-58,109,140,143`, `.github/workflows/ios-simulator.yml:30,47-48,112,169`.
- Önerilen düzeltme: Anahtar yalnızca ilgili adımın env'ine taşınmalı. Maestro sabit sürümle ve SHA-256 doğrulamasıyla kurulmalı. Action SHA ile sabitlenmeli. Test için ayrı ve kısıtlı bir anahtar kullanılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-07: GitHub Actions SHA yerine etiketle sabitli
- Kategori: A08:2021; CWE-1357, CWE-829. Önem: Düşük.
- Etkilenen yer: `.github/workflows/ci.yml:45,46,64,65,90,91,107,108`, `android-emulator.yml:54,66,83,88,95,126,143,158`, `ios-simulator.yml:44,62,93,102,140,227`.
- Önerilen düzeltme: SHA ile sabitlenmeli ve sürüm yorumla belirtilmeli. Dependabot `github-actions` ekosistemi eklenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-08: Dependabot/Renovate yok; CI'da bağımlılık açığı taraması yok; SECURITY.md ve CODEOWNERS yok
- Kategori: A06:2021; CWE-1104. Önem: **Düşük** (Orta'dan düşürüldü). Süreç eksikliği.
- Etkilenen yer: `.github/` (yalnızca `scripts`, `workflows` var), `.github/workflows/ci.yml`.
- Önerilen düzeltme: `dependabot.yml` eklenmeli (npm x4, pip, github-actions, docker). CI'ya `npm audit --omit=dev --audit-level=high` ve `pip-audit` adımları eklenmeli (başlangıçta uyarı modunda).
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-09: Python geçişli bağımlılıkları sabitsiz ve hash'siz; pytest çalışma bağımlılıklarıyla aynı dosyada
- Kategori: A08:2021; CWE-1357, CWE-494. Önem: Düşük.
- Etkilenen yer: `backend/requirements.txt:1-17`.
- Önerilen düzeltme: `pip-tools` ya da `uv` ile hash'li lock dosyası oluşturulmalı. Test bağımlılıkları `requirements-dev.txt`'ye ayrılmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-11: Container image'ları değiştirilebilir etiketle; CI ile yerel arasında sürüm kayması; prod container tanımı yok
- Kategori: A08/A06:2021; CWE-1357. Önem: Düşük.
- Etkilenen yer: `docker-compose.yml:4,19`, `ci.yml:25,36`, `android-emulator.yml:41-52` (17-3.5 / 7, diğerleri 16-3.4 / 7-alpine).
- Önerilen düzeltme: `@sha256` digest ile sabitlenmeli ve tek bir Postgres major sürümü kullanılmalı. Prod Dockerfile yazıldığında ayrıca incelenmeli.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-12: `.gitignore` Firebase/FCM kimlik dosyası desenlerini kapsamıyor
- Kategori: A05/A02:2021; CWE-540, CWE-312. Önem: Düşük. Şu an izlenen böyle bir dosya yok.
- Etkilenen yer: `.gitignore:26-32`, `backend/app/config.py:57`, `mobile/app.config.ts:25,140`.
- Önerilen düzeltme: `google-services.json`, `GoogleService-Info.plist`, `*firebase-adminsdk*.json`, `*service-account*.json`, `*.p12`, `*.jks`, `*.keystore` desenleri eklenmeli. gitleaks pre-commit kurulmalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### INF-13: Staging ortamı yok; mobil "preview" profilleri canlı API'ye bağlanıyor
- Kategori: A05:2021; CWE-1188. Önem: Düşük.
- Etkilenen yer: `mobile/eas.json:12-28`, `backend/app/config.py:24`.
- Önerilen düzeltme: `stage` ortamı ve ayrı bir API alan adı tanımlanmalı, preview profilleri staging'e yönlendirilmeli. Stage, INF-01/INF-02 korumalarının aynısını almalı.
- Birleşen ID'ler: yok. Doğrulama: doğrulandı (C). DURUM: AÇIK

### EXT-02: Sürücünün beyan ettiği belge geçerlilik tarihi inceleyen değiştirmezse onaylanıyor
- Kategori: OWASP A04:2021; CWE-602, CWE-840. Önem: Düşük. Belgeyi inceleyen kişinin tarihi görmesi bekleniyor. Ama süresi geçmiş ehliyet ya da sigorta ile çalışma riski var ve `expire_documents` yanlış tarihe göre çalışıyor.
- Etkilenen yer: `backend/app/services/documents.py:81`.
- Önerilen düzeltme: Onay ekranında `valid_until` alanı zorunlu ve açık bir onay olarak gösterilmeli. İnceleyen kişi tarihi teyit etmeden onay verilememeli. Değişiklik denetim kaydına yazılmalı.
- Birleşen ID'ler: yok (AUTH kapsam dışı gözleminden sahiplenildi).
- Doğrulama: doğrulanmadı.
- DURUM: AÇIK

---

## Bilgi maddeleri

Tümünün durumu AÇIK. Olumlu tespitlerde aksiyon gerekmiyor, yalnızca kayıt için tutuluyor.

| ID | Başlık | Etkilenen yer | Not / öneri | Doğrulama |
|---|---|---|---|---|
| AUTH-10 | 2FA adımında `user.status` kontrol edilmiyor | `backend/app/services/auth.py:275-288` | Erişim başka yerde engelleniyor. Yalnızca yanıltıcı `staff.login` kaydı ve `last_login_at` güncellemesi oluşuyor. ACTIVE değilse `Unauthorized` dönülmeli. | doğrulandı |
| API-14 | Belge indirmede stored XSS riski düşük (olumlu) | `services/documents.py:24-30,45-50`, `admin/fleet.py:196-206` | İzin listesi genişlerse risk geri gelir. `attachment` ve `CSP: sandbox` eklenebilir. | doğrulandı |
| API-15 | PayTR imza formülü doğru, tekrar idempotent (olumlu) | `providers/payments.py:144-145`, `services/payments.py:113-121` | `total_amount` notu BIZ-07'de. | doğrulandı |
| API-16 | Hata işleyicileri, versiyonlama ve mass assignment sorunsuz (olumlu) | `main.py:24-26,36-49` | `extra="forbid"` değerlendirilebilir. | doğrulandı |
| MON-15 | `/health` yalnızca canlılık döndürüyor | `backend/app/main.py:60-62` | Yalnızca iç ağdan erişilen ayrı bir `/ready` (DB, Redis) eklenmeli. | doğrulandı |
| DB-12 | Yedekleme yapılandırması yok, doküman iddiası karşılıksız | `docs/yasal_ve_guvenlik.md:28` | Yedekleme ve geri yükleme prosedürü belgelenmeli, `acik_konular.md`'ye eklenmeli. | doğrulandı |
| DB-13 | Denetim kaydı `action` filtresi LIKE joker karakterlerini kaçırmıyor | `api/admin/people.py:180-209` | `autoescape=True` kullanılmalı. SUPPORT rolü için IP maskelemesi değerlendirilmeli. | doğrulandı |
| BIZ-10 | Tam iade sürücü hakedişini etkilemiyor | `services/bookings.py:431-461`, `api/admin/operations.py:187` | Tasarım gereği (K-57). Arayüzde hakediş iptali sorulmalı. | doğrulandı |
| BIZ-11 | Rezervasyon kodu tahmin edilebilirliği (sorun yok) | `services/bookings.py:51,90-91` | CSPRNG kullanılıyor. Kod tek başına yetki vermiyor. | doğrulandı |
| PRIV-11 | Konum geçmişi kalıcı tabloya yazılmıyor (olumlu) | `services/live_location.py:20-35` | Redis notu RT-01'de. Admin canlı konum görüntülemesi MON-08'de. | doğrulandı |
| WEB-03 | Origin denetimi `x-forwarded-host` değerine güveniyor | `admin/app/bff/[...path]/route.ts:39-48`, `web/.../route.ts:52-61` | Tarayıcıdan istismar yolu yok. Sabit `ALLOWED_ORIGINS` kullanılmalı. | doğrulandı |
| WEB-07 | Origin denetimi GET'leri kapsamıyor; yan etkili GET var | `web/.../route.ts:107`, `backend/app/api/trips.py:246-249`, `services/messages.py:47-52` | Okundu işaretlemesi POST'a taşınmalı ya da `Sec-Fetch-Site` kontrol edilmeli. | doğrulandı |
| WEB-08 | Çerezde `__Host-`/`__Secure-` öneki yok; `Secure` bayrağı `NODE_ENV`'e bağlı | `web/.../route.ts:28-36`, `admin/.../route.ts:19-27` | `__Secure-` öneki değerlendirilmeli. | doğrulandı |
| MOB-10 | Web önizlemesinde jetonlar `localStorage`'da | `mobile/lib/storage.web.ts:1-8` | Yalnızca geliştirme ortamı. Yayınlanmayacağı karara bağlanmalı. | doğrulandı |
| MOB-11 | Ekran görüntüsü koruması yok; `keychainAccessible` varsayılan; `allowBackup` belirsiz | `mobile/lib/storage.ts:5-6` | `expo-screen-capture` değerlendirilmeli. Prebuild çıktısı kontrol edilmeli. | dinamik test gerekli |
| RT-10 | Sohbet hız sınırı say-sonra-ekle (yarış durumu) | `services/messages.py:79-91`, `api/trips.py:243` | Redis `INCR` ya da `FOR UPDATE` kullanılmalı. | dinamik test gerekli |
| INF-04 | `next@15.5.28` içindeki `postcss@8.4.31` advisory'leri | `web/package-lock.json:4675-4676`, `admin/package-lock.json:4606-4607` | Yalnızca build zamanında ve güvenilir CSS üzerinde çalışıyor. Next yamaları izlenmeli. | doğrulandı |

---

## Dinamik test gerekenler

| ID | Neden | Önerilen deneme |
|---|---|---|
| WEB-01 | Next'in istek yolunu eşleyiciden önce normalize edip etmediği uçtan uca görülmedi | Yerel `next start`, müşteri çereziyle `curl --path-as-is` `GET /bff/me/..%2Fdriver%2Fme` ve `/bff/me/%2e%2e/driver/me`. Backend 403 dönerse atlatma var, BFF 404/400 dönerse koruma çalışıyor. Admin için `/bff/admin/..%2Fpayments%2F...` |
| INF-03 | Statik olarak istismar yolu bulunamadı, regresyon güvencesi gerekli | Yerel web'de `/%09/evil`, `/%5C%5Cevil`, `//evil`, `/en/%09/evil` için `Location` başlığı |
| RT-01 (LAN) | Docker Desktop 0.0.0.0 bağlaması ve Windows güvenlik duvarı etkisi | `netstat -ano`, aynı LAN'daki başka bir makineden `redis-cli -h <ip> PING` |
| MOB-02 / WEB-06 | expo-router `%2F` çözümü ve RN `fetch` normalizasyonu; tarayıcıda hazırlanmış bağlantı | Cihazda `getaway://booking/..%2F..%2F...` bağlantısı, admin'de kodlanmış `[id]` bağlantısı. Backend erişim logu izlenmeli |
| RT-10 | Say-sonra-ekle yarışı | Eşzamanlı 50 POST ile 40 mesaj sınırının aşılıp aşılmadığı |
| MOB-11 | Kütüphane varsayılanları | `npx expo prebuild` sonrası AndroidManifest `allowBackup`/`dataExtractionRules` ve `expo-secure-store` kaynağı |
| BIZ-03 | PayTR iade tavanı ve eşzamanlılık | PayTR test ortamında zaman aşımı simülasyonu. İki eşzamanlı retry ve elle iade isteğiyle entegrasyon testi |
| BIZ-08 | Deadlock zamanlamaya bağlı | `accept_job` ve `accept_offer` aynı bacak için eşzamanlı çalıştırılmalı |
