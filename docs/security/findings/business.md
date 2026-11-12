# Alan 7: Ödeme ve iş mantığı suistimali

- Tarih: 2026-11-12, dal `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Yöntem: statik okuma. Servis çalıştırılmadı, dinamik test yapılmadı. Kod değiştirilmedi.
- Etiket: `verified` = kod satırı okundu; `belief` = çıkarım, bağımsız doğrulanmalı.
- Okunan dosyalar: `backend/app/services/{quotes,places,bookings,payments,dispatch,live_location,jobs}.py`, `backend/app/api/{public,customer,payments,driver,trips,schemas}.py`, `backend/app/api/admin/{operations,finance,manual_bookings,catalog}.py`, `backend/app/providers/payments.py`, `backend/app/{config,pricing,cancellation,commission,currency}.py`, `backend/app/models/{booking,finance}.py`.

## Özet

| Önem | Sayı | ID |
|---|---|---|
| Kritik | 0 | - |
| Yüksek | 1 | BIZ-01 |
| Orta | 3 | BIZ-02, BIZ-03, BIZ-04 |
| Düşük | 5 | BIZ-05, BIZ-06, BIZ-07, BIZ-08, BIZ-09 |
| Bilgi | 2 | BIZ-10, BIZ-11 |

---

## BIZ-01: Ortam ayarı varsayılanı "fail-open": GETAWAY_ENV yoksa sahte ödeme sağlayıcısı ve girişsiz "ödemeyi onayla" ucu açılıyor

- OWASP: A05 Security Misconfiguration, A04 Insecure Design. CWE-1188 (güvensiz varsayılan), CWE-306 (kritik işlevde kimlik doğrulama yok).
- Önem: Yüksek. Ön koşul yalnızca bir ortam değişkeninin unutulması ya da yanlış yazılması (`production`, `staging` gibi). Sonuç: herhangi bir müşteri kendi rezervasyonunu para ödemeden "ödendi" yapabilir. Ön koşul yüzünden Kritik verilmedi.
- Konum:
  - `backend/app/config.py:24`: `env: str = "dev"`; değer serbest metin, `Literal` değil.
  - `backend/app/config.py:91`: `payment_provider: str = "fake"`.
  - `backend/app/config.py:116,125`: sahte sağlayıcı yalnızca `env == "prod"` (tam eşleşme) olduğunda reddediliyor.
  - `backend/app/api/payments.py:62-66`: sahte uçlar `env != "prod"` ve sağlayıcı Fake ise açık.
  - `backend/app/api/payments.py:81-92`: POST `/api/v1/payments/fake/{oid}/complete` kimlik doğrulaması istemiyor. İmzayı sunucu kendisi üretip `handle_callback` çağırıyor.
  - `backend/app/api/customer.py:123-130`: müşteri `iframe_url` alanında `merchant_oid` bilgisini zaten alıyor (`providers/payments.py:191`).
- Kavramsal istismar: Üretim `GETAWAY_ENV` verilmeden (varsayılan `dev`) ya da `GETAWAY_ENV=production` ile açılıyor. `env != "test"` kuralı yalnızca Google anahtarını zorunlu tutuyor, bu yüzden uygulama sorunsuz açılıyor. Müşteri rezervasyon oluşturuyor, POST `/me/bookings/{code}/payments` ile `iframe_url` içinden `oid` değerini alıyor, ardından gerçek API alan adına `POST /api/v1/payments/fake/{oid}/complete` (status=success) gönderiyor. Rezervasyon CONFIRMED oluyor, iş sürücü havuzuna düşüyor, fatura kuyruğa giriyor. Aynı ayarda dev JWT, Fernet ve blind-index anahtarları da reddedilmiyor. Bu kısım başka alanın konusu, burada yalnızca not olarak geçiyor.
- Önerilen düzeltme: `env` alanını `Literal["dev","test","prod"]` yap, bilinmeyen değerde açılışı reddet. `payment_provider` için varsayılanı kaldır ya da `env` belirtilmemişse uygulamayı açma. Sahte uçları yalnızca `env in {"dev","test"}` iken router'a ekle (koşullu `include_router`). İsteğe bağlı: sahte onay ucunda ödeme sahibinin oturumunu iste.
- Etiket: verified (kod yolu). Üretim dağıtımında ortam değişkenlerinin nasıl verildiği belief; repoda dağıtım yapılandırması yok (recon §1).

## BIZ-02: Sürücü yolculuğu zaman ve konum kontrolü olmadan "tamamlandı" yapabiliyor (GPS sahteciliği, erken bitirme)

- OWASP: A04 Insecure Design. CWE-840 (iş mantığı hatası), CWE-602 (istemci tarafı güvenlik kontrolüne güvenme).
- Önem: Orta. Onaylı sürücü hesabı gerekiyor (içeriden kişi). Etkisi: sahte hakediş oluşuyor, müşteri iptal ve iade hakkını kendi başına kullanamıyor. Denetim izi var ve admin hakedişi iptal edebiliyor (K-57). Bu yüzden Yüksek verilmedi.
- Konum:
  - `backend/app/services/dispatch.py:301-341` (`advance_trip`): DEPARTED, ARRIVED ve STARTED adımlarında konum ya da zaman kontrolü yok. `pickup_at` ile bir karşılaştırma yok, adımlar arasında asgari süre yok.
  - `backend/app/services/dispatch.py:319-328`: FINISHED adımında tek kontrol, istemcinin gönderdiği `lat/lng` değerinin varışa `finish_radius_m` içinde olması.
  - `backend/app/api/driver.py:349-366`: koordinat istek gövdesinden geliyor. Gövdede yoksa Redis'teki son konum kullanılıyor, o da yine sürücünün gönderdiği değer (`driver.py:381-390`, `live_location.py:33-35`). Konumun makul olup olmadığına (zaman damgası, hız, konum geçmişi) bakılmıyor.
  - `backend/app/api/trips.py:143,177`: `/trips/{leg_id}/approach` sürücüye hedefin tam koordinatını (`target_lat/lng`) ve bitirme yarıçapını dönüyor. Sahte konum için gereken veri hazır geliyor.
  - `backend/app/services/dispatch.py:469-493`: bitirişte `DriverLedger` (PENDING) hakedişi oluşuyor.
  - `backend/app/services/bookings.py:287,290`: COMPLETED rezervasyonu ne müşteri ne personel iptal edebiliyor.
- Kavramsal istismar: Sürücü havuzdan bir hafta sonraki planlı bir işi alıyor, ardından 4 olayı arka arkaya gönderiyor. FINISHED isteğinde `approach` ucunun döndüğü varış koordinatını yolluyor. Bacak COMPLETED oluyor, hakediş yazılıyor, müşteriye "yolculuk bitti" bildirimi gidiyor, rezervasyon COMPLETED oluyor. Müşteri artık iptal edip politika iadesi alamıyor. Sonraki toplu ödeme (`/admin/payouts`) bu hakedişi kapsıyor. Sahte konum, müşteriye "yaklaşıyor / 10 dk" bildirimleri de tetikliyor (`driver.py:390`).
- Önerilen düzeltme: (1) DEPARTED en erken `pickup_at - X` saatinde, STARTED en erken `pickup_at - tolerans` anında kabul edilsin. (2) FINISHED için STARTED'dan sonra asgari süre aransın (ör. `duration_minutes * 0.5`). (3) Bitirmede, son N konum örneğinden hız ve sıçrama makullük kontrolü yapılsın. (4) Hakediş, tamamlandıktan sonra bir bekleme süresi geçmeden toplu ödemeye alınmasın, müşteri itirazına süre kalsın. (5) Müşteriye "yolculuk tamamlanmadı" itiraz akışı eklensin.
- Etiket: verified.

## BIZ-03: İade sağlayıcı çağrısı DB işlemi içinde ve idempotent değil; yeniden denemede ve commit hatasında çift iade riski

- OWASP: A04 Insecure Design. CWE-362 (yarış durumu), CWE-841 (iş akışının zorlanmaması).
- Önem: Orta. Para kaybı, ödeme tutarının tamamına kadar çıkabilir. Tetikleyici bir ağ zaman aşımı ya da commit hatası, kötü niyet gerekmiyor. PayTR tarafındaki tavan doğrulanmadığı için Yüksek verilmedi.
- Konum:
  - `backend/app/services/bookings.py:502-509`: `provider.refund()` çağrısı, satır kilitleri tutulurken işlemin ortasında yapılıyor. Bağlantı hatası olursa (`providers/payments.py:168-172`, 20 sn zaman aşımı) kayıt FAILED yazılıyor. Oysa PayTR iadeyi işlemiş olabilir.
  - `backend/app/providers/payments.py:156-167`: iade isteğinde idempotency ya da referans alanı gönderilmiyor. `grep -rn "reference_no\|idempot" backend/app` yalnızca yanıt okumasında eşleşti.
  - `backend/app/api/admin/finance.py:68-80` (`retry_refund`): yalnızca Refund satırını kilitliyor, Payment satırını kilitlemiyor. FAILED kayıt toplamlara girmediği için (`bookings.py:488-496`, `421-428`) eşzamanlı bir `staff_refund` kalan tutarın tamamını alabiliyor, retry de üstüne kontrolü geçiyor.
  - `backend/app/services/bookings.py:331-418` (`cancel_booking`): sağlayıcı iadesi başarılı olduktan sonra commit başarısız olursa rezervasyon iptal edilmemiş görünüyor ve iade kaydı kayboluyor. Müşteri iptali yeniden deneyince ikinci iade çıkıyor.
- Kavramsal istismar: (a) PayTR iadeyi işliyor ama yanıt zaman aşımına düşüyor. Kayıt FAILED kalıyor, muhasebe "tekrar dene" diyor ve ikinci iade çıkıyor. (b) Bir operasyon personeli FAILED kayıt üzerinde "retry" yaparken bir diğeri aynı ödemeye elle tam iade veriyor. İki iade de kontrolü geçiyor. (c) İptal isteğinde PayTR iadesi başarılı oluyor, `db.commit()` hata veriyor. Müşteri tekrar iptal ediyor.
- Önerilen düzeltme: Refund satırını önce PENDING olarak commit et, sağlayıcıyı işlem dışında çağır, sonucu ayrı bir işlemle yaz (outbox deseni). Zaman aşımında FAILED yerine UNKNOWN durumu kullan ve PayTR iade sorgusuyla mutabakat yap. `retry_refund` içinde `paid_payment(..., lock=True)` ile Payment satırını kilitle ve kalan tutarı yeniden kontrol et. PayTR iadesinde benzersiz bir referans kullan.
- Etiket: kod yolu verified. PayTR iade API'sinin toplam tavanı ve idempotency davranışı belief (PayTR belgesiyle doğrula).

## BIZ-04: Admin fiyat ezme tutarı sınırsız; aynı rol elle "nakit alındı" kaydı da girebiliyor (görev ayrılığı yok)

- OWASP: A04 Insecure Design, A01 Broken Access Control (görev ayrılığı). CWE-840, CWE-269.
- Önem: Orta. Personelin içeriden kötüye kullanımı gerekiyor. Denetim kaydı var (`bookings.py:263-281`, `payments.py:203-205`). Ancak tek bir OpsStaff hesabı (ya da ele geçirilmiş bir OpsStaff oturumu) tek başına sahte gelir ve şişirilmiş hakediş üretebiliyor.
- Konum:
  - `backend/app/api/admin/manual_bookings.py:205`: `override_total: Decimal | None = Field(gt=0, decimal_places=2)`. Üst sınır yok, sistem fiyatına göre oran sınırı yok.
  - `backend/app/services/bookings.py:76-87,158-161`: tek kontrol "garanti ücretinden büyük". Bacak fiyatları ezilen tutara göre ölçekleniyor.
  - `backend/app/services/dispatch.py:475`: hakediş `leg.leg_price` üzerinden hesaplanıyor, yani ezilen fiyattan.
  - `backend/app/api/admin/manual_bookings.py:288,325-330,337-348`: rezervasyonu oluşturma ve elle tahsilat kaydı aynı `OpsStaff` rolünde. Tahsilatın kanıtı (`reference`) isteğe bağlı.
- Kavramsal istismar: OpsStaff, işbirliği yaptığı bir sürücü için 300 € değerindeki işi `override_total=5000` ile açıyor ve `payment={method: nakit, amount: 5000}` kaydını giriyor. Para hiç alınmıyor. Sürücü işi alıp bitiriyor (BIZ-02 ile sahte bitiriş de mümkün). Hakediş yaklaşık 3750 € oluyor ve muhasebenin topluca oluşturduğu `/admin/payouts` kaydına giriyor. Ters yönde, fiyat 0,01'e çekilip müşteriye neredeyse bedava transfer verilebiliyor.
- Önerilen düzeltme: Ezme oranı için yapılandırılabilir bir sınır koy (ör. sistem fiyatının %50-%150 aralığı). Bu sınırı aşan ezmede ya da her elle tahsilatta ikinci bir onay iste (FinanceStaff). Elle tahsilatta `reference` zorunlu olsun. Hakediş hesaplaması `system_total_amount` ile ezilen tutardan küçük olanı esas alsın ya da ezilen rezervasyonun hakedişi onaya düşsün.
- Etiket: verified.

## BIZ-05: Bölge seçiminde fiyat ilçe merkezinden hesaplanıyor, gerçek adres serbest metinle veriliyor

- OWASP: A04 Insecure Design. CWE-840.
- Önem: Düşük. Doküman "ilçe doğrudan seçilebilir" diyor (`docs/fiyatlandirma.md:30`), yani bilinçli bir tasarım. Kayıp, ilçe içi mesafeyle sınırlı. Sürücü farkı sahada fark eder.
- Konum: `backend/app/api/public.py:56` (jeton yoksa yalnızca `region_id`, `address` serbest metin), `backend/app/services/quotes.py:127-129` (koordinat yoksa bölge merkezi kullanılıyor), `backend/app/services/dispatch.py:291-294` (bitirme yarıçapı 3000 m).
- Kavramsal istismar: Müşteri bırakış için hedefe en yakın ilçe merkezini `region_id` ile seçiyor. `address` alanına ise ilçe merkezinden 30 km uzaktaki gerçek oteli yazıyor. Fiyat kısa mesafeden çıkıyor. Sürücü oteli götürünce 3000 m yarıçap dışında kaldığı için yolculuğu bitiremiyor ve BIZ-02'deki sahte konuma itiliyor.
- Önerilen düzeltme: Bölge seçiminde serbest adres girildiyse sürücüye "konum doğrulanmadı" uyarısı göster ya da varışta gerçek mesafe farkını işaretle. Ya da serbest metin adresi yalnızca jetonlu seçimde kabul et.
- Etiket: kod yolu verified, iş etkisi belief.

## BIZ-06: Para birimini istemci seçiyor (country_code), kur günlük; TRY/EUR arasında ucuz olanı seçmek mümkün

- OWASP: A04. CWE-840.
- Önem: Düşük. Fark kur güncelleme gecikmesi ve 5 TL yuvarlamasıyla sınırlı.
- Konum: `backend/app/api/schemas.py:113`, `backend/app/currency.py:20-23`, `backend/app/services/quotes.py:200-205`. `backend/app/api/customer.py:64-66` yalnızca alan boşsa profil ülkesini kullanıyor. Ayrıca `pickup_at` için üst sınır yok (`schemas.py:109`, `bookings.py:163-171`): fiyat ve kur çok ileri bir tarih için de rezervasyon anında donduruluyor.
- Kavramsal istismar: Müşteri aynı teklifi `country_code=TR` ve `DE` ile alıp ucuz çıkan para birimiyle rezervasyon yapıyor. Kur sert hareket ettiğinde gün içinde arbitraj yapabiliyor.
- Önerilen düzeltme: Para birimini profil ya da kart BIN ülkesiyle bağla, istek gövdesindeki değeri yok say. `pickup_at` için azami ileri tarih koy (ör. 365 gün).
- Etiket: verified.

## BIZ-07: Ödeme bildiriminde para birimi doğrulanmıyor; total_amount eksikse tutar kontrolü atlanıyor

- OWASP: A08 Software and Data Integrity Failures (derinlemesine savunma). CWE-345.
- Önem: Düşük. Bu alanlar PayTR imzasının içinde (`providers/payments.py:144`), yani dışarıdan değiştirilemiyor. Risk yalnızca sağlayıcı tarafındaki bir hata ya da yanlış yapılandırma.
- Konum: `backend/app/services/payments.py:129` (`result.total_amount is not None and ...`: alan yoksa ya da sayı değilse PAID oluyor), `backend/app/providers/payments.py:150`. Callback'te `currency` alanı hiç okunmuyor.
- Kavramsal istismar: PayTR bildirimi `total_amount` alanı olmadan ya da beklenenden farklı para biriminde gelirse ödeme PAID işaretleniyor.
- Önerilen düzeltme: `total_amount is None` olduğunda ödemeyi reddet. Varsa `currency` alanını `payment.currency` ile karşılaştır.
- Etiket: verified.

## BIZ-08: accept_job ile accept_offer arasında kilit sırası ters; kilitlenme (deadlock) olasılığı

- OWASP: A04. CWE-833 (deadlock).
- Önem: Düşük. Veri bütünlüğü bozulmuyor; PostgreSQL bir işlemi iptal ediyor ve kullanıcı 500 alıyor.
- Konum: `backend/app/services/dispatch.py:432-451` (önce bacak kilitleniyor, sonra `assign` içinde diğer tekliflerin satırları güncelleniyor, `198-205`). `226-236`: `accept_offer` önce teklifi, sonra bacağı kilitliyor.
- Kavramsal istismar: Sürücü A havuzdan işi kabul ediyor (bacak kilidi alınıyor, B'nin teklif satırını WITHDRAWN yapmaya çalışıyor). Aynı anda sürücü B kendi teklifini kabul ediyor (teklif kilidi alınıyor, bacak kilidini bekliyor). Döngüsel bekleme oluşuyor. Çift atama oluşmuyor: bacak kilidi ve `driver_id` kontrolü doğru çalışıyor.
- Önerilen düzeltme: `accept_job` içinde önce bacak teklif satırlarını sabit sırayla kilitle, ya da `accept_offer` içinde de bacağı teklifden önce kilitle. Deadlock hatasını 409 olarak dön.
- Etiket: belief (eşzamanlı test ile doğrula).

## BIZ-09: Ödeme sayfası yeniden kullanım penceresi (25 dk) PayTR sayfa ömründen (30 dk) kısa; aynı rezervasyon için iki canlı sayfa olabiliyor

- OWASP: A04. CWE-362.
- Önem: Düşük. İkinci ödeme otomatik iade ediliyor (`payments.py:140-147`). Otomatik iade başarısız olursa müşteri admin retry yapana kadar iki kez ödemiş kalıyor (BIZ-03 ile birleşebilir).
- Konum: `backend/app/services/payments.py:31,34-47`, `backend/app/providers/payments.py:126`.
- Önerilen düzeltme: Pencereyi PayTR `timeout_limit` değerinden uzun tut (ör. 31 dk). Ya da yeni sayfa açmadan önce eskisini geçersiz say.
- Etiket: verified.

## BIZ-10 (Bilgi): Tamamlanmış yolculukta tam iade, sürücü hakedişini etkilemiyor

- `backend/app/services/bookings.py:431-461` (`staff_refund`) hakedişe dokunmuyor. `cancel_booking` içinde `cancel_driver_earnings` varsayılan olarak `False` (`api/admin/operations.py:187`). K-57'ye göre tasarım bu. Operatör hakedişi ayrıca iptal etmeyi unutursa şirket iki kez kaybediyor. Öneri: tam iadede arayüz hakediş iptalini sorsun ya da varsayılanı "iptal et" olsun.
- Etiket: verified.

## BIZ-11 (Bilgi): Rezervasyon kodu tahmin edilebilirliği

- `backend/app/services/bookings.py:51,90-91`: `GA` + 6 karakter, 31 harflik alfabe, `secrets.choice` (CSPRNG). Yaklaşık 8,9x10^8 olasılık. Kod tek başına yetki vermiyor: müşteri uçları kodu `customer_id` ile birlikte arıyor (`api/customer.py:48-54`), bağlantı açılınca SMS girişi isteniyor (`notifications.py:68-71`). `merchant_oid` = kod + `token_hex(4)` (`payments.py:71`). Sorun görülmedi. Not: benzersizlik kontrolü "önce kontrol et, sonra ekle" şeklinde (`bookings.py:178-180`); çakışmada `unique` kısıtı 500 hatası verir, olasılık ihmal edilebilir.
- Etiket: verified.

---

## Olumsuz bulgular (kontrol edildi, açık bulunamadı)

- Fiyat sunucuda hesaplanıyor. İstemciden fiyat, mesafe ya da çarpan kabul eden uç yok. `expected_total` yalnızca karşılaştırma için kullanılıyor (`bookings.py:151-156`). İstemcinin gönderdiği `lat/lng` yok sayılıyor (`public.py:54-56`, `schemas.py:75-82`). verified
- Adres jetonu: HS256, `algorithms=["HS256"]` sabit, `typ == "place"` kontrolü var, `exp` var. Bölge ve koordinat sunucudaki Google yanıtından yazılıyor (`services/places.py:71-98`). Erişim jetonu tarafında `typ` kontrolü olduğu için jetonlar birbirinin yerine kullanılamıyor (recon §3.1). Koordinatın bölge yarıçapında olup olmadığı yeniden kontrol ediliyor (`quotes.py:127-134`). Kurcalamaya kapalı. verified
- Webhook: HMAC `compare_digest`. Tutar istemciden değil, DB'deki `payment.amount` değerinden karşılaştırılıyor. Payment ve Booking `FOR UPDATE` ile kilitleniyor, tekrar gelen bildirim işlenmiyor (`services/payments.py:113-121`). verified
- İş havuzu ve teklif kabulü: bacak `FOR UPDATE` ile kilitleniyor (`db.get(..., with_for_update)` kimlik haritasını atlayıp SELECT FOR UPDATE çalıştırıyor), ardından `driver_id` yeniden okunuyor (`dispatch.py:233-240,432-438`). Çift atama görülmedi. verified (SQLAlchemy davranışı belief değil, 2.0 `Session.get` with_for_update belgelenmiş davranış)
- Çift hakediş: `driver_ledger.booking_leg_id` UNIQUE (`models/finance.py:95`). Sürücü bitirişi ve müşteri bitirişi bacağı kilitliyor (`driver.py:358`, `dispatch.py:349`). verified
- Çift iade (normal yol): `paid_payment(lock=True)` + `refundable_amount` + `execute_refund` toplam kontrolü (`bookings.py:293-305,421-428,488-496`). İptal sırasında bacak ve rezervasyon kilitleniyor (`bookings.py:308-317`). verified
- Negatif tutar: `AdminRefundIn.amount gt=0` (`operations.py:202`), `refund_percent 0-100` (`operations.py:185`, `bookings.py:353-356`), `ManualPaymentIn.amount gt=0`, komisyon `0 <= rate < 1` (`commission.py:58-59`, `catalog.py`), kur `gt=0`. verified
- Toplu ödeme yarışı: `create_payouts` bekleyen hakedişleri `FOR UPDATE` ile alıyor. Ödeme kaydına girmiş hakediş iptal edilemiyor (`finance.py:118-123`, `bookings.py:470-479`). verified
- Kupon / indirim kodu: aramam bulamadı (komut: `grep -rn -i "no_show\|noshow\|coupon\|kupon\|promo\|voucher\|indirim_kod\|discount_code" --include=*.py backend/app`). Tek indirim, admin tanımlı gidiş-dönüş indirimi (`quotes.py:186`, `catalog.py` AdminOnly).

## Kapsam dışı bırakılanlar / okunmayanlar

- `backend/app/services/eta.py`, `trip_updates.py`, `notifications.py` içeriği ayrıntılı okunmadı. Yalnızca tetiklenme noktalarına bakıldı.
- Mobil sürücü uygulamasının konumu nasıl topladığı (mock location tespiti var mı) okunmadı.
- PayTR iade ve bildirim API davranışı (idempotency, toplam tavanı, aynı `merchant_oid` için birden fazla bildirim) belgeyle doğrulanmadı.
- Eşzamanlılık iddiaları (BIZ-03(b), BIZ-08) testle doğrulanmadı.
- Admin rol yetkileri (fiyat kuralı, araç çarpanı) yalnızca sınır değerleri için okundu.
