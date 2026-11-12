# Güvenlik denetimi: Alan 2, Veritabanı

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Kapsam: SQL injection / ham sorgu, alan şifrelemesi kapsamı, blind index, Alembic migration'ları, DB kullanıcı yetkisi, `audit_logs` değiştirilemezliği, satır düzeyi erişim deseni, yedekleme.
- Yöntem: yalnızca statik okuma. Çalışan servis yok, DB'ye bağlanılmadı, kod değiştirilmedi.
- Etiketler: `verified` = dosya okundu veya komutla görüldü; `belief` = çıkarım, bağımsız doğrulanmalı.
- Secret değerleri yazılmadı. Yerel geliştirme DB parolası şu konumlarda düz metin: `docker-compose.yml:7`, `backend/app/config.py:25`, `backend/tests/conftest.py:15`, `.github/workflows/ci.yml:28,42`, `.github/workflows/android-emulator.yml:22,45`, `.github/workflows/ios-simulator.yml:22,76`.

## Özet

| Önem | Sayı | ID |
|---|---|---|
| Kritik | 0 | |
| Yüksek | 1 | DB-01 |
| Orta | 4 | DB-02, DB-03, DB-04, DB-05 |
| Düşük | 6 | DB-06, DB-07, DB-08, DB-09, DB-10, DB-11 |
| Bilgi | 2 | DB-12, DB-13 |

---

## DB-01 Uygulama, migration ve CI tek bir PostgreSQL superuser hesabıyla çalışıyor; en az yetki yok

- OWASP: A05:2021 Security Misconfiguration, A01:2021 Broken Access Control. CWE-250 (Execution with Unnecessary Privileges), CWE-269.
- Önem: Yüksek. Gerekçe: Uygulamadaki herhangi bir açık (RCE, DSN sızıntısı, ileride eklenecek bir ham sorgu) doğrudan DB superuser yetkisine dönüşür. PostgreSQL superuser `COPY ... TO/FROM PROGRAM` ile DB sunucusunda işletim sistemi komutu çalıştırabilir, tüm tetikleyicileri atlayabilir (DB-02), rol ve tablo yetkilerini değiştirebilir. Repoda başka bir rol tanımı veya GRANT/REVOKE yok; üretim yapılandırması repoda olmadığı için üretimdeki durum doğrulanamadı.
- Konum:
  - `docker-compose.yml:6-8` `POSTGRES_USER` resmi postgres imajında superuser olarak oluşturulur (imaj davranışı) ve uygulama aynı kullanıcıyla bağlanır: `backend/app/config.py:25` (varsayılan `database_url`), `backend/app/db.py:10` (`create_engine(get_settings().database_url, ...)`).
  - `backend/alembic/env.py:18-19,42` migration da aynı `database_url` ile çalışır (ayrı migration/DDL rolü yok).
  - `.github/workflows/ios-simulator.yml:76` rol açıkça `CREATE ROLE getaway LOGIN SUPERUSER ...` ile oluşturuluyor.
  - `docs/veritabani.md:83` "Uygulama kullanıcısına güncelleme ve silme yetkisi verilmez" diyor; kodda bunu sağlayan yetki ayrımı yok.
