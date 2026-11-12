# Güvenlik denetimi: Alan 4, API hijyeni

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Yöntem: yalnızca statik okuma. Servis çalıştırılmadı, dinamik test yapılmadı, kod değiştirilmedi.
- Etiketler: `verified` = ilgili satırlar okundu ve mantık koddan doğrudan izlendi (çalıştırılarak değil). `belief` = çıkarım, bağımsız doğrulanmalı.
- Secret değerleri yazılmadı.

## Özet

| Önem | Sayı | ID'ler |
|---|---|---|
| Yüksek | 2 | API-01, API-02 |
| Orta | 5 | API-03, API-04, API-05, API-06, API-07 |
| Düşük | 6 | API-08, API-09, API-10, API-11, API-12, API-13 |
| Bilgi | 3 | API-14, API-15, API-16 |

---

## Bulgular

### API-01 SMS pompalama (toll fraud): OTP isteğinde IP, küresel veya ülke sınırı yok

- OWASP API4:2023 (Unrestricted Resource Consumption), API6:2023 (Unrestricted Access to Sensitive Business Flows); CWE-770, CWE-799
- Önem: **Yüksek**. Kimlik gerektirmiyor, kolay otomatikleştirilir ve doğrudan para kaybına yol açar (Netgsm faturası). Tek sınır telefon başına saatte 5; numara değiştirerek bu sınır aşılır.
- Konum:
  - `backend/app/api/auth.py:80-91`: uçta kimlik, captcha veya IP sınırı yok.
  - `backend/app/services/otp.py:56-63`: sayım yalnızca `phone_hash` üzerinden yapılıyor. `ip` sadece kayda yazılıyor (`otp.py:69`).
  - `backend/app/security/crypto.py:22`: `_E164 = ^\+[1-9]\d{7,14}$`, yani her ülke kodu kabul ediliyor. Ülke izin listesi yok.
- İstismar (kavramsal): Saldırgan, yüksek ücretli uluslararası numara aralıklarına (IRSF) art arda `POST /auth/otp/request` gönderir. Her yeni numara 5 SMS hakkıyla başlar. Gönderilen her SMS, Netgsm üzerinden işletmeye maliyet çıkarır.
- Düzeltme: IP başına ve küresel olarak dakikalık/saatlik sınır koyun (Redis sayacı, `places.check_rate_limit` deseni yeterli). Hedef ülke kodlarını izin listesine alın veya TR dışı numaralar için ayrı, düşük bir kota tanımlayın. Anormal artışta captcha (Turnstile) veya devre kesici ekleyin. IP'nin güvenilir kaynaktan alınması gerekir (bkz. API-03).
- Durum: verified (kod okuması). Gerçek maliyet ve Netgsm tarafındaki uluslararası gönderim ayarı doğrulanmadı.

### API-02 Personel 2FA kaba kuvvete açık: deneme sınırı yok, `mfa` jetonu 5 dk boyunca sınırsız kullanılıyor

- OWASP API2:2023 (Broken Authentication); CWE-307, CWE-1390
- Önem: **Yüksek**. Parolası ele geçmiş bir personel hesabında 2FA koruması fiilen ortadan kalkar. Bu hesaplar admin yetkisine kadar çıkabilir. Saldırı için parola gerekli olduğundan Kritik sayılmadı.
- Konum:
  - `backend/app/services/auth.py:265-288` (`staff_verify_2fa`): başarısız denemede yalnızca denetim kaydı yazılıyor. Sayaç, kilit veya jetonu geçersiz kılma yok.
  - `valid_window=1` ile her anda 3 geçerli kod var. `mfa` jetonu tek kullanımlık değil (`tokens.py:44-53`, jti/iptal yok).
  - `backend/app/api/auth.py:162-175`: uçta hız sınırı yok. TOTP kodunun tekrar kullanımını engelleyen bir alan da yok (recon 3.5).
