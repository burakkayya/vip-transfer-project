# Alan 6: Veri gizliliği (KVKK / GDPR)

- Tarih: 2026-11-12, dal `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Kapsam: `docs/yasal_ve_guvenlik.md` ve kararlarda (K-18, K-31, K-47, K-50) vaat edilen gizlilik ilkelerinin backend kodunda uygulanması. Yalnızca statik okuma; servis çalıştırılmadı, kod değiştirilmedi.
- Etiketler: `verified` = dosya okundu / komutla görüldü; `belief` = çıkarım, bağımsız doğrulanmalı.
- Kişisel veri değeri yazılmadı. Bu belge hukuki görüş değildir.

## Özet

| Önem | Sayı |
|---|---|
| Yüksek | 3 |
| Orta | 6 |
| Düşük | 4 |
| Toplam | 13 |

## Bulgular

### PRIV-01 Silme talebi (data_requests) hiçbir veriyi silmiyor; anonimleştirme talepten bağımsız ve eksik kapsamlı

- Kategori: KVKK m.7 ve m.11/1-e, GDPR m.17 (unutulma hakkı), m.5/1-e (saklama sınırlaması); CWE-212 (hassas bilginin uygunsuz şekilde kaldırılmaması)
- Önem: Yüksek. Silme hakkı yasal bir yükümlülük; talep "tamamlandı" işaretlenebiliyor ama kişisel verinin önemli kısmı (yolcu adı, adresler, kesin koordinatlar, rezervasyon notu) kalıcı olarak duruyor. Etki tüm müşterileri kapsar.
- Dosya:satır:
  - `backend/app/api/admin/people.py:77-91` `update_data_request` yalnızca `status`, `note`, `completed_at` günceller; `request_type == silme` için hiçbir silme veya anonimleştirme tetiklenmez.
  - `backend/app/api/admin/people.py:94-118` `anonymize_customer` ayrı bir uç; talep kaydına bağlı değil. Yalnızca `customers.full_name`, `customers.email`, `users.phone`, `users.phone_hash`, `deleted_at`, kullanıcı durumu ve oturum iptali.
- Anonimleştirmenin kapsam dışında bıraktığı kişisel veriler (verified, model ve uç okundu):
  - `bookings.passenger_name`, `bookings.note` (`backend/app/models/booking.py:50-51`)
  - `booking_legs.pickup_address`, `dropoff_address`, `pickup_lat/lng`, `dropoff_lat/lng` (`booking.py:124-129`) — ev/otel adresi ve kesin koordinat
  - `customers.push_token`, `country_code`, `locale` (`backend/app/models/customer.py:33-39`)
  - `sessions.ip`, `sessions.device_info` (yalnızca `revoked_at` atanıyor, satır silinmiyor; `people.py:115-116`)
  - `consents.ip` (onay kanıtı olarak saklanması savunulabilir; saklama süresi tanımsız)
  - `data_requests.note` (serbest metin, düz metin)
  - `trip_updates.body/title` (yolcu ilk adı ve mesaj önizlemesi içerebilir, bkz. PRIV-04) — 30 gün sonra silinir
  - `trip_messages` — 30 gün sonra silinir (K-50), anonimleştirmede hemen silinmez
  - `notifications` (alıcı id, şablon; süresiz)
  - `payment_webhooks.raw_payload` (maskelenmiş; maskelenmeyen alanlar bu alanda doğrulanmadı)
- Ayrıca: erişim (`erisim`) talebi için veri dışa aktarım ucu yok (aramam bulamadı: `grep -rn "export\|erisim\|ACCESS" backend/app/api/customer.py`); talep yalnızca kayıt olarak açılıyor. Silme akışı için test yok (aramam bulamadı: `grep -rn "anonymiz\|purge_trip" backend/tests`).
- Sürücü tarafı: sürücünün veri talebi açabileceği bir uç ve sürücü anonimleştirme fonksiyonu yok (aramam bulamadı: `grep -rn "data-requests\|anonymize" backend/app/api/driver.py backend/app/api/admin/fleet.py`).
- Risk: Silme talebi "tamamlandı" görünürken yolcu adı, adres ve koordinatlar (kişiyi doğrudan tanımlayan veri) süresiz kalır; denetimde KVKK m.7 ihlali. Anonimleştirilmiş müşterinin adı sürücünün geçmiş yolculuk listesinde görünmeye devam eder (PRIV-06).
- Öneri: Silme talebini tamamlamayı anonimleştirmeye bağlayın (`silme` talebi `tamamlandi` olunca `anonymize_customer` mantığı çalışsın veya anonimleştirme talep id'si istesin). Anonimleştirmeye `bookings.passenger_name`/`note`, bacak adres ve koordinatları (bölge merkezine indirgeme), `push_token`, `trip_messages`, `trip_updates`, `sessions` satırlarını ekleyin; vergi gereği saklanan alanları (tutar, tarih, fatura) açıkça listeleyin. Erişim talebi için JSON dışa aktarım ucu ekleyin. Sürücü için eşdeğer akış tanımlayın. Her biri için test yazın.
- Durum: verified

### PRIV-02 Konsol SMS sağlayıcısı üretimde engellenmiyor; OTP kodu ve tam telefon numarası WARNING seviyesinde loglanıyor

- Kategori: KVKK m.12 (veri güvenliği), GDPR m.32; CWE-532 (log dosyasına hassas bilgi), CWE-312
- Önem: Yüksek. Varsayılan değer `console` ve üretim doğrulayıcısı bunu reddetmiyor; yanlış yapılandırmada her OTP kodu telefonla birlikte log'a düşer. Log erişimi olan herkes hesap ele geçirebilir (OTP 300 sn geçerli) ve telefon listesi toplayabilir.
- Dosya:satır:
  - `backend/app/providers/sms.py:30` `log.warning("SMS (console) -> %s: %s", phone, text)` — doğrulandı: tam telefon ve SMS metni (OTP kodu dahil, ayrıca rezervasyon/ödeme SMS'leri).
  - `backend/app/config.py:49` `sms_provider: str = "console"`; `backend/.env.example:15` `GETAWAY_SMS_PROVIDER=console`.
  - `backend/app/config.py:114-130` `_no_dev_secrets_in_prod`: fake ödeme, fake places ve console push reddediliyor; `sms_provider == "console"` kontrolü yok.
  - Not: `dev_code` prod'da API yanıtında dönmez (`backend/app/services/otp.py:78`), bu yüzden prod'da konsol sağlayıcı ile müşteri kodu alamaz ama kod log'a yazılır.
- Risk: Prod'da `GETAWAY_SMS_PROVIDER` unutulursa tüm OTP'ler log toplama sistemine (ve üçüncü taraf log servisine) düz metin gider.
- Öneri: Validator'a `if self.env == "prod" and self.sms_provider == "console": raise`. Konsol sağlayıcıda telefonu `mask_phone` ile maskeleyin; OTP kodunu yalnızca `env == "test"`/`dev` iken loglayın veya hiç loglamayın (testler zaten `outbox`'tan okuyor).
- Durum: verified

### PRIV-03 Sürücüye gönderilen tekliflerde (offers) adres gizleniyor ama kesin alış/varış koordinatları açık

- Kategori: KVKK m.4/2-ç (ölçülülük, veri minimizasyonu), GDPR m.5/1-c; CWE-359 (özel bilginin yetkisiz kişiye açılması)
- Önem: Yüksek. Teklif, kabul etmeyen birden fazla sürücüye gidebilir; koordinat 6 ondalık (~10 cm) hassasiyetle müşterinin ev/otel konumunu ve adı baş harfini, yolculuk saatini birlikte açığa çıkarır. K-47 ve `job_preview_trim_m` (`config.py:112`) bu riski iş havuzunda bilinçli olarak kapatıyor; teklif yolunda kapatılmamış.
- Dosya:satır:
  - `backend/app/api/driver.py:296-313` `list_offers`: `pickup_address` ve `dropoff_address` `None` yapılıyor, yolcu adı kısaltılıyor; fakat `_trip_out` (`driver.py:256-284`) `pickup_lat/lng` ve `dropoff_lat/lng` alanlarını kırpmadan dolduruyor ve bunlar sıfırlanmıyor.
  - Karşılaştırma: `backend/app/api/trips.py:37-55` `JobOut` koordinat içermez, yalnızca kırpılmış önizleme çizgisi.
- Risk: Teklifi reddeden sürücü (veya sürücü hesabını ele geçiren) yolcunun tam adres konumunu öğrenir. "Sürücüye yalnızca karşılama için gereken bilgiler gösterilir" vaadiyle çelişir.
- Öneri: Teklif yanıtında `pickup_lat/lng`, `dropoff_lat/lng` alanlarını `None` yapın veya `route_line.preview_polyline` ile aynı kırpmayı uygulayın; bölge merkezi yeterli. Bunu gösteren bir test ekleyin.
- Durum: verified (kod okuma); mobil istemcinin bu alanları teklif ekranında gösterip göstermediği belief.

### PRIV-04 Mesaj önizlemesi ve uçuş numarası, şifresiz `trip_updates` tablosuna ve FCM'e kopyalanıyor

- Kategori: KVKK m.12, m.4/2-ç; GDPR m.5/1-c, m.5/1-e, m.28 (işleyen: Google FCM); CWE-312 (hassas bilginin düz metin saklanması)
- Önem: Orta. `trip_messages.body` bilinçli olarak şifreli (`booking.py:224`), ancak ilk 117 karakteri `trip_updates.body` (`String(500)`, düz metin) alanına ve push yüküne yazılıyor; şifrelemenin amacını boşa çıkarır. Uçuş numarası, K-31 ile yolculuk bitince silinen `flight_infos` dışında 30 gün daha `trip_updates.title`'da kalır.
- Dosya:satır:
  - `backend/app/services/messages.py:92-96` önizleme ve gönderenin ilk adı (`passenger_name.split()[0]`, `driver.full_name.split()[0]`) `trip_updates.to_driver/to_customer`'a veriliyor.
  - `backend/app/services/trip_updates.py:75-80, 86` `new_message` şablonu `{text}`; `:89-92` uçuş şablonları `{flight}`; `:114-133` `TripUpdate(... body=body ...)` ve `push_outbox.enqueue(... title, body ...)`.
  - `backend/app/models/booking.py:245` `trip_updates.body` düz `String(500)`.
  - `backend/app/services/jobs.py:54` `TripUpdate` silme `created_at < now-30g`.
  - `docs/yasal_ve_guvenlik.md:27` "FCM ... yalnızca bildirim tokenı gönderilir, kimlik bilgisi gönderilmez" vaadi; push yükünde ilk ad ve mesaj metni var.
- Risk: DB dökümü/yedekte yazışma içeriği düz metin; Google'a kişi adı ve serbest metin gidiyor; uçuş verisi silme taahhüdü (K-31) fiilen 30 güne uzuyor.
- Öneri: `new_message` bildiriminde metin yerine sabit "Yeni mesaj" kullanın veya `trip_updates.body`'yi `EncryptedString` yapın; push yükünden metni çıkarın (uygulama mesajı API'den çeksin). Uçuş bildirimlerinde uçuş numarası yerine "uçuşunuz" deyin veya bu `trip_updates` satırlarını uçuş silindiğinde de silin. Dokümandaki FCM vaadini koda göre düzeltin.
- Durum: verified

### PRIV-05 Saklama süresi tanımsız ve temizlik görevi olmayan tablolar

- Kategori: KVKK m.4/2-d ve m.7, Kişisel Verilerin Silinmesi Yönetmeliği (periyodik imha); GDPR m.5/1-e
- Önem: Orta. Zamanlanmış temizlik yalnızca 4 veri türü için var; IP, cihaz bilgisi ve tamamlanmış yolculuk adres/koordinatları süresiz birikir. Yönetmelik periyodik imha süresi istiyor.
- Kanıt (verified): `backend/app/worker.py:27-41` cron'ları; `backend/app/services/jobs.py`:
  - Var: `purge_flight_data` (saatlik, `:43-46`), `purge_otp_challenges` (1 gün, `:137-139`), `purge_trip_messages` (30 gün, `:49-55`), `cancel_unpaid_bookings`, `expire_documents` (yalnızca durum değiştirir, silmez).
  - Yok (aramam bulamadı: `grep -rn -E "delete\(" backend/app --include=*.py`, jobs.py dışında yalnızca Redis anahtarları ve `storage.delete` tanımı):
    - `sessions` (ip, device_info; süresi dolmuş/iptal edilmiş satırlar)
    - `booking_legs` adres ve koordinatlar, `bookings.passenger_name/note` (tamamlanmış yolculuk sonrası)
    - `notifications`, `dispatch_offers`, `trip_events`, `payment_webhooks`
    - `audit_logs` (değiştirilemez tetikleyici, `ip` dahil; süre "hukukçu teyidi" bekliyor)
    - `consents.ip`, `data_requests`
    - Sürücü belgeleri: `storage.delete` (`backend/app/providers/storage.py:45`) hiçbir yerden çağrılmıyor; reddedilen/süresi dolan ehliyet vb. dosyalar diskte süresiz kalır (`docs/yasal_ve_guvenlik.md:37` "aktif olduğu süre + yasal süre" vaadiyle çelişir).
- Ek gözlem: `jobs.ALL_JOBS` (`jobs.py:151-159`) `purge_trip_messages`'ı içermiyor; worker fonksiyonu doğrudan çağırdığı için çalışıyor, `ALL_JOBS` başka yerde kullanılmıyor (aramam bulamadı: `grep -rn ALL_JOBS backend`). Düşük risk, bakım tuzağı.
- Ek gözlem: `docs/acik_konular.md:33` ARQ işçisinin taban çizgisinde çalışmadığını not ediyor; işçi yoksa yukarıdaki silmelerin hiçbiri çalışmaz (izleme/uyarı yok, belief).
- Öneri: Tablo bazında saklama matrisi (yasal_ve_guvenlik.md) kesinleştirilip `jobs.py`'ye görev eklenmeli: süresi geçen `sessions` silinsin; tamamlanmış bacakların adres/koordinatları X gün sonra bölge merkezine indirgensin; belge dosyaları sürücü pasif/silinince yasal süre sonunda silinsin; `audit_logs.ip` için süre belirlensin (değiştirilemezlik tetikleyicisi süreli imha ile uyumlu tasarlanmalı). İşçi canlılık kontrolü ekleyin.
- Durum: verified (kod); hukuki süre değerleri belief

### PRIV-06 Sürücü geçmiş yolculuklarında yolcu adı, tam adres ve koordinat süresiz erişilebilir

- Kategori: KVKK m.4/2-ç, GDPR m.5/1-c ve m.5/1-e; CWE-359
- Önem: Orta. Karşılama bittikten sonra sürücünün yolcu adına ve adresine ihtiyacı yok; anonimleştirilmiş müşteri için de görünür kalır (PRIV-01).
- Dosya:satır: `backend/app/api/driver.py:333-338` `list_trips(include_past=True)` tüm durumlar için `_trip_out` döndürür (tam `passenger_name`, adresler, koordinatlar, uçuş numarası silinmediyse); `:341-346` `get_trip` tamamlanmış bacağı da tam döndürür. Sınır yalnızca 200 kayıt.
- Risk: Sürücü hesabının ele geçirilmesi geçmiş tüm müşterilerin ad+adres+saat listesini sızdırır; ayrılan sürücü veriyi saklayabilir.
- Öneri: `COMPLETED`/`CANCELLED` bacaklarda `passenger_name` baş harfe indirilsin, adres ve koordinatlar `None` olsun (kazanç ekranı için tutar ve bölge yeterli). Test ekleyin.
- Durum: verified

### PRIV-07 Admin rezervasyon detayında müşteri adı maskeli ama yolcu adı, not ve adresler tam; okuma denetime yazılmıyor

- Kategori: KVKK m.12/1 (erişim kontrolü), GDPR m.5/1-f, m.32; CWE-359
- Önem: Orta. Destek rolü (OpsOrSupport) dahil tüm personel; çoğu rezervasyonda yolcu adı müşteri adıyla aynıdır, maskeleme etkisizleşir. `docs/yasal_ve_guvenlik.md:24` "Her erişim (admin dahil) audit_logs'a yazılır" vaadi bu okuma için uygulanmıyor (belge görüntüleme ve sohbet görüntüleme denetleniyor).
- Dosya:satır: `backend/app/api/admin/operations.py:132-148` `booking_detail` `customer_name` maskeli, `BookingOut.build(b)` (`backend/app/api/schemas.py:245-266`) `passenger_name` ve `note` tam döndürür; fonksiyonda `audit.record` yok. Karşılaştırma: `backend/app/api/admin/trip_review.py:54-55` sohbet görüntüleme gerekçeli denetim kaydı yazıyor.
- Öneri: Okuma denetimi ekleyin (en azından kişisel veri içeren detay uçlarında); destek rolü için yolcu adını maskelemeyi veya operasyon gereği tam gösterimi bilinçli karar olarak dokümante edin.
- Durum: verified

### PRIV-08 Netgsm entegrasyonu kullanıcı adı, parola, telefon ve OTP metnini GET sorgu dizgisinde gönderiyor

- Kategori: CWE-598 (GET sorgu dizgisinde hassas bilgi), CWE-532; KVKK m.12
- Önem: Orta. URL'ler ara vekil/sağlayıcı erişim loglarında tutulur. Ayrıca `httpx` hata nesneleri URL içerebilir ve `notifications.py:99` `log.exception` zincirli istisnayı (`raise ... from exc`, `sms.py:55`) tam traceback ile loglar.
- Dosya:satır: `backend/app/providers/sms.py:43-55`; `backend/app/services/notifications.py:98-99`.
- Risk: Log'da Netgsm parolası, alıcı telefonu ve OTP kodu birlikte görünebilir.
- Öneri: Netgsm'in POST/XML veya REST (Basic Auth) API'sine geçin; SMS hata loglarında istisna zincirini (`from None` veya özel mesaj) URL'siz loglayın.
- Durum: GET kullanımı verified; httpx istisna metninin URL'yi (sorgu dahil) içerip log'a düştüğü belief (httpx sürümüne ve hata türüne bağlı, doğrulanmadı).

### PRIV-09 IP adresi kaynağı doğrulanmadan `cf-connecting-ip` başlığından alınıyor; rıza ve denetim kanıtı sahtelenebilir

- Kategori: KVKK m.5 ve m.12 (açık rıza ispatı, veri doğruluğu m.4/2-b), GDPR m.7/1 (rızanın ispatı); CWE-348 (güvenilmeyen kaynağın kullanılması)
- Önem: Orta. `consents.ip` ve `audit_logs.ip` hukuki kanıt olarak tutuluyor; istemci başlığı serbestçe ayarlayabildiği için kanıt değeri düşer ve başkasının IP'si kayda yazdırılabilir. Cloudflare arkasında olunmadığı sürece (repoda yapılandırma yok, recon §1) tüm doğrudan istemciler (mobil) etkilenir.
- Dosya:satır: `backend/app/api/deps.py:29-31`; kullanım `backend/app/api/customer.py:203-206` (onay), `people.py`, `auth.py` vb.
- IP saklama yerleri (verified): `sessions.ip` (`identity.py:70`, süresiz), `otp_challenges.ip` (1 gün), `consents.ip` (süresiz), `audit_logs.ip` (süresiz, değiştirilemez). Aydınlatma metninde IP işleme amacı ve süresinin yazılı olup olmadığı repoda bulunamadı (aramam bulamadı: `grep -rn -i "ip adres" docs`); yasal dayanak dokümante değil.
- Öneri: Başlığı yalnızca güvenilen vekil IP aralığından gelen isteklerde kabul edin (aksi halde `request.client.host`); IP işleme amacını (güvenlik, rıza ispatı), dayanağını (KVKK m.5/2-ç/f) ve süresini aydınlatma metnine ve saklama matrisine ekleyin. `sessions.ip` için süre koyun (PRIV-05).
- Durum: verified (kod); hukuki dayanak eksikliği belief

### PRIV-10 Uçuş verisi silme (K-31): çalışıyor, ancak iptal edilen yolculuklarda 48 saat ve kopyalar kapsam dışı

- Kategori: KVKK m.7, GDPR m.5/1-e
- Önem: Düşük. Ana yol doğru uygulanmış; sapmalar sınırlı süreli.
- Kanıt (verified):
  - Yolculuk tamamlanınca `leg.flight.purge_at = now` (`backend/app/services/dispatch.py:469-474`); sürücü bitirişi (`:338`) ve müşteri bitirişi (`:354`) bu fonksiyonu çağırır.
  - Saatlik cron `purge_flight_data` `purge_at <= now` satırları siler (`backend/app/services/jobs.py:43-46`, `backend/app/worker.py:33-34`); dakikada 5'te çalışır, yani tamamlanmadan silmeye en fazla ~1 saat.
  - Yedek süre: `purge_at = pickup_at + 48 saat` (`backend/app/services/bookings.py:53, 244`); iptal edilen veya hiç tamamlanmayan bacakta uçuş bilgisi alıştan 48 saat sonra silinir. Model docstring'i (`booking.py:150`) ve fonksiyon docstring'i (`jobs.py:44`) hâlâ "24 saat" diyor (dokümantasyon tutarsızlığı).
  - Testler: `backend/tests/test_api_driver_admin.py:172` (tamamlanınca `purge_at` şimdi), `:365-367` (görev siler).
  - Kopyalar: uçuş numarası `trip_updates.title` (30 gün, PRIV-04) ve log satırlarında (`flight_tracking.py:177,180`) kalır. Uçuş numarası AeroDataBox'a gidiyor (K-60'ta beyan edilmiş).
  - Alış zamanı sonradan değişirse `purge_at` güncellenmiyor (aramam `pickup_at =` atamasını bulamadı: `grep -rn "\.pickup_at = " backend/app`), dolayısıyla risk yok.
- Öneri: İptal anında (`cancel_unpaid_bookings`, admin/müşteri iptali) `purge_at = now` yapın; docstring'leri 48 saat / K-31 ile güncelleyin; PRIV-04 düzeltmesiyle kopyaları kapatın.
- Durum: verified

### PRIV-11 Konum geçmişi: kalıcı tabloya yazılmıyor (olumlu bulgu), küçük notlar

- Kategori: KVKK m.4/2-ç, GDPR m.5/1-c
- Önem: Düşük (bilgi).
- Kanıt (verified):
  - Canlı konum yalnızca Redis `leg_loc:{leg_id}`, TTL 120 sn (`backend/app/services/live_location.py:20-35`); yalnızca aktif durumlarda kabul (`backend/app/api/driver.py:381-389`); bitişte `clear` (`driver.py:368-369`, `trips.py:281`).
  - Modellerde sürücü konum alanı yok (aramam bulamadı: `grep -rn -i -E "last_lat|last_lng|current_location|location" backend/app/models/*.py` yalnızca `pricing.py:30` bölge merkezi). `TripEvent` konum taşımaz (`booking.py:197-208`).
  - ETA ve rota önbelleği Redis'te TTL'li (`eta.py:97`, `route_line.py:60`).
- Notlar: Redis parolasız ve hostta açık (recon §1); konum verisi ağdan okunabilir (altyapı alanı). Admin paneli canlı konumu görebiliyor (`operations.py:53`), denetim kaydı yok. Sürücü konumu Google Routes'a ETA için gidiyor (dokümanda beyan edilmiş).
- Öneri: Redis'e parola/TLS; admin canlı konum görüntülemesini denetime yazmayı değerlendirin.
- Durum: verified

### PRIV-12 Konsol push sağlayıcısı jeton ön ekini, ilk adı ve mesaj metnini WARNING ile logluyor

- Kategori: CWE-532
- Önem: Düşük. Prod'da `push_provider == "console"` reddediliyor (`config.py:128-129`); yalnızca dev/CI log'larını etkiler. CI emülatör iş akışları bu modda çalışıyor ve artefakt yüklüyor (recon §7).
- Dosya:satır: `backend/app/providers/push.py:51`.
- Öneri: Gövdeyi loglamayın veya kısaltın; CI artefaktlarında backend log'u varsa gözden geçirin (belief: artefakt içeriği okunmadı).
- Durum: verified (log satırı); CI artefakt içeriği belief

### PRIV-13 Veri talebi notu ve uçuş takip log'ları düz metin

- Kategori: KVKK m.12; CWE-312
- Önem: Düşük.
- Dosya:satır:
  - `backend/app/models/customer.py:70` `data_requests.note` `String(1000)` düz; müşteri serbest metinde sağlık, kimlik vb. yazabilir. Personel notu müşterinin notunun üzerine yazılıyor (`people.py:84-85`), talep içeriği kaybolur.
  - `backend/app/services/flight_tracking.py:177,180` uçuş numarası + bacak id WARNING/EXCEPTION.
- Öneri: `note` için `EncryptedString`; müşteri notu ve personel notu ayrı alan. Log'da uçuş numarasını maskeleyin.
- Durum: verified

## Recon log noktaları tablosu üzerinden değerlendirme (görev d)

| Nokta | PII | Değerlendirme |
|---|---|---|
| `sms.py:30` | tam telefon + SMS metni (OTP) | Doğrulandı. PRIV-02 (Yüksek) |
| `sms.py:58` | Netgsm yanıtının 20 karakteri | PII yok |
| `push.py:51` | jeton ilk 8 karakter, başlık, gövde (ilk ad, mesaj metni) | PRIV-12 (yalnızca dev) |
| `services/payments.py:110,132` | merchant_oid, tutar | Kişisel veri değil (rezervasyonla ilişkilendirilebilir takma ad), kabul edilebilir |
| `flight_tracking.py:65,67,177,180` | uçuş no, bacak id | PRIV-13 (Düşük) |
| `eta.py:83,99`, `route_line.py:62,112,122` | `exc_info=True` | Routes istisnasında koordinat/URL içeriği: belief, doğrulanmadı |
| `notifications.py:99` | `log.exception` | PRIV-08: zincirli httpx istisnası URL'yi içerebilir (belief) |
| `push_outbox.py:82,98` | `log.exception` | FCM hata gövdesi jeton içerebilir: belief |
| `jobs.py:66`, `worker.py:23` | yok | Temiz |
| `cli.py:33-47` | admin id | Temiz |

Logging yapılandırması: aramam `basicConfig|dictConfig` bulamadı (`grep -rn -E "basicConfig|dictConfig|log_config" backend/app`); uvicorn/arq varsayılanları geçerli. Varsayılanda root WARNING olduğundan httpx INFO istek log'ları (tam URL) görünmez; prod log seviyesi INFO'ya çekilirse Netgsm URL'si (parola + telefon + OTP) her gönderimde loglanır (belief).

## Kapsam notları

- Okunmadı: web/admin/mobil istemci tarafı kişisel veri gösterimi ve yerel saklama (ör. mobilde mesaj/bildirim önbelleği), PayTR'ye gönderilen kişisel alanlar (`providers/payments.py` istek gövdesi), `payment_webhooks` maskelemesinin tam alan listesi, fatura modelinin kişisel alanları, yedekleme ve yurt dışı aktarım (Google, FCM, AeroDataBox, RapidAPI; KVKK m.9) sözleşme/aydınlatma durumu.
- Dinamik test yapılmadı.