- Negatif kanıt: `git grep -n -i -E "GRANT |REVOKE |CREATE ROLE|ALTER ROLE|NOSUPERUSER"` yalnızca `ios-simulator.yml:76` (SUPERUSER) ve ilgisiz bir `adb pm grant` satırı döndürdü.
- Kavramsal istismar: Saldırgan herhangi bir yolla uygulamanın DSN'ini ele geçirir veya uygulama süreci üzerinde kod çalıştırır; superuser bağlantısıyla `audit_logs` tetikleyicisini kapatıp izleri siler, tüm Fernet şifreli sütunları dışarı alır (anahtar uygulama sürecinde), `COPY ... PROGRAM` ile DB hostunda kabuk açar.
- Önerilen düzeltme: En az üç rol: (1) `getaway_owner` tabloların sahibi, yalnızca migration sırasında kullanılır, NOSUPERUSER; (2) `getaway_app` LOGIN, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, yalnızca gerekli tablolarda SELECT/INSERT/UPDATE/DELETE, `audit_logs` üzerinde yalnızca SELECT ve INSERT (UPDATE/DELETE/TRUNCATE yok), sequence USAGE; (3) isteğe bağlı salt okunur raporlama rolü. Bunu bir migration'da `REVOKE ALL ... FROM PUBLIC` ile birlikte uygulayın; `GETAWAY_DATABASE_URL` (uygulama) ve ayrı bir `GETAWAY_MIGRATION_DATABASE_URL` (alembic) tanımlayın. Üretim doğrulayıcısına (`config.py:114`) bağlantı kullanıcısının superuser olmadığını başlangıçta kontrol eden bir adım eklenebilir (`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).
- Etiket: verified (repo, dev, CI); belief (üretim, yapılandırma repoda yok).

## DB-02 `audit_logs` "değiştirilemez" iddiası yalnızca tetikleyiciye dayanıyor; tablo sahibi/superuser tarafından atlanabilir

- OWASP: A09:2021 Security Logging and Monitoring Failures. CWE-117 değil; CWE-693 (Protection Mechanism Failure), CWE-779/CWE-778 ilişkili (log bütünlüğü).
- Önem: Orta. Gerekçe: Tetikleyici uygulama hatalarına ve sıradan UPDATE/DELETE/TRUNCATE'e karşı çalışıyor (test var), ancak uygulamanın bağlandığı rol aynı zamanda tablo sahibi ve superuser olduğundan tek komutla devre dışı bırakılabilir. `docs/yasal_ve_guvenlik.md:24` "Log kayıtları değiştirilemez" bir yasal/uyum iddiası; mevcut tasarım bu iddiayı yalnızca dürüst istemciye karşı sağlıyor. DB-01 ile birleşince etkisi artar.
- Konum:
  - `backend/alembic/versions/20261029_0002_audit_logs_immutable.py:19-41` BEFORE UPDATE OR DELETE (satır) ve BEFORE TRUNCATE (ifade) tetikleyicileri. verified
  - `backend/alembic/versions/20261029_0002_audit_logs_immutable.py:44-48` `downgrade()` tetikleyicileri ve fonksiyonu düşürüyor; migration yetkisi olan herkes korumayı kaldırabilir. verified
  - `backend/tests/test_api_driver_admin.py:314-320` UPDATE ve DELETE'in reddedildiği test var. verified
  - Atlatma yolları (PostgreSQL davranışı): tablo sahibi `ALTER TABLE audit_logs DISABLE TRIGGER ...`; superuser `SET session_replication_role = replica` (normal tetikleyiciler çalışmaz); `DROP TABLE audit_logs` tetikleyiciyi tetiklemez; `CREATE OR REPLACE FUNCTION audit_logs_immutable()` ile fonksiyon gövdesi boşaltılabilir. belief (PostgreSQL bilinen davranışı; bu ortamda çalıştırılmadı)
  - INSERT açık: uygulama rolü `actor_id`, `action`, `created_at` (server_default ezilebilir) alanlarını serbestçe yazabilir, yani sahte geçmiş kayıt eklenebilir. `backend/app/models/ops.py:44-56`. verified (şema), belief (istismar)
  - Zincirleme özet (hash chain), imza veya log'un DB dışına (WORM depolama, SIEM) kopyalanması: aramam bulamadı (`grep -rn -i -E "prev_hash|chain|hmac" backend/app/models/ops.py backend/app/services/audit.py` sonuç yok).