- İstismar (kavramsal): Parolayı bilen saldırgan bir `mfa` jetonu alır ve 5 dakika içinde paralel isteklerle 000000-999999 aralığını dener. Her deneme yaklaşık 3/10^6 başarı şansı taşır. Saniyede birkaç yüz istekle tek jetonda kayda değer bir olasılığa ulaşılır, jeton bitince yeniden giriş yapılır. Denetim kaydı yazılır ama hiçbir şey engellenmez.
- Düzeltme: Kullanıcı ve `mfa` jetonu başına deneme sayacı tutun (ör. 5 hatada jetonu iptal edin, 10 hatada hesabı geçici kilitleyin). `mfa` jetonuna `jti` ekleyip tek kullanımlık yapın. Son kullanılan TOTP adımını (`last_totp_step`) saklayarak aynı kodun tekrar kullanılmasını engelleyin. Uca IP başına hız sınırı ekleyin.
- Durum: verified (kod okuması). Erişilebilen istek hızı ölçülmedi.

### API-03 İstemci IP'si doğrulanmamış `cf-connecting-ip` başlığından alınıyor: hız sınırı aşılabiliyor, denetim ve onay kayıtlarındaki IP sahte olabiliyor

- OWASP API8:2023 (Security Misconfiguration); CWE-348 (Use of Less Trusted Source), CWE-290
- Önem: **Orta**. Tek başına veri sızdırmıyor. Ancak mevcut tek IP sınırını (places/routes) geçersiz kılıyor ve KVKK onay kaydı (`consents.ip`) ile değiştirilemez denetim kaydındaki (`audit_logs.ip`) IP'nin güvenilirliğini bozuyor.
- Konum:
  - `backend/app/api/deps.py:28-30`: başlık, kaynağı kontrol edilmeden kabul ediliyor. Backend `0.0.0.0` üzerinde dinliyor (recon 1).
  - `admin/app/bff/[...path]/route.ts:56-57` ve web BFF: istemciden gelen `cf-connecting-ip` / `x-forwarded-for` olduğu gibi aktarılıyor.
- İstismar (kavramsal): Her istekte farklı bir `cf-connecting-ip` göndermek `places_rl:{ip}:...` sınırını devre dışı bırakır ve ücretli Google API'leri sınırsız çağrılabilir. Personel girişi veya müşteri onayı sahte IP ile kayda geçer.
- Düzeltme: IP'yi yalnızca güvenilir vekilden gelen isteklerde başlıktan alın. Bunun için Cloudflare IP aralıkları veya yapılandırılabilir bir `trusted_proxies` listesi kullanın (uvicorn `--proxy-headers --forwarded-allow-ips`). Diğer durumlarda `request.client.host` kullanın. BFF'ler istemci başlığını değil, kendi gördüğü bağlantı IP'sini ya da yalnızca güvenilir kenardan gelen değeri aktarmalı. Değeri `ipaddress.ip_address` ile doğrulayın (bkz. API-08).
- Durum: verified (kod). Üretimdeki ağ topolojisi bilinmiyor; backend doğrudan internete açık değilse etki azalır (belief).

### API-04 `POST /quotes` hız sınırı olmadan ücretli Google Routes API'yi çağırıyor

- OWASP API4:2023; CWE-770 (denial of wallet)
- Önem: **Orta**. Kimlik gerektirmiyor ve doğrudan maliyet doğuruyor. Süreç içi önbellek etkiyi kısmen azaltıyor.
- Konum: `backend/app/api/public.py:97-100`. `routes/preview` (`public.py:109`) sınırlanmış, `quotes` sınırlanmamış. `backend/app/providers/routing.py:72-84`: önbellek süreç başına 512 kayıt tutuyor, dolunca tamamen temizleniyor, anahtar yaklaşık 1 m hassasiyette.
- İstismar (kavramsal): Saldırgan birkaç yüz `place_token` toplar (6 saat geçerli, `config.py:69`, places sınırı API-03 ile aşılabilir) ya da bölge çiftlerini dolaşır. Ardından `/quotes`'a sınırsız istek atar. 512'yi aşan anahtar kümesi önbelleği sürekli temizlediği için her istek Google'a gider.
- Düzeltme: `/quotes` (ve `me/bookings` teklif hesabı) için aynı IP sınırını uygulayın. Önbelleği Redis'e taşıyıp LRU yapın. Google tarafında günlük kota ve bütçe alarmı tanımlayın.
- Durum: verified (kod). `build_quote` içinde her araç tipi için ayrı çağrı olup olmadığı ayrıntılı izlenmedi; yorum aynı noktaların önbellekten döndüğünü söylüyor.

