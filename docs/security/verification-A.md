# Bağımsız bulgu doğrulaması A: auth.md, api.md, resilience.md

- Tarih: 2026-11-12
- Dal / taban: `claude/security-audit-hardening-5c0e1f` / `0f13f2b`
- Yöntem: statik okuma. Bulgulardaki dosya:satır referansları tek tek açıldı. Servis çalıştırılmadı, kod değiştirilmedi. Tek dinamik kontrol: Node `new URL()` ile `..` ve `%2e%2e` segmentlerinin normalleştirilmesi (API-13).
- Kapsam: 41 bulgu (AUTH-01..10, API-01..16, MON-01..15).
- Secret değeri yazılmadı.

## Karar dağılımı

| Karar | Adet |
|---|---|
| DOĞRULANDI | 27 |
| YANLIŞ POZİTİF | 0 |
| MÜKERRER | 13 |
| BELİRSİZ | 1 |

## Tablo

| ID | Karar | Kanonik ID | Önerilen önem | Gerekçe |
|---|---|---|---|---|
| AUTH-01 | DOĞRULANDI (kanonik) | - | Yüksek (aynı) | `services/auth.py:250-253` ve `:278-281` başarısızlıkta yalnızca `audit.record` yapıyor. `api/auth.py:147-175` uçlarında sınır yok. `tokens.py:44-53` MFA jetonunda jti yok. 3/10^6 olasılıkla beklenen ~333 bin deneme, 300 istek/sn hızda yaklaşık 20 dk sürer, yani bulgunun "saatler" tahmini iyimser. API-05 ve MON-04'teki Argon2 CPU/bellek tüketimi bu kanonik bulguya eklenmeli. |
| AUTH-02 | DOĞRULANDI | - | Orta (aynı) | `services/auth.py:257-261` sır yalnızca yoksa üretiliyor ve parola sonrası `provisioning_uri` dönüyor. `admin/people.py:170-172` `reset_2fa` oturumları kapatmıyor, `:167-169` DISABLED dalı kapatıyor. Küçük düzeltme: saldırgan 2FA'yı önce etkinleştirirse meşru kullanıcı kurulum ekranı görmez ve durumu fark eder. Fark edilmeme yalnızca ikisi de aynı sırrı kurulum penceresinde aldığında geçerli. |
| AUTH-03 | DOĞRULANDI | - | Yüksek (Orta'dan) | `config.py:24` serbest metin, varsayılanı `"dev"`. `config.py:116` validator yalnızca tam `"prod"` değerinde çalışıyor. `otp.py:78`, `payments.py:64` ve `main.py:24-26` hep "prod değilse" koşulunu kullanıyor. `sms_provider` prod validator'ında yok. Varsayılan güvensiz (fail-open): tek bir yazım hatası güvenlik ağını sessizce kapatıyor. Bunun sonucu sahte ödeme onayı ve `dev_code` ile hesap ele geçirme olabiliyor. Bu yüzden BIZ-01 ile aynı düzeyde, Yüksek önerilir. |
| AUTH-04 | DOĞRULANDI (kanonik) | - | Yüksek (Orta'dan) | `otp.py:56-63` sayım yalnızca `phone_hash` üzerinden. `crypto.py:22` her E.164 numarayı kabul ediyor. `providers/sms.py:35-36` notu uluslararası gönderimin açılmasının planlandığını gösteriyor. Kimliksiz, otomatikleştirilmesi kolay ve doğrudan maliyet doğuruyor; bu yüzden API-01 ve MON-02 ile aynı biçimde Yüksek önerilir. |
| AUTH-05 | DOĞRULANDI (kanonik) | - | Orta (aynı) | `deps.py:29-31` başlığa koşulsuz güveniyor. `places.py:108` sayaç anahtarı IP'ye bağlı. `customer.py:126` `user_ip` PayTR'a gidiyor. BFF'ler `admin/.../route.ts:56-57` ve `web/.../route.ts:48-49,73-74` başlığı olduğu gibi aktarıyor. Mobil uygulama doğrudan `api.getawaytransfers.com` adresine bağlanıyor (`mobile/eas.json:15`). Cloudflare bu başlığı üzerine yazar, ama origin'in doğrudan erişilebilir olup olmadığı repodan bilinemiyor. Orta uygun. |
| AUTH-06 | DOĞRULANDI | - | Orta (aynı) | `deps.py:85-89` durum kontrolü yok. `documents.py:109-112` yalnızca `is_online=False` yapıyor. `driver.py:341-391` ve `trips.py:153-157` yalnızca sahiplik kontrol ediyor. `driver.py:258-287` `_trip_out` yolcu adı, adres ve koordinatı dönüyor. `dispatch.py:301-341` `advance_trip` sürücü durumuna bakmıyor. Askıya alma yolu yalnızca `admin/fleet.py:79-81`. |
| AUTH-07 | DOĞRULANDI | - | Düşük (aynı) | `services/auth.py:278` `verify(valid_window=1)` son adımı kaydetmiyor. `tokens.py:44-53` jti yok ve jeton iptal edilmiyor. Aynı jeton ve kodla pencere içinde ikinci oturum açılabilir. |
| AUTH-08 | DOĞRULANDI (kanonik) | - | Düşük (aynı) | `services/auth.py:60-77` rotasyon var, eski jeton yalnızca 401 alıyor ve oturum ailesi iptal edilmiyor. `config.py:37` 30 gün. `admin/.../route.ts:11` çerez 12 saat. |
| AUTH-09 | MÜKERRER | MON-07 | Düşük | `customer.py:270-282` jeton yalnızca ilk mesajda doğrulanıyor ve döngüde yeniden kontrol yok. Aynı tespit MON-07'nin (c) maddesinde daha geniş bağlamda (DoS, senkron DB, sessiz hata) yer alıyor. |
| AUTH-10 | DOĞRULANDI | - | Bilgi (Düşük'ten) | `services/auth.py:275-277` `user.status` kontrol edilmiyor. Erişim `get_active_session` (`:96-97`) ve `refresh_session` (`:68-69`) içinde engelleniyor. Etki yalnızca yanıltıcı `staff.login` kaydı ve `last_login_at` güncellemesi, yetki kazanımı yok. |
| API-01 | MÜKERRER | AUTH-04 | Yüksek | Kanıt aynı: `otp.py:56-63`, `crypto.py:22`, `api/auth.py:80-91`. |
| API-02 | MÜKERRER | AUTH-01 | Yüksek | Aynı kod yolu (`services/auth.py:265-288`), AUTH-01'in 2FA kısmı. |
| API-03 | MÜKERRER | AUTH-05 | Orta | Aynı kod (`deps.py:29-31`, BFF satırları). |
| API-04 | MÜKERRER | MON-03 | Orta | Doğru tespit: `public.py:97-100` sınır yok, `:109` var. `routing.py:81-82` dolunca `clear()`. MON-03 daha ayrıntılı (`quotes.py:177,183`, N² çift, worker başına önbellek). |
| API-05 | MÜKERRER | AUTH-01 | Orta (AUTH-01'e ek boyut) | `services/auth.py:249` kullanıcı yoksa da Argon2 çalışıyor, `passwords.py:8` varsayılan `PasswordHasher()`. Kaba kuvvet kısmı AUTH-01 ile aynı. Argon2 kaynak tüketimi (CWE-400) AUTH-01'e ek etki olarak birleştirilmeli. |
| API-06 | DOĞRULANDI (kanonik) | - | Orta (aynı) | `services/payments.py:100-111` `db.add(hook)`, ardından geçersiz imzada `db.commit()` ve exception. `providers/payments.py:79-80` `mask_payload` bilinmeyen alanları da kopyalıyor. `api/payments.py:23` tüm form alanlarını alıyor. Yalnızca PayTR etkinken erişilebilir (`:25-26`). |
| API-07 | DOĞRULANDI (kanonik) | - | Orta (aynı) | `driver.py:113-139` boyut kontrolü `file.read(MAX+1)` ile, gövde alındıktan sonra yapılıyor. `driver.py:70-86` kayıt onay istemiyor. `documents.py:45-64` adet/kota yok. Starlette'in dosyayı spool etmesi kütüphane davranışı, burada ölçülmedi. |
| API-08 | DOĞRULANDI | - | Düşük (aynı) | `alembic/versions/20261029_0001_initial_schema.py:98,183,266-267,356` `ip String(45)` ve `device_info String(255)`. `api/auth.py:99,167` UA sınırsız. PostgreSQL varchar taşmasında hata verir, bu da 500 döner. Saldırgan yalnızca kendi isteğini bozuyor. |
| API-09 | DOĞRULANDI | - | Düşük (aynı) | `api/auth.py:47,62` jeton alanları sınırsız. `schemas.py:108-110,167,171` kod, tarih, tutar ve locale alanlarında sınır yok. `quotes.py:180` `pickup_at + timedelta` uç tarihte `OverflowError` verebilir. Doğrudan istismar yok. |
| API-10 | DOĞRULANDI | - | Düşük (aynı) | `providers/payments.py:137` PayTR `reason` değeri `ServiceUnavailable` mesajına giriyor. `main.py:36-41` mesajı olduğu gibi döndürüyor (`errors.py:45` DomainError alt sınıfı). |
| API-11 | DOĞRULANDI | - | Düşük (aynı) | `services/payments.py:110` `%s` ile saldırgan kontrolündeki `merchant_oid` loglanıyor. CR/LF temizlenmiyor ve yapılandırılmış log yok (MON-09). |
| API-12 | MÜKERRER | AUTH-03 | Düşük | `api/payments.py:62-66,81-96` kimliksiz sahte onay. AUTH-03 "prod değilse" senaryosunu ve bu ucu zaten kapsıyor. Kümeler arası BIZ-01 de aynı (bkz. alt bölüm). |
| API-13 | BELİRSİZ | (kümeler arası WEB-01) | Orta (Düşük'ten, WEB-01 ile uyumlu) | Regex `admin/.../route.ts:13,88-89` ve `web/.../route.ts:14-23,103-104` birleştirilmiş yolda uygulanıyor. Node'da `new URL("http://h/api/v1/me/%2e%2e/driver/me").pathname` sonucu `/api/v1/driver/me`, yani fetch tarafı doğrulandı. Next 15.5'in catch-all parametrelerini çözüp çözmediğini bu worktree'de göremedim (`node_modules` yok). Gereken dinamik test: çalışan Next sunucusunda `GET /bff/me/..%2Fdriver%2Fme` isteği gönderilip backend erişim logu kontrol edilmeli. WEB-01, jetonların JS'e dönmesi etkisini de bulduğu için önem Orta olmalı. |
| API-14 | DOĞRULANDI | - | Bilgi (aynı) | `documents.py:24-30,45-50` izin listesi ve sihirli bayt kontrolü. `admin/fleet.py:205-206` `inline`. `admin/next.config.ts:4,13,21` nosniff ve CSP. Olumlu tespit. |
| API-15 | DOĞRULANDI | - | Bilgi (aynı) | `providers/payments.py:144-145` formül ve `compare_digest`. `services/payments.py:113-121` FOR UPDATE ve PENDING idempotentliği. `:150` sayısal olmayan tutar `None` olunca `:129` kontrolü atlanıyor; BIZ-07 ile örtüşüyor. |
| API-16 | DOĞRULANDI | - | Bilgi (aynı) | `main.py:36-49` işleyiciler girdiyi yansıtmıyor, `debug` yok, `:24-26` docs prod'da kapalı. `config.py:21` tek `extra=` eşleşmesi. |
| MON-01 | MÜKERRER | AUTH-05 | Orta (Yüksek'ten) | Aynı kod (`deps.py:29-31`, `places.py:108`, BFF). `.vscode/tasks.json:42-43` `0.0.0.0` yalnızca geliştirme görevi. Prod topolojisi bilinmediği için Yüksek abartılı. AUTH-05 ve API-03 Orta. |
| MON-02 | MÜKERRER | AUTH-04 | Yüksek | Aynı kanıt. Ek bilgi: her istek bir `otp_challenges` satırı yazıyor (`otp.py:66-76`). |
| MON-03 | DOĞRULANDI (kanonik) | - | Orta (Yüksek'ten) | `public.py:97-100` sınır yok. `quotes.py:177,183` bir veya iki rota çağrısı. `routing.py:67-84` 512 kayıtlı süreç içi önbellek, dolunca `clear()`. `routing.py:117` `lru_cache` worker başına. Etki yalnızca maliyet ve Google tarafında kota/bütçe ile sınırlanabiliyor, veri etkisi yok. Orta, API-04 ile uyumlu. |
| MON-04 | MÜKERRER | AUTH-01 | Yüksek (AUTH-01) | Aynı uçlar ve satırlar. Argon2 CPU boyutu API-05 ile birlikte AUTH-01'e eklenmeli. |
| MON-05 | MÜKERRER | API-06 | Orta | Aynı kod (`services/payments.py:99-111`). Ek değer: kaynak IP saklanmıyor ve alarm yok; API-06'ya eklenmeli. |
| MON-06 | MÜKERRER | API-07 | Orta | Aynı kod (`driver.py:113-139`, `documents.py:45-64`). Ek değer: `main.py` içinde gövde boyutu middleware'i yok ve her yükleme `audit_logs` satırı üretiyor (`documents.py:62`). |
| MON-07 | DOĞRULANDI (kanonik) | - | Orta (aynı) | `customer.py:270` `accept()` kimlikten önce, `:272` 10 sn. `:273-281` `async def` içinde senkron `SessionLocal` ve Redis (`live_location.py:46`). `:278-282` oturum yeniden kontrol edilmiyor. `:285-286` istisna loglanmıyor. Kümeler arası RT-03, RT-04 ve RT-05 ile aynı. |
| MON-08 | DOĞRULANDI | - | Orta (aynı) | Kod tabanındaki `action="..."` listesinde OTP, refresh, 403 ve müşteri PII okuma olayları yok. `docs/yasal_ve_guvenlik.md:24` "Her erişim audit_logs'a yazılır" diyor. |
| MON-09 | DOĞRULANDI | - | Orta (aynı) | `backend/app` ve `requirements.txt` içinde sentry/opentelemetry/basicConfig/dictConfig yok. `main.py:16` `log` kullanılmıyor. `worker.py:27-41` alarm işi yok. |
| MON-10 | DOĞRULANDI | - | Düşük (Orta'dan) | `cli.py:20-27` toplu iptal komutu yok. `tokens.py:41,58` tek anahtar ve `kid` yok. `places.py:83` ve `providers/payments.py:224` aynı `jwt_secret` kullanılıyor. `crypto.py:47-49` sürümsüz blind index. Maddeler doğru ama doğrudan istismar yolu yok; bir kısmı başka bulguların kopyası (sürücü askıya alma AUTH-06, WS MON-07, anahtar paylaşımı AUTH-03, blind index DB-09). Kalan kısım süreç ve hazırlık eksikliği, bu yüzden Düşük. |
| MON-11 | MÜKERRER | AUTH-08 | Düşük | Aynı kod (`services/auth.py:60-77`). İzleme ve alarm boyutu AUTH-08'e eklenmeli. |
| MON-12 | DOĞRULANDI | - | Düşük (aynı) | `trips.py:160-170` her çağrıda `route(at, target)` yapılıyor, sınır yok. Düzeltme: "onaylı sürücü gerekir" ifadesi yanlış. `CurrentDriver` onay kontrolü yapmıyor (AUTH-06) ve bacak durumu da kontrol edilmiyor, yani tamamlanmış bacaklar da kullanılabiliyor. Önbellek var ama anahtar koordinata bağlı (`routing.py:73`). Değişken koordinatlar paylaşılan önbelleği de temizletebilir. |
| MON-13 | DOĞRULANDI | - | Düşük (aynı) | `admin/common.py:15-16` offset için üst sınır yok. Örnek olarak `admin/operations.py:234-241` (`dispatch/pending`) ve `:282-285` (`drivers/online`) limitsiz, doğrulandı. Listenin geri kalanı tek tek okunmadı. |
| MON-14 | DOĞRULANDI | - | Düşük (aynı) | `worker.py:18-41` `_run` çağrıları ardışık ve try/except yok. Düzeltme: örnek kısmen yanlış. `refresh_flights` dakikalık grubun son işi olduğu için onun hatası başka işi atlatmaz. Ama `purge_flight_data` hatası OTP ve mesaj temizliğini atlatır (`:34-36`). `jobs.py:63-65` yalnızca kur işi kendi hatasını yakalıyor. |
| MON-15 | DOĞRULANDI | - | Bilgi (aynı) | `main.py:60-62` sabit `{"status":"ok"}`. Güvenlik açığı değil, hazır olma sinyali eksik. |

## Notlar (yanlış pozitif yok, ama düzeltilmesi gereken ifadeler)

- AUTH-01: kırılma süresi "saatler" değil, birkaç yüz istek/sn hızda onlarca dakika. Bu, önemi destekliyor.
- AUTH-02: "meşru kullanıcı fark etmez" ifadesi yalnızca ortak kurulum penceresi senaryosunda geçerli.
- MON-12: "onaylı sürücü gerekir" ifadesi yanlış, askıya alınmış veya onaysız ama bacak atanmış sürücü de çağırabilir.
- MON-14: `refresh_flights` örneği yanlış sırada verilmiş.
- Kapsam dışı gözlem: `providers/sms.py:44-53` Netgsm kullanıcı adı ve parolasını GET sorgu dizgisinde gönderiyor. Bu, PRIV-08'in kapsamında.

## Kümeler arası mükerrer adayları

| Bu kümedeki kanonik | Diğer kümedeki aday | Not |
|---|---|---|
| AUTH-05 (API-03, MON-01) | PRIV-09, WEB-02, INF-10 (`0.0.0.0`) | IP sahteciliği. PRIV-09 rıza kanıtı, WEB-02 BFF iletimi açısından. Tek kanonik önerisi: AUTH-05. |
| AUTH-04 (API-01, MON-02) | (MON-02 dışında aday görülmedi) | SMS pompalama. MOB-09 (`dev_code` gösterimi) AUTH-03 ile ilişkili, bu bulguyla değil. |
| AUTH-01 (API-02, API-05, MON-04) | - | Personel kaba kuvvet. Diğer kümelerde başlık düzeyinde aday yok. |
| AUTH-03 (API-12) | INF-01, INF-02, BIZ-01, PRIV-02, INF-13, MOB-09 | env=prod meselesi. INF-01 aynı kök neden. INF-02 validator kapsam boşlukları (SMS, PayTR test modu) AUTH-03'ün alt maddeleriyle aynı. BIZ-01 sahte ödeme etkisi. PRIV-02 konsol SMS'in prod'da loglanması. Kanonik önerisi: INF-01 + INF-02 birleşimi ya da AUTH-03; en ayrıntılı etki listesi AUTH-03'te. |
| MON-07 (AUTH-09) | RT-03, RT-04, RT-05 | WebSocket. RT-03 = (c), RT-04 = (b), RT-05 = (a). realtime kümesi ayrıştırılmış haliyle kanonik olabilir; MON-07 birleşik kayıt. |
| API-13 | WEB-01 | BFF `..` atlatması. WEB-01, Next eşleyicisiyle yerel simülasyon yaptığını belirtiyor ve daha ayrıntılı. Kanonik: WEB-01. |
| API-15 (total_amount notu) | BIZ-07 | `total_amount` sayısal değilse tutar kontrolü atlanıyor, para birimi doğrulanmıyor. |
| AUTH-03 alt maddesi, API-15 notu, MON-10 (anahtar paylaşımı) | DB-09 | `jwt_secret` ve `blind_index_key` çok amaçlı kullanım. DB-09 blind index ve OTP HMAC paylaşımı, MON-10'un blind index rotasyon maddesi. |
| AUTH-06 | PRIV-06, MON-10 (alt madde), RT-07 | Sürücü erişiminin süresi ve kapsamı. PRIV-06 geçmiş yolculuk verisi, RT-07 devredilen bacakta sohbet. İlişkili ama farklı kök neden; birleştirme değil çapraz referans önerilir. |
| MON-08 | PRIV-07, DB-02 | Admin PII okumasının denetime yazılmaması (PRIV-07) ve denetim kaydının değiştirilemezliği (DB-02). |
| AUTH-02 / AUTH-08 | MOB-07 | Çıkışta sunucu oturumunun açık kalması. İlişkili, farklı kök neden. |
| AUTH kapsam dışı: CSV formül enjeksiyonu (`finance.py:168-171`) | business.md, web.md | Başlık düzeyinde aday görülmedi. Atanmamış olabilir, sahiplenilmeli. |
| AUTH kapsam dışı: belge `valid_until` (`documents.py:81`) | business.md | Başlık düzeyinde aday görülmedi. |