- Kavramsal istismar: Yetkisini kötüye kullanan bir personel veya uygulamayı ele geçiren saldırgan, bir iade/hakediş manipülasyonundan sonra `DISABLE TRIGGER` + `DELETE FROM audit_logs WHERE ...` + `ENABLE TRIGGER` ile izini siler; denetimde kayıt bütünlüğünün bozulduğunu gösterecek bir mekanizma yok.
- Önerilen düzeltme: (1) DB-01'deki rol ayrımı: `audit_logs` sahibi uygulama rolü olmasın, uygulama rolüne yalnızca INSERT ve SELECT verilsin; (2) `created_at` için `DEFAULT now()` yerine INSERT tetikleyicisiyle `NEW.created_at := now()` zorlanması; (3) her satıra önceki satırın özetini içeren `prev_hash`/`row_hash` (hash chain) ve periyodik olarak son özetin DB dışına yazılması; (4) üretimde `pgaudit` veya logical replication ile ayrı bir append-only depoya kopya; (5) `docs/yasal_ve_guvenlik.md:24` ifadesinin gerçek garantiyle uyumlu hale getirilmesi.
- Etiket: verified (tetikleyici var, downgrade düşürüyor, rol ayrımı yok); belief (atlatma komutları çalıştırılmadı).

## DB-03 Test fikstürü, ortamdan gelen herhangi bir veritabanında `alembic downgrade base` çalıştırıyor

- OWASP: A05:2021 Security Misconfiguration. CWE-1188 (Insecure Default), CWE-404 değil; sonuç olarak veri kaybı (CWE-284 yanlış hedefe yıkıcı işlem).
- Önem: Orta. Gerekçe: Saldırı değil kaza senaryosu, ancak geri alınamaz veri kaybı (tüm tablolar düşer). `os.environ.setdefault` kullanıldığı için kabukta `GETAWAY_DATABASE_URL` dev/staging/prod'u gösteriyorsa test o veritabanını siler; DB adı veya `env` kontrolü yok.
- Konum: `backend/tests/conftest.py:14-16` (`setdefault`, yani dış değer önceliklidir), `backend/tests/conftest.py:54` (`command.downgrade(cfg, "base")`), ardından `:55` upgrade ve `:61` seed. verified
- Kavramsal istismar: Geliştirici, staging'e bakan bir terminalde `pytest` çalıştırır; `downgrade base` tüm şemayı düşürür (0002'nin downgrade'i önce audit tetikleyicisini kaldırır, sonra 0001 tüm tabloları siler).
- Önerilen düzeltme: Fikstürde, URL'nin veritabanı adının `_test` ile bittiğini (veya host'un localhost olduğunu) doğrulayan ve değilse `pytest.exit` ile duran bir koruma; `setdefault` yerine yalnızca `GETAWAY_TEST_DATABASE_URL` okunması.
- Etiket: verified.

## DB-04 Kesin alış/bırakış koordinatları şifresiz; adres şifrelemesini fiilen anlamsızlaştırıyor

- OWASP: A02:2021 Cryptographic Failures. CWE-311 (Missing Encryption of Sensitive Data), CWE-359 (Exposure of Private Personal Information).
- Önem: Orta. Gerekçe: `pickup_address`/`dropoff_address` Fernet ile şifreli, ancak aynı satırda 6 ondalık (yaklaşık 10 cm) hassasiyetli enlem/boylam düz metin. Koordinat ters coğrafi kodlamayla adresi (ev, otel odası bloğu) verir; DB dökümü, yedek veya salt okunur erişimi olan biri müşterinin konumlarını ve rutinlerini çıkarabilir. Koordinatlar anonimleştirmede de silinmiyor (DB-05) ve saklama süresi yok.
- Konum: `backend/app/models/booking.py:124-125` (adres şifreli), `backend/app/models/booking.py:126-129` (`Numeric(9, 6)` düz). verified. Sürücü havuzunda kırpma (`config.py:112` `job_preview_trim_m`) yalnızca API çıktısı içindir, depolamayı etkilemez. verified
- Kavramsal istismar: Sızan bir `pg_dump` içinden `booking_legs` ve `bookings.customer_id` birleştirilerek her müşterinin tekrar eden alış noktası (ev adresi) çıkarılır; adres sütununun şifreli olması bunu engellemez.
- Önerilen düzeltme: Koordinatları da `EncryptedString` (veya şifreli JSON) olarak saklayın; mesafe/yarıçap hesapları zaten Python tarafında yapılıyorsa SQL'de koordinat sorgusuna gerek yok (`grep` ile doğrulanmalı). Alternatif: yolculuk tamamlandıktan N gün sonra koordinatları ilçe merkezine yuvarlayan bir saklama işi. Anonimleştirmede koordinatlar sıfırlanmalı.
- Etiket: verified (şema); belief (koordinatların SQL içinde mekânsal sorguda kullanılmadığı, kontrol edilmedi).