### API-05 Personel girişinde hız sınırı yok; Argon2 ile birleşince kimliksiz CPU ve bellek tüketimi

- OWASP API2:2023, API4:2023; CWE-307, CWE-400
- Önem: **Orta**. Argon2 parola denemesini yavaşlatıyor ama sınırsız deneme kimlik bilgisi doldurma (credential stuffing) saldırısına izin veriyor. Ayrıca argon2-cffi varsayılanlarıyla her istek yaklaşık 64 MiB bellek ve onlarca ms CPU harcıyor, kullanıcı yoksa da hesaplama yapılıyor (`passwords.py`).
- Konum: `backend/app/api/auth.py:147-159`, `backend/app/services/auth.py:244-262`. Başarısız girişte yalnızca denetim kaydı yazılıyor.
- İstismar (kavramsal): Sızdırılmış e-posta/parola listeleriyle sınırsız deneme yapılabilir. Paralel isteklerle uvicorn worker'larının belleği ve CPU'su tüketilerek API hizmet veremez hale getirilebilir.
- Düzeltme: IP ve e-posta başına kayan pencere sınırı ile artan gecikme uygulayın; hesap başına geçici kilit koyun (bildirimle). Argon2 doğrulamasını eşzamanlılık sınırlı bir semafor arkasına alın.
- Durum: verified (kod). argon2-cffi varsayılan parametre değerleri sürüm belgesinden hatırlandı, bu repoda ölçülmedi (belief).

### API-06 PayTR callback'i kimliksiz ve sınırsız: her istek, imza geçersiz olsa da gövdenin tamamıyla `payment_webhooks` tablosuna yazılıyor

- OWASP API4:2023; CWE-770, CWE-400
- Önem: **Orta**. Kimlik gerekmiyor, imza kontrolünden önce kalıcı yazma yapılıyor ve saklanan yükün boyut sınırı yok. Veritabanı şişirilerek disk doldurulabilir. Ödeme bütünlüğü etkilenmiyor (imza doğru, bkz. API-15).
- Konum: `backend/app/api/payments.py:23` (form alanlarının tamamı), `backend/app/services/payments.py:100-111` (önce `PaymentWebhook` ekleniyor, geçersiz imzada da `db.commit()`). `providers/payments.py:79-80`: `mask_payload` tüm alanları kopyalıyor.
- İstismar (kavramsal): Saldırgan çok sayıda alan ve büyük değer içeren sahte form gövdeleriyle callback'e sürekli istek atar. Her istek JSON satırı olarak saklanır.
- Düzeltme: Saklanacak yükü bilinen PayTR alanlarıyla sınırlayın ve her değeri kırpın. Geçersiz imzalı bildirimleri tam gövdeyle saklamak yerine sayaç ve özet log ile yetinin ya da hız sınırı koyun. İsteğe bağlı olarak PayTR çıkış IP'lerini izin listesine alın. Uygulama veya vekil katmanında istek gövdesi boyut sınırı koyun.
- Durum: verified (kod). Starlette form ayrıştırıcısının urlencoded gövdelerde uyguladığı alan ve boyut sınırları bu sürümde doğrulanmadı (belief).

### API-07 Sürücü belge yüklemesinde boyut kontrolü gövde alındıktan sonra yapılıyor; kota yok

- OWASP API4:2023; CWE-770, CWE-400
- Önem: **Orta**. OTP ile giriş yapan herkes kendini sürücü olarak kaydedebiliyor (`driver.py:70`, onay gerekmiyor). Yükleme ucu onaysız sürücüye de açık. Disk tüketimi istismar edilebilir.
- Konum:
  - `backend/app/api/driver.py:113-139`: `UploadFile` işleyici çağrılmadan önce Starlette tarafından tamamen alınıp geçici dosyaya yazılıyor. `file.read(MAX+1)` yalnızca belleğe okunan kısmı sınırlıyor.
  - Sürücü veya araç başına belge sayısı sınırı yok. Reddedilen ve eski belgeler diskte kalıyor (`storage.put` her seferinde yeni anahtar üretiyor).
