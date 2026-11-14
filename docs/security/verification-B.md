# Bağımsız doğrulama B: db.md, business.md, privacy.md

- Tarih: 2026-11-12, dal `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Yöntem: Her bulgunun gösterdiği dosya:satır yeniden açıldı ve iddia çürütülmeye çalışıldı. Statik okuma yapıldı; servis çalıştırılmadı, kod değiştirilmedi. Secret değerleri yazılmadı.
- Kapsam: 37 bulgu (DB-01..13, BIZ-01..11, PRIV-01..13).

## Karar dağılımı

| Karar | Sayı |
|---|---|
| DOĞRULANDI | 32 (birkaçında kısmi düzeltme var, aşağıda) |
| MÜKERRER | 5 (DB-05, DB-06, DB-10, BIZ-01, PRIV-09) |
| YANLIŞ POZİTİF | 0 (tamamen yanlış olan yok; kısmen yanlış alt iddialar: DB-06, BIZ-02 başlığı, PRIV-08 log zinciri) |
| BELİRSİZ | 0 bulgu tamamen belirsiz değil; BIZ-03 (a)/(b) ve BIZ-08 için dinamik test gerekiyor |

## Tablo

| ID | Karar | Kanonik ID | Önerilen önem | Gerekçe (dosya:satır) |
|---|---|---|---|---|
| DB-01 | DOĞRULANDI | DB-01 | Yüksek → **Orta** | `docker-compose.yml:6-8` ve `.github/workflows/ios-simulator.yml:76` (`CREATE ROLE ... SUPERUSER`) doğru. Uygulama (`backend/app/db.py:10`) ve alembic (`backend/alembic/env.py:18-19,43`) aynı DSN'i kullanıyor. Kodda GRANT/REVOKE yok. Ancak üretim rolü repoda yok, yani bulgu üretim için çıkarım. Kendi başına bir açık değil, başka bir açığın etkisini büyütüyor; bu yüzden Orta. |
| DB-02 | DOĞRULANDI | DB-02 | Orta (DB-01'e bağlı) | Tetikleyiciler `alembic/versions/20261029_0002_audit_logs_immutable.py:19-41`, downgrade bunları düşürüyor (`:44-48`). `created_at` için yalnızca `server_default` var, istemci bu alanı ezebilir (`backend/app/models/ops.py:56`). Hash zinciri yok. "Değiştirilemez" iddiası `docs/yasal_ve_guvenlik.md:24`'te var. DB-01 düzelirse bulgu Düşük'e iner. |
| DB-03 | DOĞRULANDI | DB-03 | Orta → **Düşük** | `backend/tests/conftest.py:14-16` `setdefault` kullanıyor, `:54` `downgrade base` çalıştırıyor. DB adı için koruma yok. Saldırgan senaryosu yok; geliştiricinin kabuğunda prod/staging URL'i tanımlı olması gerekiyor. Kaza riski taşıyan bir hijyen sorunu. |
| DB-04 | DOĞRULANDI | DB-04 (depolama) | Orta | Koordinatlar `backend/app/models/booking.py:126-129` `Numeric(9,6)` düz metin, adresler ise şifreli (`:124-125`). Koordinatlar SQL sorgusunda kullanılmıyor, yalnızca Python'da (`eta.py:57-64`, `route_line.py:46-52`, `dispatch.py:293`). Yani şifrelemenin önünde teknik bir engel yok. PRIV-03/PRIV-06 ile ilişkili ama mükerrer değil: bu bulgu depolamayla, onlar API'den açığa çıkmayla ilgili. |
| DB-05 | MÜKERRER | PRIV-01 | (PRIV-01'de) | Aynı uç (`backend/app/api/admin/people.py:94-117`) ve aynı eksik alan listesi. PRIV-01 ayrıca talep ile anonimleştirme arasındaki bağın kopukluğunu da kapsıyor. |
| DB-06 | MÜKERRER (kısmen abartılı) | PRIV-04 | Düşük → **Bilgi** | `trip_updates.body` düz metin (`booking.py:245`). Ancak bu sütuna sürücünün tam adı değil yalnızca ilk adı yazılıyor (`backend/app/services/trip_updates.py:107` `full_name.split()[0]`). Plaka zaten şifresiz tutuluyor (`fleet.py:63`, DB-07), yani bu yolla şifreli bir değer açığa çıkmıyor. Sütunun asıl sorunu mesaj metni; o da PRIV-04'te. |
| DB-07 | DOĞRULANDI | DB-07 | Düşük | Model satırları doğru. `SENSITIVE_KEYS` içinde `reason` ve `reference` yok (`backend/app/services/audit.py:15-33`). Serbest metin `reason` audit'e yazılıyor: `services/bookings.py:459,482`, `api/admin/trip_review.py:53`, `services/documents.py:114`. `reference` ise `services/payments.py:205`'te yazılıyor. IP saklama kısmı PRIV-05 ve PRIV-09 ile örtüşüyor. |
| DB-08 | DOĞRULANDI (mekanizma) | DB-08 | Düşük | `EncryptedString` (`backend/app/security/crypto.py:80-94`) bağlam ya da AAD kullanmıyor. IBAN dışa aktarımı şifresi çözülmüş değeri kullanıyor (`api/admin/finance.py:168-170`). Bu yüzden şifreli metnin başka satıra kopyalanması senaryosu tutarlı, ama DB yazma yetkisi gerektiriyor. |
| DB-09 | DOĞRULANDI | DB-09 | Düşük | Aynı anahtar hem `blind_index` (`crypto.py:47-49`) hem OTP özeti (`backend/app/services/otp.py:38-40`) için kullanılıyor, alan öneki yok. Alan şifrelemesinde MultiFernet ile rotasyon var (`crypto.py:26-28`); kör indeks anahtarında rotasyon yok. İddia doğru. |
| DB-10 | MÜKERRER | INF-10 | Düşük | `docker-compose.yml:9-10` doğru. INF-10 aynı sorunu Redis ve `0.0.0.0` backend ile birlikte daha geniş ele alıyor. |
| DB-11 | DOĞRULANDI | DB-11 (TLS); kimlik bilgisi kısmı INF-02 | Düşük | `backend/app/db.py:10` içinde `connect_args` yok. Validator (`config.py:114-139`) `database_url` alanını denetlemiyor. `sslmode` aramasında sonuç çıkmadı. Dev parolasıyla açılma kısmı INF-02 ile örtüşüyor. |
| DB-12 | DOĞRULANDI | DB-12 | Bilgi | `docs/yasal_ve_guvenlik.md:28` yedekleme iddiasında bulunuyor. `git grep pg_dump/pgbackrest/wal-g/pg_basebackup` sonuç vermedi. |
| DB-13 | DOĞRULANDI | DB-13 | Bilgi | `backend/app/api/admin/people.py:198` `startswith(action)` autoescape olmadan çağrılıyor. Parametre bağlandığı için SQL enjeksiyonu yok. IP alanı `:209`'da `AnyStaff`'a dönüyor. |
| BIZ-01 | MÜKERRER | INF-01 (AUTH-03, API-12 de aynı kök) | Yüksek → **Orta** | Kod yolu doğru: `config.py:24,91,116,125`; `api/payments.py:62-66,81-92`. Ancak istismar için iki ayrı ayarın birlikte eksik olması gerekiyor: `env` prod değil **ve** `payment_provider` varsayılanda kalmış. `env` yanlış ama `paytr` ayarlıysa `_fake_provider` 404 döner (`payments.py:64`). Ayrıca `FakeProvider.public_api_url` sabit `http://localhost:8000` (`providers/payments.py:224`); gerçek müşteri ödeme sayfasını açamayacağı için bu yanlış yapılandırma hemen fark edilir. Kök neden INF-01; bu bulgu onun (d) maddesi. INF-01 ve AUTH-03 de Orta veriyor. |
| BIZ-02 | DOĞRULANDI (başlık düzeltilmeli) | BIZ-02 (RT-09 da bunun altında) | Orta | `advance_trip` (`backend/app/services/dispatch.py:301-341`) adımlarda zaman ya da asgari süre kontrolü yapmıyor. `pickup_at` ile karşılaştırma yok. Durum geçişleri yalnızca sırayı zorluyor (`:53-58`). "Konumsuz bitirme" iddiası **yanlış**: FINISHED için konum zorunlu (`:320-321` `location_required`), yarıçap kontrolü de var (`:322-328`). Ama konum tamamen istemcinin beyanı: istek gövdesinden ya da Redis'teki son değerden geliyor (`api/driver.py:361-365`). Sürücü hedef koordinatını zaten alıyor (`driver.py:283-284`, `api/trips.py:162-177`). Hakediş bitişte yazılıyor (`dispatch.py:483-493`). Admin "erken bitiş" raporu yalnızca müşteri bitirişlerini kapsıyor (`api/admin/trip_review.py:76-104`), sürücü bitirişlerini değil. RT-09 aynı kök nedeni Bilgi olarak kaydetmiş. |
| BIZ-03 | DOĞRULANDI (kod yolu); PayTR davranışı BELİRSİZ | BIZ-03 | Orta | (a) Bağlantı hatası FAILED olarak yazılıyor (`providers/payments.py:168-172` → `services/bookings.py:507-509`), UNKNOWN durumu yok. Retry sonrası ikinci istek gidiyor (`api/admin/finance.py:68-80`). (b) `retry_refund` yalnızca Refund satırını kilitliyor (`finance.py:70`). FAILED satırlar toplama dahil edilmiyor (`bookings.py:421-428,488-496`). Eşzamanlı `staff_refund` (`bookings.py:443` Payment'ı kilitliyor, ama retry kilitlemiyor) iki kontrolü birden geçebilir. (c) `cancel_booking` sağlayıcıyı işlem içinde çağırıyor (`bookings.py:394`), commit ise sonra yapılıyor (`api/customer.py:119`, `api/admin/operations.py:197`). Commit başarısız olursa yerelde iade kaydı kalmıyor. Dinamik test gerekiyor: PayTR'nin kümülatif iade tavanı, ayrıca (b) için iki eşzamanlı istekle entegrasyon testi. |
| BIZ-04 | DOĞRULANDI | BIZ-04 | Orta | `api/admin/manual_bookings.py:205` (`gt=0`, üst sınır yok). `services/bookings.py:76-87,158-161`: yalnızca gerekçe zorunlu. Oluşturma ve elle tahsilat aynı `OpsStaff` rolünde (`manual_bookings.py:288,337-348`). `reference` isteğe bağlı (`:195`). Hakediş `leg_price` üzerinden hesaplanıyor (`dispatch.py:475`). |
| BIZ-05 | DOĞRULANDI | BIZ-05 | Düşük | `api/public.py:56` jeton yoksa yalnızca `region_id` ve serbest `address` alıyor. `services/quotes.py:126-128` bölge merkezini kullanıyor, `dispatch.py:291-294` 3000 m yarıçap uyguluyor. |
| BIZ-06 | DOĞRULANDI | BIZ-06 | Düşük (Bilgi'ye yakın) | `api/schemas.py:113` `country_code` istemciden geliyor, `currency.py:19-22`, `api/customer.py:64-66`. Fark gün içi kur ve 5 TL yukarı yuvarlamayla sınırlı. |
| BIZ-07 | DOĞRULANDI | BIZ-07 | Düşük | `services/payments.py:129` `total_amount is not None and ...`. `currency` hiç okunmuyor. Alanlar PayTR imzasının içinde (`providers/payments.py:144`), yani dışarıdan değiştirilemez. |
| BIZ-08 | DOĞRULANDI (statik); dinamik test gerekir | BIZ-08 | Düşük | `accept_job`: önce bacak kilitleniyor (`dispatch.py:433`), sonra `assign` diğer sürücülerin teklif satırlarını güncelliyor (`:198-205`). `accept_offer`: önce kendi teklifi kilitleniyor (`:227`), sonra bacak (`:236`). Kilit sırası gerçekten ters. Deadlock'un oluşması zamanlamaya bağlı; iki eşzamanlı istekle test edilmeli. |
| BIZ-09 | DOĞRULANDI | BIZ-09 | Düşük | `services/payments.py:31` 25 dk, `providers/payments.py:126` `timeout_limit=30`. Geç gelen ikinci ödeme otomatik iade ediliyor (`services/payments.py:140-147`). |
| BIZ-10 | DOĞRULANDI | BIZ-10 | Bilgi | `services/bookings.py:431-461` hakedişe dokunmuyor. `api/admin/operations.py:187` varsayılanı `False`. |
| BIZ-11 | DOĞRULANDI | BIZ-11 | Bilgi | `services/bookings.py:51` 31 karakterlik alfabe, `secrets.choice` kullanılıyor (`:91`). Bulgu da sorun olmadığını söylüyor. |
| PRIV-01 | DOĞRULANDI | PRIV-01 (DB-05 burada birleşir) | Yüksek | Satır satır aşağıda. |
| PRIV-02 | DOĞRULANDI | PRIV-02 (OTP log); validator boşluğu INF-02/AUTH-03 ile ortak | Yüksek → **Orta** | `backend/app/providers/sms.py:30` tam telefon ve SMS metnini WARNING seviyesinde logluyor. `config.py:49` varsayılan değer `console`; validator (`config.py:114-130`) bunu reddetmiyor. Prod'da `dev_code` dönmüyor (`otp.py:78`). Ön koşul yanlış yapılandırma; prod'da konsol sağlayıcıyla hiçbir kullanıcıya SMS gitmeyeceği için sorun kısa sürede fark edilir. Pencere kısa, ama o sürede log okuyan biri hesap ele geçirebilir. INF-02 ve AUTH-03 de Orta veriyor. |
| PRIV-03 | DOĞRULANDI | PRIV-03 | Yüksek → **Orta** | `api/driver.py:307-312` adresleri `None` yapıyor ama `_trip_out` (`:270-271,283-284`) kesin koordinatı kırpmadan dolduruyor. `config.py:111` yorumu "Sürücü havuzunda ve **teklifte** ... kırpılarak gösterilir" diyor; bu niyet teklifte uygulanmamış. Alıcılar onaylı sürücüler (sözleşmeli, kimliği bilinen kişiler) ve sızan veri ad değil baş harf. Bu yüzden Orta. |
| PRIV-04 | DOĞRULANDI | PRIV-04 (RT-06 ve DB-06 burada birleşir) | Orta | `services/messages.py:92-96` önizlemeyi ve ilk adı veriyor, `trip_updates.py:75-80` `{text}`, uçuş başlıkları `{flight}` içeriyor (`trip_updates.py` DRIVER_TEXTS). Kayıt ve push `:114-133`'te, `booking.py:245` düz metin. Silme 30 gün sonra (`jobs.py:54`). FCM ile ilgili vaat `docs/yasal_ve_guvenlik.md:27`'de. RT-06 Düşük veriyor; üçüncü tarafa (FCM) serbest metin gitmesi ve dokümandaki vaadin çiğnenmesi nedeniyle Orta korunmalı. |
| PRIV-05 | DOĞRULANDI | PRIV-05 | Orta | Cron'lar `backend/app/worker.py:27-41`. `jobs.py` dışındaki tek `.delete(` çağrıları Redis için (`eta.py:151`, `live_location.py:39`). `storage.delete` hiçbir yerden çağrılmıyor. `ALL_JOBS` (`jobs.py:151-159`) `purge_trip_messages`'ı içermiyor ve başka yerde kullanılmıyor. |
| PRIV-06 | DOĞRULANDI | PRIV-06 | Orta | `api/driver.py:333-338` `include_past=True` tüm durumlar için `_trip_out` döndürüyor (tam ad, adres, koordinat). `:341-346` tekil yolculukta da aynı. AUTH-06 (askıya alınan sürücü) ile ilişkili ama farklı bir bulgu. |
| PRIV-07 | DOĞRULANDI | PRIV-07 (okuma denetimi kısmı MON-08 ile ortak) | Orta | `api/admin/operations.py:132-148` `customer_name` maskeli; `BookingOut.build` (`api/schemas.py:245-266`) ise `passenger_name` ve `note` alanlarını tam döndürüyor. `audit.record` yok. Destek rolü de erişebiliyor (`deps.py:115`). |
| PRIV-08 | DOĞRULANDI (GET kısmı); log zinciri iddiası büyük olasılıkla yanlış | PRIV-08 | Orta → **Düşük** | `providers/sms.py:43-53` kimlik bilgilerini, telefonu ve metni GET sorgusunda gönderiyor (CWE-598 doğru). Ancak `notifications.py:99` `log.exception` traceback'i URL içermez: Python traceback yerel değişkenleri yazdırmaz, `raise_for_status` çağrılmadığı için `HTTPStatusError` oluşmaz, `ConnectError`/`Timeout` mesajlarında da sorgu dizgisi bulunmaz. Kalan risk, httpx INFO loglarının açılması (belief) ve TLS sonlandıran bir çıkış vekili. |
| PRIV-09 | MÜKERRER | API-03 (AUTH-05, MON-01, WEB-02 de aynı) | Orta | `api/deps.py:28-30`. Rıza ve audit IP'si açısı API-03'te zaten yazılı. PRIV-09'a özgü kısım, aydınlatma metninde IP işleme amacının bulunmaması; bu kısım PRIV-05'e not olarak eklenebilir. |
| PRIV-10 | DOĞRULANDI | PRIV-10 | Düşük | `dispatch.py:474` bitişte `purge_at=now`. `services/bookings.py:53,244` yedek süre 48 saat. `purge_at` başka hiçbir yerde atanmıyor; iptalde güncellenmiyor. Docstring'ler 24 saat diyor (`booking.py:150`, `jobs.py:44`). |
| PRIV-11 | DOĞRULANDI | PRIV-11 (Redis notu RT-01'de) | Bilgi | `live_location.py` TTL'li, modellerde konum alanı yok. Olumlu bulgu. |
| PRIV-12 | DOĞRULANDI | PRIV-12 (CI artefaktı INF-14 ile ilişkili) | Düşük | `providers/push.py:51`. Prod'da `console` reddediliyor (`config.py:129-130`). |
| PRIV-13 | DOĞRULANDI | PRIV-13 | Düşük | `models/customer.py:70` düz metin. Personel notu müşteri notunun üzerine yazılıyor (`api/admin/people.py:84-85`). Uçuş logları `flight_tracking.py:177,180`. |

## PRIV-01 satır satır

1. `backend/app/api/admin/people.py:77-91` `update_data_request`: yalnızca `r.status`, koşullu olarak `r.note` ve `completed_at` güncelleniyor, ardından audit kaydı yazılıyor. `request_type` alanına hiç bakılmıyor. `silme` (`models/enums.py:35`) talebi `tamamlandi` yapıldığında hiçbir veri silinmiyor. **Doğru.**
2. Yetki uyumsuzluğu: talebi `OpsOrSupport` kapatabiliyor (`:78`), anonimleştirmeyi ise yalnızca `AdminOnly` yapabiliyor (`:95`). Destek rolü silme talebini "tamamlandı" işaretleyebiliyor ama veriyi silemiyor. Bu, bulgudaki "talepten bağımsız" iddiasını güçlendiriyor. **Ek kanıt.**
3. Admin arayüzünde iki ayrı ekran var: talep ekranı (`admin/app/(panel)/data-requests/page.tsx:33`) yalnızca durumu gönderiyor; "Verileri sil" düğmesi ayrı ekranda (`admin/app/(panel)/customers/page.tsx:37,87`). Talep ile anonimleştirme arasında bağ yok. **Doğru.**
4. `anonymize_customer` (`people.py:107-114`) şunları siliyor ya da değiştiriyor: `full_name`, `email`, `deleted_at`, `users.phone`, `users.phone_hash`, `status=DISABLED`, açık oturumların `revoked_at` alanı. Başka hiçbir alana dokunmuyor. **Doğru.**
5. Kalan veriler (model satırları kontrol edildi): `bookings.passenger_name/note` (`models/booking.py:50-51`, şifreli ama silinmiyor), `booking_legs` adres ve koordinatları (`:124-129`), `customers.push_token/country_code/locale` (`models/customer.py:33-39`), `sessions.ip/device_info` (satır siliniyor değil, yalnızca iptal ediliyor), `consents.ip` (`customer.py:56`), `data_requests.note` (`:70`). **Doğru.**
6. Bu akış için test yok: `grep anonymiz tests` sonuç vermedi. Tek ilgili test talep oluşturmayı kontrol ediyor (`tests/test_api_customer.py:257-266`). **Doğru.**
7. Sonuç: Yüksek önem korunmalı. Bulgunun en güçlü kısmı anonimleştirmenin eksik kapsamı ve talep ile anonimleştirmenin bağsız olması. Yasal saklama gerekçesi (fatura) yolcu adını, notu ve koordinatı kapsamaz (hukukçu teyidi gerekli).

## Önem değişiklikleri özeti

| ID | Eski | Önerilen |
|---|---|---|
| DB-01 | Yüksek | Orta |
| DB-03 | Orta | Düşük |
| DB-06 | Düşük | Bilgi (PRIV-04'e birleşir) |
| BIZ-01 | Yüksek | Orta (INF-01'e birleşir) |
| PRIV-02 | Yüksek | Orta |
| PRIV-03 | Yüksek | Orta |
| PRIV-08 | Orta | Düşük |

## Kümeler arası mükerrer adayları

| Konu | Kanonik | Birleşecekler | Not |
|---|---|---|---|
| `env` serbest metin, fail-open | INF-01 | AUTH-03, BIZ-01, API-12 | BIZ-01 sahte ödeme etkisini, AUTH-03 `dev_code` etkisini taşıyor; bunlar INF-01'in alt maddeleri olarak yazılmalı. |
| Prod validator'da `sms_provider=console` ve OTP'nin loga düşmesi | PRIV-02 | INF-02 (SMS maddesi), AUTH-03 (kapsam boşluğu maddesi) | Validator düzeltmesi INF-02'de, log maskeleme PRIV-02'de izlenebilir. |
| Sohbet ve uçuş no `trip_updates`/FCM'de düz metin | PRIV-04 | RT-06, DB-06 | Önemde uyumsuzluk var: RT-06 Düşük, PRIV-04 Orta. Orta önerilir. |
| `cf-connecting-ip` güveni | API-03 | AUTH-05, MON-01, WEB-02, PRIV-09 | WEB-02 BFF tarafı ayrı bir düzeltme gerektiriyor ama kök neden aynı. |
| Kesin koordinat | DB-04 (depolama) | PRIV-03 (teklif API), PRIV-06 (geçmiş API) | Mükerrer değil, ilişkili. Düzeltmeleri farklı katmanlarda. |
| Anonimleştirme eksik | PRIV-01 | DB-05 | Tam mükerrer. |
| Dev Postgres/Redis açık port | INF-10 | DB-10, RT-01 (Redis kısmı), PRIV-11 notu | RT-01 pickle/RCE zinciri nedeniyle ayrı tutulabilir. |
| Sürücü konumu istemci beyanı | BIZ-02 | RT-09 | RT-09 Bilgi, BIZ-02 iş etkisiyle Orta. |
| Admin PII okumaları denetlenmiyor | MON-08 | PRIV-07 (audit kısmı), PRIV-11 (canlı konum görüntüleme) | PRIV-07'nin maskeleme kısmı ayrı kalır. |
| DB kimlik bilgisi / TLS prod denetimi | INF-02 | DB-11 (kimlik bilgisi kısmı) | DB-11'in TLS kısmı ayrı kalır. |
| Audit değiştirilemezlik iddiası | DB-02 | MON-08 (politika-uygulama uyumsuzluğu) | Kısmi örtüşme: aynı doküman satırı (`yasal_ve_guvenlik.md:24`), farklı yönü. |
| CI log artefaktları | INF-14 | PRIV-12 | Kısmi örtüşme. |