## DB-05 Müşteri anonimleştirmesi kişisel veriyi eksik siliyor

- OWASP: A04:2021 Insecure Design. CWE-212 (Improper Removal of Sensitive Information Before Storage or Transfer), CWE-359.
- Önem: Orta. Gerekçe: KVKK silme talebinin uygulandığı tek uç; kişisel verilerin önemli bir kısmı kalıyor. Hukuki saklama yükümlülüğü (fatura) rezervasyon tutarı ve tarihini kapsar, yolcu adı/not/koordinat/cihaz tanımlayıcısını gerektirmez (hukukçu teyidi gerekli).
- Konum: `backend/app/api/admin/people.py:94-117`. Silinen alanlar: `customers.full_name`, `customers.email`, `users.phone`, `users.phone_hash`, `users.status`, oturumlar iptal. verified
- Kalan alanlar (verified, model satırları):
  - `customers.push_token` (`backend/app/models/customer.py:39`)
  - `bookings.passenger_name`, `bookings.note` (`backend/app/models/booking.py:50-51`)
  - `booking_legs.pickup_address`, `dropoff_address`, `pickup_lat/lng`, `dropoff_lat/lng` (`booking.py:124-129`)
  - `sessions.ip`, `sessions.device_info` (`backend/app/models/identity.py:69-70`; oturum yalnızca iptal ediliyor, satır silinmiyor)
  - `consents.ip` (`customer.py:56`), `data_requests.note` (`customer.py:70`)
  - `flight_infos.flight_no` (`purge_at` ile siliniyor, `backend/app/services/jobs.py:43-45`), `trip_messages` (30 gün, `jobs.py:49-55`)
  - Sürücüler için eşdeğer bir anonimleştirme ucu: aramam bulamadı (`grep -rn "def anonymize" backend/app` yalnızca `people.py:95`).
- Kavramsal istismar: Silme talebi uygulanmış bir müşterinin adı, yolculuk adresleri ve notları, admin rezervasyon detayı ekranından (OpsOrSupport) veya bir DB dökümünden okunmaya devam eder.
- Önerilen düzeltme: Anonimleştirmede yukarıdaki alanları `NULL`/sabit değerle değiştirin (yolcu adı "Anonim", adres ve koordinat NULL, not NULL), müşterinin `sessions` ve `consents` satırlarındaki IP/UA'yı silin, `push_token` NULL; sürücüler için aynı işlemi ekleyin. Hangi alanların yasal olarak saklanacağı `docs/yasal_ve_guvenlik.md` saklama tablosuna yazılsın. Bunu kapsayan bir test (anonimleştirme sonrası tüm PII sütunlarının boş olduğu) eklensin.
- Etiket: verified.

## DB-06 `trip_updates.body` şifreli sürücü adını ve plakayı düz metin kopyalıyor