- İstismar (kavramsal): Saldırgan bir sürücü hesabı açar. Çok büyük gövdeli isteklerle geçici diski, geçerli 10 MB'lık PDF'lerle de `var/storage` dizinini doldurur.
- Düzeltme: Vekil veya ASGI katmanında `Content-Length` ve gövde üst sınırı koyun (ör. 11 MB). Sürücü başına belge türü kotası tanımlayın (her `doc_type` için tek bekleyen belge). Yükleme ucuna hız sınırı ekleyin. Reddedilen belgeleri saklama politikasına göre silin.
- Durum: verified (kod). Starlette'in dosya parçalarını spool ettiği davranış belgeye dayanıyor (belief).
- Olumlu tespitler (verified): içerik türü izin listesi `{pdf, jpeg, png}` (`services/documents.py:24,45`), sihirli bayt kontrolü (`:26-30,49`), 10 MB sınırı (`:25,47`). İstemcinin verdiği dosya adı hiç kullanılmıyor, depolama anahtarı sunucuda `secrets.token_hex(16)` ile üretiliyor ve `resolve()` ile kök dışına çıkış engelleniyor (`providers/storage.py:29-41`). Dosyalar Fernet ile şifreleniyor.

### API-08 Sınırsız başlık değerleri sabit uzunluklu kolonlara yazılıyor ve 500 hatası üretiyor (`User-Agent`, `cf-connecting-ip`)

- OWASP API8:2023; CWE-20, CWE-755
- Önem: **Düşük**. Saldırgan yalnızca kendi isteğini bozuyor. Yine de yakalanmamış veritabanı hataları ve log gürültüsü oluşuyor; IP alanına keyfi metin yazılabiliyor.
- Konum: `auth.py:99,167` `user_agent` sınırsız, `sessions.device_info String(255)` (`models/identity.py:69`). `deps.py:30` IP değeri doğrulanmıyor, `ip String(45)` (`identity.py:70,90`, `models/ops.py:54`).
- İstismar (kavramsal): 46 karakterden uzun bir `cf-connecting-ip` ile `otp/request`, `staff/login` veya denetim kaydı yazan herhangi bir uç 500 döner. IP alanına IP olmayan metin de yazılabilir (denetim kaydı kirlenir).
- Düzeltme: `device_info` değerini `[:255]` ile kırpın. IP'yi `ipaddress.ip_address` ile doğrulayın, geçersizse bağlantı IP'sini kullanın.
- Durum: belief. PostgreSQL'in `varchar(n)` taşmasında hata verdiği bilgisine dayanıyor; çalıştırılarak doğrulanmadı.

### API-09 Birkaç kimliksiz girdi alanı sınırsız veya aralıksız

- OWASP API4:2023 / API8:2023; CWE-20, CWE-1284
- Önem: **Düşük**. Bu alanlar indeksli eşitlik araması veya hesaplamada kullanılıyor; doğrudan istismar yolu görülmedi. Uç değerler 500 üretebilir.
- Konum (`backend/app/api/schemas.py` ve `auth.py`):
  - `RefreshIn.refresh_token: str` sınırsız (`auth.py:47`): her istekte SHA-256 hesaplanıyor.
  - `StaffMfaIn.mfa_token: str` sınırsız (`auth.py:62`).
  - `PhoneIn.phone: str` (`schemas.py:32`): regex sonrası E.164 sınırı var, ama `_PHONE_CLEAN.sub` regex'ten önce sınırsız girdi üzerinde çalışıyor.
  - `QuoteIn.vehicle_type_code: str` (`schemas.py:108`) ve `VehicleIn.vehicle_type_code` (`driver.py:158`) sınırsız.
  - `locale: str` (`schemas.py:171`, `auth.py:23,36`, `customer.py:156`): normalize ediliyor (`[:2]`), sınır yok.
  - `QuoteIn.pickup_at` / `return_pickup_at` (`schemas.py:109-110`): yalnızca saat dilimi zorunlu, aralık yok. `/quotes` geçmiş veya `9999-12-31` gibi bir tarihi kabul ediyor; `pickup_at + timedelta(...)` (`services/quotes.py:180`) taşabilir.
  - `BookingCreateIn.expected_total: Decimal` (`schemas.py:167`): aralık ve basamak sınırı yok.
  - `SettingIn.value: Any` (`admin/catalog.py:342`): yalnızca tür eşleşmesi aranıyor, değer aralığı yok (AdminOnly).
