# Güvenlik denetimi: Alan 1, Kimlik doğrulama ve yetkilendirme

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Yöntem: yalnızca statik okuma. Servis çalıştırılmadı, dinamik test yapılmadı, kod değiştirilmedi.
- Etiketler: `verified: <dosya:satır veya komut>` doğrudan okundu; `belief` çıkarımdır, doğrulanmadı.
- Secret değerleri yazılmadı.

## Özet

| ID | Başlık | Önem |
|---|---|---|
| AUTH-01 | Personel parola ve 2FA adımında deneme sınırı ve hesap kilidi yok | Yüksek |
| AUTH-02 | 2FA kurulmamış personel hesabında parola tek başına TOTP sırrını veriyor; `reset_2fa` oturumları kapatmıyor | Orta |
| AUTH-03 | `env` serbest metin; üretim validator'ı yalnızca tam `"prod"` değerinde çalışıyor, kapsamında boşluklar var | Orta |
| AUTH-04 | OTP isteğinde IP ve genel sınır yok (SMS pumping / maliyet) | Orta |
| AUTH-05 | `client_ip` istemcinin gönderdiği `cf-connecting-ip` başlığına koşulsuz güveniyor | Orta |
| AUTH-06 | Askıya alınan sürücü atanmış işlere ve yolcu verisine erişmeye devam ediyor | Orta |
| AUTH-07 | TOTP kodu ve MFA ara jetonu tekrar kullanılabiliyor | Düşük |
| AUTH-08 | Yenileme jetonunda yeniden kullanım tespiti yok; personel oturumu da 30 gün | Düşük |
| AUTH-09 | WebSocket canlı konum akışı yalnızca bağlantı anında doğrulanıyor | Düşük |
| AUTH-10 | 2FA adımında kullanıcı durumu kontrol edilmiyor | Düşük |

Toplam 10 bulgu: Kritik 0, Yüksek 1, Orta 5, Düşük 4.

---

## Bulgular

### AUTH-01: Personel parola ve 2FA adımında deneme sınırı ve hesap kilidi yok

- Kategori: OWASP A07:2021 Identification and Authentication Failures; CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- Önem: Yüksek. Admin paneli tüm rezervasyon, iade, hakediş ve personel yönetimine erişir. Parola adımı Argon2 maliyetiyle yavaşlıyor ama sınırsız. 2FA adımı ise ucuz (yalnızca HMAC) ve sınırsız: `valid_window=1` ile her denemede 3 geçerli kod vardır, yani bir denemenin başarı olasılığı yaklaşık 3/10^6. MFA jetonu 5 dk geçerli ve parola bilindikçe sınırsız yeniden alınabiliyor. Saniyede birkaç yüz istekle beklenen kırılma süresi saatler mertebesinde. Parola sızmışsa (kimlik bilgisi doldurma, oltalama) 2FA koruması pratikte birkaç saatlik bir engel olarak kalıyor.
- Etkilenen yer:
  - `backend/app/services/auth.py:244-253` (`staff_login`: başarısızlıkta yalnızca denetim kaydı yazılıyor, sayaç ve kilit yok)
  - `backend/app/services/auth.py:265-281` (`staff_verify_2fa`: başarısızlıkta yalnızca denetim kaydı, deneme sayacı yok)
  - `backend/app/api/auth.py:147-175` (uçlarda limit bağımlılığı yok)
- İstismar (kavramsal): Saldırgan hedef personelin parolasını bulduktan sonra `/auth/staff/login` ile MFA jetonu alır, `/auth/staff/2fa` ucuna 000000-999999 aralığında kodları paralel gönderir. Jetonun süresi dolunca yeniden giriş yapıp devam eder. Parola bilinmiyorsa aynı yöntemle `/auth/staff/login` üzerinde sınırsız parola denemesi yapılır.
- Önerilen düzeltme: Hesap başına ve IP başına (Redis sayacı) başarısız deneme sınırı. Örnek: 2FA için MFA jetonu başına en fazla 5 deneme (jetona `jti` ekleyip sayacı ona bağlamak), kullanıcı başına 15 dk içinde 10 başarısız denemede geçici kilit ve artan bekleme. Kilit durumunu `users` tablosunda (`failed_login_count`, `locked_until`) ya da Redis'te tutmak. Kilit olaylarını denetim kaydına yazmak ve admin'e bildirim göndermek.
- Etiket: verified: `services/auth.py:244-288` okundu; `grep -rn -i -E "slowapi|limiter|lockout|locked_until|failed_attempts|last_totp|totp_last|used_code" backend/app` yalnızca alakasız `finance.py:167` (`csv.writer`) eşleşmesini verdi; `TooManyRequests` yalnızca `otp.py:63`, `messages.py:87`, `places.py:113` içinde kullanılıyor.