- OWASP: A02:2021 Cryptographic Failures. CWE-312 (Cleartext Storage of Sensitive Information).
- Önem: Düşük. Gerekçe: `drivers.full_name` Fernet ile şifreli, ancak müşteriye giden bildirim metni ad ve plakayla birlikte `String(500)` düz sütuna yazılıyor. 30 gün sonra siliniyor, bu yüzden etki sınırlı.
- Konum: `backend/app/models/booking.py:245` (`body` düz), `backend/app/services/trip_updates.py:28-31` (şablon `{driver}`, `{plate}`), `backend/app/services/trip_updates.py:116,130` (kayıt), `backend/app/services/jobs.py:54` (30 gün temizlik). verified
- Kavramsal istismar: DB dökümünden sürücü adları ile müşteri/bacak eşleşmesi şifre çözme anahtarı olmadan okunur.
- Önerilen düzeltme: `body`/`title` yerine yalnızca `code` + `data` (sürücü id, araç id) saklayıp metni okuma anında üretin; ya da `body` sütununu `EncryptedString` yapın.
- Etiket: verified.

## DB-07 Diğer şifresiz kişisel/hassas alanlar

- OWASP: A02:2021. CWE-312.
- Önem: Düşük. Gerekçe: Tek tek düşük hassasiyetli, ancak KVKK kapsamında kişisel veri; şifreli sütunlarla aynı tabloda olduklarından şifrelemenin tehdit modelini (DB dökümü) kısmen boşa çıkarır.
- Konum (verified, model satırları):
  - IP adresleri: `sessions.ip` (`identity.py:70`), `otp_challenges.ip` (`identity.py:90`, 1 gün sonra siliniyor `jobs.py:137-138`), `consents.ip` (`customer.py:56`), `audit_logs.ip` (`ops.py:54`).
  - Cihaz: `sessions.device_info` (`identity.py:69`), `customers.push_token` (`customer.py:39`), `drivers.push_token` (`fleet.py:41`). Push jetonu tek başına FCM hizmet hesabı olmadan bildirim gönderemez; risk düşük.
  - `vehicles.plate` (`fleet.py:63`, unique). Benzersizlik için blind index + şifreli sütun mümkün.
  - Serbest metin (kişisel veri içerebilir): `data_requests.note` (`customer.py:70`), `document_reviews.note` (`fleet.py:115`), `bookings.cancel_reason` (`booking.py:77`), `bookings.price_override_reason` (`booking.py:90`), `payments.note` (`finance.py:47`), `refunds.reason` (`finance.py:78`), `drivers.tursab_or_agency_no` (`fleet.py:35`).
  - `audit_logs.changes`: `services/audit.py:15-33` anahtar adına göre maskeliyor; ancak `reason` anahtarı listede yok ve `trip_review.py:53`, `documents.py:114`, `bookings.py:459,482` serbest metin `reason` yazıyor. Bu değerler değiştirilemez tabloda kalıcıdır (silme talebinde de silinemez).
- Önerilen düzeltme: Serbest metin notları `EncryptedString` yapın; `reason` (ve `reference`) anahtarlarını `SENSITIVE_KEYS`'e ekleyin veya audit'e yalnızca uzunluk/var-yok yazın; plaka için `plate_hash` + şifreli `plate`; IP'leri belirli süre sonra (ör. 90 gün) /24 maskeleyen saklama işi.
- Etiket: verified (şema); belief (serbest metinde fiilen kişisel veri bulunduğu).

## DB-08 Fernet şifreli metin satır/sütuna bağlı değil (ciphertext yer değiştirme)