- Düzeltme: Jeton alanlarına `max_length` (ör. 512 / 2048) ekleyin. Kod alanlarına `max_length=30` ve desen verin. `locale` için `max_length=10` koyun. `pickup_at` için makul bir pencere tanımlayın (ör. şu an ile +2 yıl arası). `expected_total` için `ge=0, max_digits=12, decimal_places=2` kullanın. Ayar değerleri için anahtar başına aralık doğrulaması ekleyin.
- Durum: verified (alan tanımları). 500 senaryosu (tarih taşması) çalıştırılmadı (belief).

### API-10 Sağlayıcı hata ayrıntısı müşteriye aktarılıyor

- OWASP API8:2023; CWE-209
- Önem: **Düşük**. PayTR `reason` alanı mağaza yapılandırması hakkında ipucu verebilir (ör. token veya IP uyuşmazlığı). Kişisel veri sızıntısı görülmedi.
- Konum: `backend/app/providers/payments.py:137`: `ServiceUnavailable(f"ödeme sayfası oluşturulamadı: {body.get('reason', '')}")`. Bu mesaj `main.py:36-41` üzerinden olduğu gibi istemciye dönüyor.
- Düzeltme: İstemciye genel bir mesaj dönün; `reason` değerini yalnızca sunucu loguna (maskeli) ve `payments.failure_reason` alanına yazın.
- Durum: verified.

### API-11 Log enjeksiyonu: saldırgan kontrolündeki `merchant_oid` doğrudan loga yazılıyor

- OWASP A09:2021; CWE-117
- Önem: **Düşük**. Kimliksiz callback üzerinden log satırı taklit edilebilir. Etki, log tüketen araçlara bağlı.
- Konum: `backend/app/services/payments.py:110`.
- Düzeltme: Değeri `repr()` ile ya da CR/LF temizlenip kırpılarak loglayın. Yapılandırılmış (JSON) log kullanın.
- Durum: verified.

### API-12 Sahte ödeme uçları kimliksiz: dev/staging ortamı dışarı açılırsa herkes ödemeyi "başarılı" yapabilir

- OWASP API5:2023 / API8:2023; CWE-306
- Önem: **Düşük**. `env == "prod"` iken 404 dönüyor (`payments.py:62-66`), yapılandırma doğrulayıcısı da prod'da fake sağlayıcıyı reddediyor (recon 5.1). Risk yalnızca internete açık dev/staging ortamlarında.
- Konum: `backend/app/api/payments.py:69-96`. `oid` bilen herkes `POST /fake/{oid}/complete` ile ödemeyi `PAID` yapabiliyor; CSRF koruması da yok.
- Düzeltme: Staging'i ağ düzeyinde kısıtlayın. Fake uçları ayrıca `env in {"dev","test"}` ve yerel istemci koşuluna bağlayın.
- Durum: verified (kod). Staging ortamı olup olmadığı bilinmiyor (belief).

### API-13 BFF izin listesi `..` segmentiyle aşılabilir (belief)

- OWASP API8:2023; CWE-22 / CWE-863 (proxy path normalization)
- Önem: **Düşük**. Aşılsa bile istek, kullanıcının kendi jetonuyla backend'e gidiyor; backend rol kontrolü yapmaya devam ediyor. Etki, izin listesi dışındaki kimliksiz uçlara (ör. `payments/fake`) BFF üzerinden ulaşılmasıyla sınırlı.
- Konum: `admin/app/bff/[...path]/route.ts:88-89,59`, `web/app/bff/[...path]/route.ts:14-23`. `path.join("/")` sonrasında `^admin\/.+$` regex'i uygulanıyor, ardından `fetch(`${API_URL}/api/v1/${path}`)` URL normalleştirmesi `..` segmentlerini çözüyor.
- İstismar (kavramsal): `/bff/admin/%2E%2E/payments/fake/X` gibi bir istek, Next.js segmentleri çözüp birleştirirse `admin/../payments/...` regex'ten geçer, `fetch` de bunu `/api/v1/payments/...` adresine normalleştirir.
- Düzeltme: Birleştirilmiş yolda `..`, `.` ve boş segmenti reddedin; `encodeURIComponent` ile segment bazında yeniden kodlayın.
- Durum: **doğrulanmadı (belief)**. Next.js 15.5'in catch-all parametrelerinde `%2E%2E` ve `%2F` değerlerini çözüp çözmediği test edilmedi.