### AUTH-02: 2FA kurulmamış personel hesabında parola tek başına TOTP sırrını veriyor; `reset_2fa` oturumları kapatmıyor

- Kategori: OWASP A07:2021; CWE-308 (Use of Single-factor Authentication), CWE-613 (Insufficient Session Expiration)
- Önem: Orta. Yeni oluşturulan personel hesabı ilk girişe kadar ve `reset_2fa` sonrasında yalnızca parolayla korunuyor. Bu süre içinde parolayı bilen herkes TOTP sırrını alıp 2FA'yı kendi cihazına bağlayabiliyor ve tam oturum açabiliyor. Sır her girişte yeniden üretilmediği için (`if not user.two_factor_secret`) meşru kullanıcı ile saldırgan aynı sırrı görür, meşru kullanıcı bir şeyin ters gittiğini fark etmez. Önem Orta: saldırı parolanın bilinmesine ve hesabın kurulum penceresinde olmasına bağlı.
- Etkilenen yer:
  - `backend/app/services/auth.py:256-262` (kurulumda `provisioning_uri`, yani sır, parola sonrası doğrudan dönüyor; mevcut sır yeniden kullanılıyor)
  - `backend/app/services/auth.py:282-285` (ilk geçerli kod 2FA'yı etkinleştiriyor)
  - `backend/app/api/admin/people.py:170-172` (`reset_2fa`: sır ve bayrak siliniyor, kullanıcının açık oturumları kapatılmıyor; karşılaştırma için `DISABLED` dalında kapatılıyor, satır 167-169)
- İstismar (kavramsal): (a) Admin yeni bir personel ekler ve ilk parolayı e-posta veya mesajla iletir. Bu kanalı ele geçiren saldırgan, personelden önce giriş yapıp sırrı alır ve hesabı kendi doğrulayıcısına bağlar. (b) Cihazı çalınan bir personel için admin `reset_2fa` yapar; çalınan cihazdaki mevcut oturum (ve 30 günlük yenileme jetonu) açık kalır.
- Önerilen düzeltme: İlk kurulum için parola dışında tek kullanımlık, kısa ömürlü bir davet bağlantısı veya kodu kullanmak; kurulum tamamlanana kadar giriş yapılmış oturumun yetkisini kısıtlamak. Kurulum her başladığında yeni sır üretmek ve etkinleştirmeyi ilk başarılı koda bağlamak. İlk girişte parola değişikliğini zorunlu kılmak. `reset_2fa` ve rol değişikliğinde kullanıcının tüm oturumlarını iptal etmek.
- Etiket: verified: `services/auth.py:256-262,282-285`, `api/admin/people.py:163-172`.

### AUTH-03: `env` serbest metin; üretim validator'ı yalnızca tam `"prod"` değerinde çalışıyor, kapsamında boşluklar var

- Kategori: OWASP A05:2021 Security Misconfiguration; CWE-1188 (Insecure Default Initialization of Resource), CWE-798 (Use of Hard-coded Credentials)
- Önem: Orta. Tek başına istismar edilemez, bir yapılandırma hatası gerekir. Ama hata yapılırsa kimlik doğrulama tamamen aşılır. `env` için `"production"`, `"staging"` veya `"Prod"` gibi bir değer verilirse validator hiç çalışmaz. Bu durumda: gömülü dev JWT anahtarı kabul edilir (jeton sahteciliği); `sms_provider=console` ise OTP kodu API yanıtında (`dev_code`) döner, yani herhangi bir telefonla giriş yapılabilir; `payment_provider=fake` ise kimliksiz `POST /payments/fake/{oid}/complete` ile ödeme onaylanabilir; `/docs` açılır.
- Etkilenen yer:
  - `backend/app/config.py:24` (`env: str = "dev"`, `Literal` değil)
  - `backend/app/config.py:114-130` (validator yalnızca `self.env == "prod"`)
  - `backend/app/services/otp.py:78` (`dev_code` koşulu `env != "prod"`)
  - `backend/app/api/payments.py:62-66,81-92` (sahte ödeme onayı kimliksiz, koşul `env == "prod"`)
  - `backend/app/main.py:24-26` (docs koşulu)
- Validator'ın kapsam boşlukları (`env == "prod"` iken bile):
  - `sms_provider == "console"` reddedilmiyor. Üretimde OTP kodları SMS yerine WARNING seviyesinde loga yazılır (`providers/sms.py:30`, recon 4.1). Log erişimi olan herkes her hesaba girebilir.
  - `jwt_secret` için yalnızca dev değere eşitlik ve boşluk kontrol ediliyor; uzunluk veya entropi alt sınırı yok (örneğin 8 karakterlik bir değer kabul edilir). `blind_index_key` (OTP HMAC anahtarı da bu) için de aynı durum geçerli.
  - `paytr_test_mode` varsayılanı `True` (`config.py:95`) ve üretimde reddedilmiyor (ödeme alanına bırakıldı).
  - `FakeProvider` imza anahtarı olarak `jwt_secret` kullanıyor (`providers/payments.py:224`): anahtar ayrımı yok. Mevcut mesaj biçiminde JWT imzasıyla çakışma yolu bulamadım; yalnızca dev ortamında geçerli.
- İstismar (kavramsal): Staging ortamı `GETAWAY_ENV=staging` ve konsol SMS ile internete açılır. Saldırgan kurbanın telefon numarasıyla `/auth/otp/request` çağırır, yanıttaki `dev_code` ile `/auth/otp/verify` yaparak kurbanın müşteri veya sürücü hesabına girer.
- Önerilen düzeltme: `env: Literal["dev", "test", "prod"]` tanımlamak (bilinmeyen değerde uygulama açılmasın). `dev_code`, sahte ödeme ve docs için izin listesi koşulu kullanmak (`env in {"dev", "test"}`); "prod değilse" koşulu kullanmamak. Prod validator'ına şunları eklemek: `sms_provider != "console"`, `paytr_test_mode is False` (ödeme sağlayıcısı PayTR ise), `jwt_secret` ve `blind_index_key` için en az 32 bayt kontrolü. Sahte sağlayıcıya ayrı bir anahtar vermek.
- Etiket: verified: `config.py:24,114-139`, `otp.py:78`, `payments.py:62-96`. Hangi ortam adlarının gerçekte kullanıldığı (staging var mı): belief.

### AUTH-04: OTP isteğinde IP ve genel sınır yok (SMS pumping / maliyet)

- Kategori: OWASP API4:2023 Unrestricted Resource Consumption; CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-799
- Önem: Orta. Sınır yalnızca telefon başına uygulanıyor (saatte 5). `normalize_phone` her E.164 numarayı kabul ettiği için uluslararası ve premium numaralar da geçiyor. Bir saldırgan çok sayıda farklı numara için kimliksiz istek gönderip Netgsm faturasını şişirebilir (SMS pumping / toll fraud), birçok kişiye SMS bombardımanı yapabilir. Hesap ele geçirme riski yok: telefon başına saatte en fazla 5 kod x 5 deneme = 25 tahmin, 6 haneli kodda olasılık yaklaşık 2.5e-5. Bu nedenle önem Yüksek değil.
- Etkilenen yer:
  - `backend/app/services/otp.py:55-63` (sayım yalnızca `phone_hash` üzerinden; `ip` yalnızca kayda yazılıyor, satır 71)
  - `backend/app/api/auth.py:80-91`
  - `backend/app/security/crypto.py:52-59` (ülke kısıtı yok)
- İstismar (kavramsal): Bot, farklı ülke kodlarındaki ücretli numaralara dakikada binlerce `/auth/otp/request` gönderir. Her istek bir SMS gönderimi tetikler.
- Önerilen düzeltme: IP başına ve /24 (IPv6 için /64) blok başına dakikalık ve saatlik Redis sayacı; ülke kodu izin listesi (iş modelindeki müşteri ülkeleri) ya da ülke başına sınır; saatlik genel SMS bütçesi ve aşımda alarm; şüpheli trafikte CAPTCHA veya cihaz doğrulaması. Not: IP sınırının işe yaraması için AUTH-05 de düzeltilmeli.
- Etiket: verified: `otp.py:43-79` okundu; `grep TooManyRequests` sonuçları (AUTH-01'deki komut) IP tabanlı bir sayım göstermedi.

### AUTH-05: `client_ip` istemcinin gönderdiği `cf-connecting-ip` başlığına koşulsuz güveniyor

- Kategori: OWASP A04:2021 Insecure Design; CWE-348 (Use of Less Trusted Source), CWE-290
- Önem: Orta. Backend'in Cloudflare dışından erişilemediğine dair repoda bir yapılandırma yok. Mobil uygulama backend'e doğrudan bağlanıyor (recon 1). Başlık sahte olabildiği için: IP başına Places sınırı (`places.check_rate_limit`, ücretli Google API) her istekte farklı başlıkla aşılabilir; denetim kayıtlarındaki IP (`staff.login_failed`, `staff.login`, KVKK onay kaydı `consents.ip`) sahte olabilir; PayTR'a giden `user_ip` sahte olabilir; AUTH-04 için önerilen IP sınırı da atlatılabilir. BFF'ler de gelen `cf-connecting-ip` veya `x-forwarded-for` başlığını doğrulamadan iletiyor.
- Etkilenen yer:
  - `backend/app/api/deps.py:29-31`
  - `backend/app/api/public.py:104-132` (`check_rate_limit(ip)`)
  - `backend/app/api/customer.py:124-126` (`user_ip=ip` ödeme sağlayıcısına)
  - `web/app/bff/[...path]/route.ts:48-49,73-74`, `admin/app/bff/[...path]/route.ts:56-57`
- İstismar (kavramsal): Saldırgan backend'e doğrudan bağlanıp her istekte rastgele bir `cf-connecting-ip` değeri gönderir. Places sınırı hiç dolmaz ve Google faturası büyür. Ya da admin girişinde başka bir IP göstererek denetim izini yanıltır.
- Önerilen düzeltme: Güvenilir vekil listesi tanımlamak (ayar: Cloudflare IP aralıkları ve BFF sunucusunun adresi). Başlığı yalnızca `request.client.host` bu listedeyse okumak; aksi halde soket adresini kullanmak. Backend kaynağını yalnızca Cloudflare ve BFF'den erişilebilir yapmak (firewall veya Authenticated Origin Pulls). BFF'nin backend'e ilettiği IP başlığını paylaşılan bir sırla imzalamak ya da ayrı bir iç başlık kullanmak.
- Etiket: verified: `deps.py:29-31`, `public.py:109,125,132`, BFF satırları okundu. Üretimde backend'in doğrudan erişilebilir olduğu: belief (dağıtım yapılandırması repoda yok).

### AUTH-06: Askıya alınan sürücü atanmış işlere ve yolcu verisine erişmeye devam ediyor

- Kategori: OWASP A01:2021 Broken Access Control; CWE-285 (Improper Authorization), CWE-613
- Önem: Orta. `CurrentDriver` sürücü durumunu (APPROVED, SUSPENDED vb.) kontrol etmiyor. Onay kontrolü yalnızca çevrimiçi olma (`driver.py:101`), iş havuzu (`dispatch.py:402`) ve kabul (`eligible_candidates`, `dispatch.py:117`) yollarında var. `set_driver_status` sürücüyü askıya alırken yalnızca `is_online=False` yapıyor; atanmış bacaklar sürücüde kalıyor ve oturumlar açık kalıyor. Askıya alınan sürücü (örneğin şikâyet veya güvenlik nedeniyle) şunları yapmaya devam eder: yolcu adını, tam alış/varış adresini ve koordinatlarını görmek; konum göndermek; müşteriyle mesajlaşmak; yolculuğu ilerletip bitirmek ve hakediş kaydı oluşturmak (`_on_leg_finished`). Kişisel veri ve yolcu güvenliği etkilendiği için önem Orta.
- Etkilenen yer:
  - `backend/app/api/deps.py:85-89` (`current_driver` durum kontrolü yok)
  - `backend/app/services/documents.py:95-114` (`set_driver_status`: bacak ataması kaldırılmıyor, oturum iptal yok)
  - `backend/app/api/driver.py:333-391` (`/trips`, `/trips/{leg_id}`, `/events`, `/location` yalnızca `leg.driver_id == driver.id` kontrol ediyor)
  - `backend/app/api/trips.py:153-157,229-245` (`_own_leg` ve sohbet uçları)
  - `backend/app/services/dispatch.py:301-341` (`advance_trip` durum kontrolü yok)
- İstismar (kavramsal): Operasyon, yolcu şikâyeti üzerine sürücüyü askıya alır. Sürücü uygulamasında yarınki atanmış işin yolcu adı ve ev adresi görünmeye devam eder, işe gidebilir ve yolculuğu başlatıp bitirebilir.
- Önerilen düzeltme: Sürücü uçlarını iki bağımlılığa ayırmak: profil, belge ve araç uçları için `CurrentDriver`; iş, yolculuk, konum ve sohbet uçları için `ApprovedDriver` (durum APPROVED değilse 403). Askıya alma veya reddetmede ileri tarihli ve aktif bacakları `PENDING` durumuna geri almak (yeniden eşleştirme) ve operasyona uyarı üretmek. İsteğe bağlı olarak sürücü oturumlarını kapatmak.
- Etiket: verified: belirtilen satırlar okundu. Askıya alınan sürücünün ekranda bu verileri gerçekten gördüğü: mobil istemci okunmadı, belief (API tarafı verified).

### AUTH-07: TOTP kodu ve MFA ara jetonu tekrar kullanılabiliyor

- Kategori: OWASP A07:2021; CWE-294 (Authentication Bypass by Capture-replay)
- Önem: Düşük. `pyotp.TOTP.verify(..., valid_window=1)` son kullanılan zaman adımını kaydetmiyor. MFA jetonunda `jti` yok ve jeton tek kullanımlık değil. Aynı MFA jetonu ve aynı kod yaklaşık 90 sn içinde tekrar gönderilerek ikinci bir bağımsız oturum açılabilir. İstismar için kullanıcının trafiğini veya ekranını gözlemlemek (omuz üstü, kötü amaçlı eklenti, BFF logu) gerekiyor; bu yüzden Düşük.
- Etkilenen yer: `backend/app/services/auth.py:265-288`, `backend/app/security/tokens.py:44-53`; modelde son TOTP adımı alanı yok (`backend/app/models/identity.py`, recon 3.5).
- İstismar (kavramsal): Saldırgan, personelin giriş isteğindeki MFA jetonunu ve kodu yakalayıp aynı pencere içinde tekrar gönderir ve kendi oturumunu açar.
- Önerilen düzeltme: `users.totp_last_step` alanı eklemek ve doğrulamada `timecode <= last_step` olan kodları reddetmek. MFA jetonuna `jti` ekleyip başarılı kullanımdan sonra Redis'te iptal listesine almak.
- Etiket: verified: `services/auth.py:278`, `tokens.py:44-53`; AUTH-01'deki grep `last_totp|used_code` desenini bulamadı.

### AUTH-08: Yenileme jetonunda yeniden kullanım tespiti yok; personel oturumu da 30 gün

- Kategori: OWASP A07:2021; CWE-613, CWE-384
- Önem: Düşük. Rotasyon var, ama eski jeton gelince yalnızca 401 dönüyor; oturum ailesi iptal edilmiyor. Çalınan bir yenileme jetonunu meşru kullanıcıdan önce kullanan saldırgan oturumu kalıcı olarak üstlenir. Meşru kullanıcı yalnızca "oturum geçersiz" görür ve sistem bunu bir saldırı işareti olarak değerlendirmez. Personel için de `jwt_refresh_days=30` geçerli. Admin BFF çerezi 12 saat tutuluyor, ama sunucu tarafındaki oturum 30 gün açık kalıyor. Yenileme uçlarında boşta kalma (idle) zaman aşımı da yok. Jetonu çalmak için ayrı bir açık gerektiği için Düşük.
- Etkilenen yer: `backend/app/services/auth.py:60-77`, `backend/app/config.py:37`, `admin/app/bff/[...path]/route.ts:10-11` (recon 3.1)
- İstismar (kavramsal): Mobil cihaz yedeğinden veya loglardan elde edilen yenileme jetonu saldırgan tarafından kullanılır. Kullanıcı tekrar OTP ile girer ve yeni bir oturum açar, ama saldırganın oturumu 30 gün boyunca açık kalır.
- Önerilen düzeltme: Bir önceki jeton özetini (`previous_refresh_hash`) saklamak; eski jeton gelirse oturumu iptal edip denetim kaydı yazmak. Personel oturumları için kısa mutlak ömür (ör. 12 saat) ve boşta kalma süresi (`last_used_at`) tanımlamak.
- Etiket: verified: `services/auth.py:60-77`.

### AUTH-09: WebSocket canlı konum akışı yalnızca bağlantı anında doğrulanıyor

- Kategori: OWASP A01:2021; CWE-613
- Önem: Düşük. Erişim jetonu ve oturum yalnızca ilk mesajda kontrol ediliyor. Döngü süresiz olarak her 3 sn'de sürücü konumunu gönderiyor. Çıkış, oturum iptali, 30 dk'lık jeton süresinin dolması, hesabın pasifleştirilmesi veya anonimleştirilmesi (`people.py:107-114` oturumları iptal ediyor) açık bağlantıyı kesmiyor. Etki, zaten yetkili olmuş bir istemciyle ve aktif yolculuk süresiyle sınırlı, bu yüzden Düşük. İstisna: `except Exception` dalı hata durumunda 4401 kodunu bu döngü için de kullanıyor, ama oturum durumu yeniden kontrol edilmiyor.
- Etkilenen yer: `backend/app/api/customer.py:270-282`
- İstismar (kavramsal): Kullanıcı çalınan telefonundaki oturumu başka bir cihazdan kapatır (veya destek ekibi kapatır). Çalınan cihazda açık kalan uygulama sürücünün canlı konumunu almaya devam eder.
- Önerilen düzeltme: Döngüde her N saniyede bir `get_active_session` ile oturumu ve `exp` değerini yeniden kontrol etmek; süresi dolunca 4401 ile kapatmak. Bağlantıya azami ömür koymak.
- Etiket: verified: `customer.py:267-286`.

### AUTH-10: 2FA adımında kullanıcı durumu kontrol edilmiyor

- Kategori: CWE-285 / CWE-863 (Incorrect Authorization)
- Önem: Düşük. `staff_verify_2fa`, `user.status` alanını kontrol etmiyor. Parola adımından sonraki 5 dk içinde pasifleştirilen bir personel 2FA'yı tamamlayabilir. Bu durumda yeni bir `sessions` satırı ve `staff.login` denetim kaydı oluşur, `last_login_at` güncellenir. Erişim `get_active_session` (`services/auth.py:96-97`) ve `refresh_session` (satır 68-69) içinde engelleniyor, bu yüzden etkisi denetim izinin yanıltıcı olmasıyla sınırlı.
- Etkilenen yer: `backend/app/services/auth.py:275-288`
- Önerilen düzeltme: `user.status is not UserStatus.ACTIVE` ise `Unauthorized` döndürmek.
- Etiket: verified: `services/auth.py:275-277`.

---

## Kontrol edilip sorun bulunmayanlar (negatifler)

- Müşteri nesne düzeyi erişimi: `/me/bookings/{code}` ailesinin tümü (detay, iptal önizleme, iptal, ödeme başlatma, sürücü konumu, mesajlar, okunmamış, bitirme, ETA) ve WebSocket, `_own_booking` ile `booking_code` + `customer_id` eşleşmesi kullanıyor. Liste, onay, KVKK talebi ve güncellemeler `customer.id` ile süzülüyor. verified: `customer.py:48-54,87-137,211-249,276`, `trips.py:248-300,333-335`.
- Sürücü nesne düzeyi erişimi: `/trips/{leg_id}`, `/events`, `/location`, `/approach`, mesaj uçları `leg.driver_id == driver.id` kontrol ediyor. Teklif kabul ve ret `offer.driver_id` kontrol ediyor. Belge yüklemede `vehicle_id` sahipliği `_own_vehicle` ile doğrulanıyor. Kazanç `DriverLedger.driver_id` ile, güncellemeler `recipient_id` ile süzülüyor. verified: `driver.py:122-125,186-189,341-391,403-415`, `dispatch.py:226-260,309-310`, `trips.py:153-157,315-335`.
- İş havuzu ve iş kabulü: onaysız sürücü havuzu göremiyor (`dispatch.py:402`) ve kabul edemiyor (`eligible_candidates` `Driver.status == APPROVED`, `dispatch.py:117`). `job_for` uygun olmayan sürücüye 404 dönüyor. `decline_job` herhangi bir bacak için yalnızca sürücünün kendi REJECTED kaydını oluşturuyor; başkasını etkilemiyor. verified: `dispatch.py:401-466`.
- Admin rol zinciri: 72 admin ucunun tamamında rol bağımlılığı var (recon AST çıktısı). Okuduğum uçlarda (operations, people, fleet, finance export) rol beklentiyle uyumlu; hassas işlemler (personel, anonimleştirme, ayarlar, fiyat kuralı) `AdminOnly`. İade tutarı `refundable_amount` ile sınırlı (`bookings.py:449`). verified: `deps.py:95-118`, `people.py`, `operations.py:190-228`.
- Erişim jetonu: her istekte oturum DB'den kontrol ediliyor (iptal anında etkili); `typ` kontrolü MFA jetonunun erişim jetonu olarak kullanılmasını engelliyor; algoritma `HS256` olarak sabit (`alg=none` / algoritma karışıklığı yok); yetki kararları JWT'deki `kind` değerinden değil, DB'deki `user.kind` ve roller üzerinden veriliyor. verified: `tokens.py:56-63`, `deps.py:48-61,100-105`.
- Personel girişinde kullanıcı numaralandırma: kullanıcı yoksa da Argon2 hesaplanıyor, hata mesajı aynı. verified: `services/auth.py:249-253`, `passwords.py` (recon).
- Müşteri ve sürücü OTP doğrulaması: `FOR UPDATE`, deneme sayacı commit ediliyor, `compare_digest` kullanılıyor, kod HMAC olarak saklanıyor; kaba kuvvetle ele geçirme pratik değil (AUTH-04'teki hesap). verified: `otp.py:82-110`, `auth.py:101-105`.
- Push jetonu bağlama: aynı model içinde jeton tek hesaba taşınıyor; çıkışta yalnızca kendi kaydı siliniyor. Başkasının FCM jetonunu bilen bir kullanıcı onu kendi hesabına alabilir, ama jeton gizli bir cihaz değeri olduğu için bulgu yazmadım. verified: `notifications.py:113-131`.
- Personel rol değişikliği hemen etkili: roller her istekte `principal.user` (DB) üzerinden okunuyor. verified: `deps.py:100-105`.

## Kapsam dışı gözlemler (ilgili alana iletilmeli)

- CSV formül enjeksiyonu: `/admin/payouts/export.csv`, sürücünün kayıtta serbestçe girdiği `full_name` alanını kaçışlamadan yazıyor (`finance.py:168-171`, `driver.py:47,80`). `=`, `+`, `-`, `@` ile başlayan değerler muhasebe bilgisayarında Excel formülü olarak çalışabilir. Önem tahmini: Orta, doğrulanmadı.
- Belge geçerlilik tarihi: sürücünün gönderdiği `valid_until`, inceleyen kişi değiştirmezse onaylanıyor (`documents.py:81`). İş mantığı konusu, doğrulanmadı.
- `update_staff` içinde `roles: []` gönderilirse kendi admin rolünü kaldırma koruması atlanıyor (`people.py:161`, `body.roles and ...` boş listeyi yanlış sayıyor). Güvenlik etkisi yok, yalnızca kendini kilitleme riski.

## Atlananlar ve doğrulanmayanlar

- `admin/catalog.py`, `admin/manual_bookings.py`, `admin/trip_review.py`, `admin/common.py` satır satır okunmadı; rol bağımlılıkları recon AST çıktısına dayanıyor. `manual_bookings` `resend-sms` ve `customers/lookup` uçlarındaki veri maskeleme yalnızca grep ile görüldü (`manual_bookings.py:74-78` maskeli).
- `services/bookings.py` (`cancel_booking` durum kuralları), `services/payments.py` (`start_payment`) yalnızca seçili satırlarda okundu. Sahiplik API katmanında sağlanıyor; servis içindeki ek kontroller okunmadı.
- `models/identity.py` içindeki `role_codes` özelliği okunmadı; DB'deki rollerden türetildiği varsayıldı (belief).
- BFF'lerin yenileme akışı (yenileme yarışı, çerez yönetimi) ve mobil istemcide jeton saklama ayrıntıları okunmadı.
- Dinamik test yapılmadı; sınır ve kilit eksikliği yalnızca kod okumasıyla tespit edildi.