- OWASP: A02:2021. CWE-649 (Reliance on Obfuscation or Encryption of Security-Relevant Inputs without Integrity Checking) / CWE-345.
- Önem: Düşük. Gerekçe: Fernet bütünlük sağlar ama bağlam (associated data) desteklemez. Aynı anahtarla şifrelenmiş bir değer başka bir satıra veya sütuna kopyalandığında geçerli çözülür. Yalnızca DB yazma erişimi olan, anahtara sahip olmayan saldırgan için anlamlı (ör. DB-01 sonrası veya SQL erişimli bir operatör).
- Konum: `backend/app/security/crypto.py:84-99` (`EncryptedString`), `crypto.py:25-36`. verified
- Kavramsal istismar: Saldırgan kendi sürücü hesabında IBAN'ını uygulama üzerinden kaydeder, ardından DB'de bu `drivers.iban` şifreli metnini başka sürücülerin satırına kopyalar; hakediş dosyası (`/admin/payouts/export.csv`) saldırganın IBAN'ını gösterir. Anahtar gerekmez.
- Önerilen düzeltme: Kritik alanlarda (IBAN, 2FA sırrı, belge yolu) AES-GCM ile `table:column:row_id` associated data kullanan bir tip; ya da düz metne `row_id|` öneki ekleyip çözmede doğrulama. IBAN değişikliklerinin audit kaydı ve ödeme öncesi değişiklik uyarısı ayrıca önerilir.
- Etiket: belief (mekanizma kriptografik olarak doğru, istismar senaryosu çalıştırılmadı).

## DB-09 Blind index anahtarı OTP HMAC'iyle paylaşılıyor, alan ayrımı ve rotasyon yok

- OWASP: A02:2021. CWE-323 (Reusing a Key) / CWE-320.
- Önem: Düşük. Gerekçe: `blind_index()` HMAC-SHA256(`blind_index_key`, değer) ve OTP kod özeti HMAC-SHA256(aynı anahtar, `challenge_id:code`) aynı anahtarı ve önek olmadan kullanıyor (girdi biçimleri farklı olduğu için pratik çakışma düşük). Telefon ve e-posta indeksleri de aynı anahtar ve alan ayrımı olmadan üretiliyor; birinin değeri diğerininkine eşit girdide aynı özeti verir. Anahtar tek değer; MultiFernet gibi rotasyon yolu yok, anahtar sızarsa tüm telefon numaraları (TR numara uzayı küçük, yaklaşık 10^10) kaba kuvvetle geri çıkarılabilir.
- Konum: `backend/app/security/crypto.py:47-49`, kullanım `backend/app/services/auth.py:108,174` ve recon'a göre `backend/app/services/otp.py:38-79` (OTP özeti, bu taramada satır satır okunmadı). Benzersizlik `identity.py:27-28` (`kind`, `phone_hash`) ve `identity.py:34` (`email_hash` unique). verified (crypto, auth); belief (otp.py ayrıntısı).
- Önerilen düzeltme: HKDF ile amaç başına alt anahtar (`phone`, `email`, `otp`) veya HMAC girdisine sabit alan öneki; anahtar sürümü sütunu (`phone_hash_v`) ile rotasyon planı.
- Etiket: verified (anahtar paylaşımı); belief (etki).

## DB-10 PostgreSQL portu hostun tüm arayüzlerine superuser hesabıyla açık (yerel geliştirme)

- OWASP: A05:2021. CWE-1327 (Binding to an Unrestricted IP Address), CWE-798 (Hard-coded Credentials, dev değeri).
- Önem: Düşük. Gerekçe: Yalnızca geliştirme ortamı, ancak `"5432:5432"` Docker'da 0.0.0.0'a bağlanır; aynı ağdaki (kafe, ofis Wi-Fi) biri repodaki herkese açık dev parolasıyla superuser olarak bağlanır. Geliştirici makinesindeki yerel veride gerçek test hesapları ve (dev Fernet anahtarıyla şifreli) veriler var; dev Fernet anahtarı da repoda olduğundan şifre çözülebilir.
- Konum: `docker-compose.yml:9-10` (port), `docker-compose.yml:6-8` (kimlik bilgileri, parola değeri yazılmadı), `backend/app/config.py:15` (dev Fernet anahtarı, değer yazılmadı). verified
- Önerilen düzeltme: `"127.0.0.1:5432:5432"`; parolayı `.env`'den okuyan `${POSTGRES_PASSWORD:?}` kullanımı. Redis için aynısı (Alan dışı, not olarak).
- Etiket: verified.