### API-14 Belge indirmede stored XSS: mevcut kontrollerle risk düşük (bilgi)

- OWASP A03:2021; CWE-79 / CWE-434
- Önem: **Bilgi**.
- Değerlendirme: `content_type` istemciden geliyor ama yüklemede izin listesine (`pdf/jpeg/png`) ve sihirli bayt kontrolüne tabi (`services/documents.py:45-50`). Bu yüzden veritabanında `text/html` veya `image/svg+xml` saklanamıyor. İndirme (`admin/fleet.py:196-206`) `inline` dönüyor. Backend `X-Content-Type-Options: nosniff` ekliyor (`main.py:54`); admin BFF bu başlığı aktarmasa da `admin/next.config.ts` tüm yollara `nosniff` ve sıkı bir CSP (`default-src 'self'`, `object-src 'none'`) ekliyor. Admin arayüzü görselleri blob URL ile gösteriyor, PDF'leri indiriyor (`admin/components/DocumentReview.tsx:34-35`). HTML/PDF poliglot bir dosya `application/pdf` olarak sunulduğu için tarayıcıda HTML olarak çalışmaz. PDF içindeki JavaScript, tarayıcının PDF görüntüleyici sandbox'ında kalır.
- Öneri (sertleştirme): Gelecekte izin listesi genişlerse risk geri gelir. `Content-Disposition: attachment` ile `Content-Security-Policy: sandbox; default-src 'none'` başlıklarını indirme yanıtına ekleyin. Content-type'ı istemci beyanından değil, sihirli baytlardan türetin.
- Durum: verified (backend). Next.js `headers()` kurallarının route handler yanıtlarına da uygulandığı belief.

### API-15 PayTR webhook imzası: formül doğru, tekrar (replay) idempotent (bilgi)

- Önem: **Bilgi** (olumlu tespit ve küçük notlar).
- Doğru olanlar (verified): İmza `base64(HMAC-SHA256(merchant_key, merchant_oid + merchant_salt + status + total_amount))` olarak hesaplanıyor (`providers/payments.py:144`); bu, PayTR'nin belgelediği bildirim formülüyle aynı. Karşılaştırma sabit zamanlı yapılıyor (`hmac.compare_digest`, `:145`). Tekrar korumasını idempotentlik sağlıyor: yalnızca `PENDING` durumundaki ödeme işleniyor (`services/payments.py:120-121`), satır `FOR UPDATE` ile kilitleniyor (`:113-115`). Eksik tahsilat kontrolü var (`:129`).
- Notlar:
  - `total_amount` sayısal değilse `None` oluyor ve eksik tahsilat kontrolü atlanıyor (`providers/payments.py:150`, `services/payments.py:129`). İmza bu değeri kapsadığından sahtecilik mümkün değil, ama savunma için "tutar yoksa reddet" kuralı daha güvenli.
  - Para birimi (`currency`) imzaya dahil değil ve kontrol edilmiyor. PayTR formülü gereği beklenen bir durum.
  - PayTR'de zaman damgası olmadığından, imzalı bir "failed" bildiriminin ödeme hâlâ `PENDING` iken tekrar oynatılması teorik olarak mümkün. Bunun için imzalı mesajın ele geçirilmesi gerekir; etki ödemenin `FAILED` olması. Sonradan gelen bir "success" bildirimi `PENDING` olmadığı için işlenmez (`:120`). Bu kenar durum belief olarak bırakıldı.
  - FakeProvider imza anahtarı olarak `jwt_secret` kullanıyor (`providers/payments.py:224`); anahtar ayrımı ilkesine aykırı (yalnızca dev).