## DB-11 DB bağlantısında TLS zorunluluğu yok; üretim doğrulayıcısı `database_url`'i denetlemiyor

- OWASP: A02:2021 / A05:2021. CWE-319 (Cleartext Transmission).
- Önem: Düşük. Gerekçe: Üretim topolojisi repoda yok; DB uygulamayla aynı hostta değilse PII şifreli olsa da oturum, OTP özetleri, koordinatlar ve DB parolası ağda düz geçebilir.
- Konum: `backend/app/db.py:10` (`connect_args` yok), `backend/app/config.py:114-130` (prod doğrulayıcısı JWT/Fernet/blind index ve sağlayıcıları kontrol ediyor, `database_url`'deki `sslmode`'u ve dev parolasını kontrol etmiyor). Negatif: `grep -rn "sslmode\|connect_args" backend/ .github/` sonuç yok. verified
- Önerilen düzeltme: `env == "prod"` iken `database_url` içinde `sslmode=verify-full` (veya en az `require`) ve dev parolasının bulunmamasını doğrulayın.
- Etiket: verified (kod); belief (üretimde ağ üzerinden bağlantı olduğu).

## DB-12 Yedekleme yapılandırması yok; doküman iddiası karşılıksız (Bilgi)

- OWASP: A05:2021. CWE-1059 (Insufficient Technical Documentation) yakın.
- Önem: Bilgi. `docs/yasal_ve_guvenlik.md:28` "Yedekleme, şifreli ve Türkiye'de tutulur" diyor. Repoda yedek betiği, `pg_dump`/WAL arşiv yapılandırması veya geri yükleme testi: aramam bulamadı (`git grep -n -i -E "pg_dump|pg_basebackup|wal-g|pgbackrest|backup|yedek"`; eşleşmeler yalnızca ödeme/harita "yedek sağlayıcı" metinleri). Not: yedekte Fernet şifreli alanlar şifreli kalır, ancak DB-04/DB-06/DB-07 alanları açık olur; anahtarların yedekle aynı yerde tutulmaması gerekir.
- Önerilen düzeltme: Yedekleme ve geri yükleme prosedürünü (şifreleme anahtarı, konum, saklama süresi, düzenli geri yükleme testi) `docs/` altında belgeleyin; açık konu olarak `docs/acik_konular.md`'ye ekleyin.
- Etiket: verified (repoda yok).

## DB-13 Denetim kaydı listesinde `action` filtresi LIKE joker karakterlerini kaçırmıyor (Bilgi)

- OWASP: A03:2021 Injection (yalnızca LIKE deseni, SQL enjeksiyonu değil). CWE-155.
- Önem: Bilgi. `AuditLog.action.startswith(action)` SQLAlchemy'de varsayılan `autoescape=False` ile `LIKE :param || '%'` üretir; parametre bağlanır, SQL enjeksiyonu yok. `%`/`_` ile filtre genişletilebilir, ancak çağıran zaten tüm kayıtları görebiliyor. Ayrıca uç `AnyStaff` (SUPPORT dahil) ile tüm denetim kayıtlarını IP'leriyle döndürüyor; erişim kontrolü alanına ait bir not.
- Konum: `backend/app/api/admin/people.py:180-207`, sayfa sınırı `backend/app/api/admin/common.py:14-18` (en fazla 200). verified
- Önerilen düzeltme: `startswith(action, autoescape=True)`; SUPPORT rolü için `ip` alanını maskeleme değerlendirilsin.
- Etiket: verified.

---

## Negatif bulgular (aranan ve bulunamayan)