### API-16 Hata işleyicileri, versiyonlama ve mass assignment: önemli bulgu yok (bilgi)

- Hata mesajları (verified): `DomainError` işleyicisi yalnızca `code`, `message`, `details` dönüyor (`main.py:36-41`). Doğrulama işleyicisi girdi değerini geri yansıtmıyor, yalnızca `loc` ve `msg` dönüyor (`main.py:43-49`). Genel `Exception` işleyicisi yok; FastAPI/Starlette varsayılanı `debug=False` iken düz "Internal Server Error" döner. Aramam `debug=True` bulamadı (komut: `grep -rn "debug" app/main.py app/config.py`).
- Kullanıcı numaralandırma (verified): `staff/login` kullanıcı yoksa da Argon2 hesaplıyor ve tek bir mesaj dönüyor (`services/auth.py:250-254`). `otp/request` her telefon için aynı yanıtı veriyor. `staff/2fa` geçersiz jetonda farklı mesaj dönüyor, ancak bunun için geçerli bir jeton gerekiyor.
- Versiyonlama (verified): Tüm API rotaları `/api/v1` öneki altında (`main.py:64-70`); `/health` öneksiz. OpenAPI ve docs prod'da kapalı (`main.py:24-26`). Sürüm geçiş veya kullanımdan kaldırma politikası yok (yalnızca not).
- Mass assignment (verified): `model_dump()` ile ORM oluşturma yalnızca admin uçlarında ve açık alan listeli şemalarla yapılıyor (`admin/catalog.py:68,83-84,116,219,322`, `admin/fleet.py:142,158-159`). Şemalarda `id`, `created_at` veya yetki alanı yok. `is_active` alanı bilinçli olarak dahil, AdminOnly/OpsStaff yetkisiyle. Pydantic varsayılanı `extra="ignore"` olduğundan fazladan gönderilen alanlar düşüyor; aramam şemalarda `extra="allow"` bulamadı (komut: `grep -rn "extra=" app`, tek eşleşme `config.py:21` pydantic-settings). Müşteri profili (`customer.py:175-190`) ve personel güncellemesi (`people.py:156-176`) alanları tek tek atıyor.
- Not: `extra="forbid"` kullanılmaması, istemci hatalarının sessizce yutulmasına yol açıyor; güvenlik açığı değil.

---

## Hız sınırı haritası (kimliksiz uçlar)

| Uç | Sınır | Kanıt |
|---|---|---|
| POST /auth/otp/request | Telefon başına saatte 5; IP veya küresel sınır yok | `services/otp.py:56-63` |
| POST /auth/otp/verify | Challenge başına 5 deneme; IP sınırı yok | `services/otp.py:82-110` (recon) |
| POST /auth/refresh | Yok (48 baytlık rastgele jeton, kaba kuvvet pratik değil) | `auth.py:118-122` |
| POST /auth/staff/login | Yok | `auth.py:147` |
| POST /auth/staff/2fa | Yok | `auth.py:162` |
| POST /payments/paytr/callback | Yok | `payments.py:20` |
| GET /regions, /vehicle-types | Yok (yalnızca DB okuma) | `public.py:34,41` |
| POST /quotes | **Yok** (ücretli Routes API çağırıyor) | `public.py:97` |
| POST /routes/preview | IP başına dakikada 60 | `public.py:109` |
| GET /places/autocomplete, /places/{id} | IP başına dakikada 60 | `public.py:125,132` |

Aramam başka bir hız sınırı mekanizması (slowapi, middleware, Redis sayacı) bulamadı (komut: `grep -rn -i "rate\|limit\|throttl" --include=*.py backend/app`).

## Kapsam dışı kalan ama görülen noktalar

- Yenileme jetonu döndürülüyor ama tekrar kullanım tespiti (token family revocation) yok (`services/auth.py:60-78`). Eski jeton sadece eşleşmiyor; çalınan jeton bir kez kullanılırsa meşru kullanıcı düşer ama saldırganın oturumu devam eder. Bu konu kimlik doğrulama alanına ait.
- `place_token`, erişim jetonuyla aynı `jwt_secret` ile imzalanıyor; `typ` alanı kontrol edildiği için karışma yok (`services/places.py:71-97`).