- SQL injection / ham sorgu: Uygulama kodunda (`backend/app`) `text(`, `exec_driver_sql`, f-string SQL, `literal_column`, dinamik `order_by(getattr(...))` yok. Komut: `Grep "text\(|\.execute\(|exec_driver_sql|f\"(SELECT|INSERT|UPDATE|DELETE|select|insert|update|delete)|literal_column|\.raw\(|order_by\(.*getattr|DDL\("` (backend). Tüm `db.execute(...)` çağrıları SQLAlchemy Core/ORM ifadesi (`select`, `update`, `delete`) alıyor: `driver.py:410`, `dispatch.py:112`, `operations.py:43,45`, `notifications.py:118,128`, `messages.py:48`, `jobs.py:45,53,54,138`, `flight_tracking.py:149`, `push_outbox.py:94`, `finance.py:162`, `people.py:51`, `trip_review.py:109,111`, `seed.py:153`. Ham SQL yalnızca migration'larda (sabit metin, kullanıcı girdisi yok: `0001:22`, `0002:20-48`, `0006:25-28`) ve testlerde (`conftest.py:38`, `test_api_customer.py:149`, `test_api_driver_admin.py:320`).
- LIKE/ILIKE kullanıcı girdisiyle: yalnızca DB-13 (`grep "ilike|\.like\(|contains\(|startswith\("` backend/app).
- Satır düzeyi erişim: PostgreSQL RLS kullanılmıyor (`git grep -i "row level security"` sonuç yok); erişim uygulama katmanında sahiplik filtresiyle yapılıyor ve okunan uçlarda tutarlı: `customer.py:48-50` (`_own_booking`, `customer_id == customer.id`), `driver.py:341-345,356-359,381-384` (`leg.driver_id != driver.id` ise 404), `trips.py:153-157` (`_own_leg`), `driver.py:148,186` (belge ve araç sahipliği). Tüm uçların IDOR açısından taranması Alan 2 dışında bırakıldı.
- Blind index benzersizliği: telefon için `(kind, phone_hash)` unique, e-posta için `email_hash` unique; aramalar `kind` ile kapsamlanmış (`auth.py:108,174`). Sorun bulunamadı.
- Webhook maskeleme: `payment_webhooks.raw_payload` için `hash, email, user_phone, user_name, user_address` maskeleniyor (`providers/payments.py:75-80`). PayTR'nin bu alanlar dışında kişisel veri gönderip göndermediği doğrulanmadı.
- Kart verisi sütunu: yok (recon ile uyumlu).
- Migration'larda veri sızdıran işlem: yok. `0006` veri güncellemesi sabit SQL ile yapılıyor. Geri alınamaz downgrade'ler: `0005:41-44` yorumla açıkça veri kaybını belirtiyor; `0004:57-63` downgrade `trip_messages` (şifreli sohbet) ve `customers.push_token` verisini siler (uyarı yorumu yok); `0002:44-48` audit korumasını kaldırır (DB-02); `0001:539+` tüm tabloları siler. Üretimde downgrade'i engelleyen bir koruma yok (belief: önemli değil, operasyonel disiplin konusu).

## Recon haritasının doğrulanması

- Recon §4'teki şifreli alan listesi doğru (`EncryptedString`: users.email/phone/two_factor_secret, customers.full_name/email, bookings.passenger_name/note, booking_legs.pickup_address/dropoff_address, trip_messages.body, drivers.full_name/iban, documents.storage_key). verified (model grep)
- Recon'da olmayan ek düz alanlar: `bookings.cancel_reason`, `bookings.price_override_reason`, `refunds.reason`, `drivers.tursab_or_agency_no` (DB-07).
- `docs/veritabani.md:18,28` customers ve drivers tablolarında `phone (şifreli)` sütunu olduğunu söylüyor; modelde telefon yalnızca `users.phone` (doküman tutarsızlığı, güvenlik etkisi yok; `docs/veritabani.md:92` doğru açıklıyor).
