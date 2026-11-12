# Alan 8: Gerçek zamanlı iletişim (WebSocket, canlı konum, sohbet, bildirim, Redis)

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Yöntem: statik okuma. Çalışan servis yok, dinamik test yapılmadı. Kod değiştirilmedi.
- Etiketler: `verified` dosya okundu veya komutla görüldü; `belief` çıkarımdır, bağımsız doğrulanmalı.
- Secret değerleri yazılmadı.

## Özet

| ID | Başlık | Önem | Durum |
|---|---|---|---|
| RT-01 | Redis parolasız ve tüm arayüzlere açık; ARQ pickle ile worker'da kod çalıştırma zinciri | Yüksek (dev) | verified (kod), belief (ağ erişimi) |
| RT-02 | Üretim yapılandırma doğrulayıcısı Redis kimlik doğrulaması ve TLS'i zorunlu kılmıyor | Orta | verified |
| RT-03 | WebSocket jetonu yalnızca bağlantı başında doğrulanıyor; çıkış/oturum iptali/jeton süresi bitişi akışı kesmiyor | Orta | verified |
| RT-04 | WebSocket döngüsü async içinde senkron DB ve Redis çağrıları yapıyor; Redis istemcisinde zaman aşımı yok (olay döngüsü kilitlenmesi, DoS) | Orta | verified (kod), belief (etki büyüklüğü) |
| RT-05 | WebSocket bağlantı sayısı, süre ve kimlik öncesi bağlantı için sınır yok | Düşük | verified |
| RT-06 | Şifreli saklanan sohbet metni, bildirim akışında (`trip_updates.body`) ve push yükünde düz metin | Düşük | verified |
| RT-07 | Bacak başka sürücüye devredilince yeni sürücü önceki sürücüyle yapılan yazışmayı okuyabiliyor | Düşük | verified (kod), belief (iş kuralı niyeti) |
| RT-08 | Push jetonu kaydında cihaz sahipliği doğrulanmıyor; bilinen bir jeton başka hesaba bağlanabiliyor | Düşük | belief |
| RT-09 | Sürücü konumu tamamen istemci beyanı; bitirme yarıçapı (K-49) sahte konumla aşılabilir | Bilgi | verified (kod) |
| RT-10 | Sohbet hız sınırı say-sonra-ekle (yarış durumu) | Bilgi | belief |

Önem dağılımı: Kritik 0, Yüksek 1, Orta 3, Düşük 4, Bilgi 2.

---

## RT-01 Redis parolasız ve tüm arayüzlere açık; ARQ pickle ile worker'da kod çalıştırma zinciri

- OWASP: A05:2021 Security Misconfiguration. CWE-306 (Missing Authentication for Critical Function), CWE-502 (Deserialization of Untrusted Data), CWE-668.
- Önem: Yüksek (geliştirme ortamı için). Gerekçe: Redis'e ağdan erişebilen kimliği doğrulanmamış biri (a) canlı sürücü konumlarını okuyabilir, (b) sahte konum yazabilir, (c) ARQ kuyruğuna pickle yükü koyarak worker sürecinde kod çalıştırabilir. Etki sistemin tamamı (worker DB bağlantı bilgisi, alan şifreleme anahtarları ortam değişkenlerinde). Olasılık geliştirici makinesinin bulunduğu ağa bağlı (ortak Wi-Fi, ofis LAN). Üretim topolojisi repoda yok; üretimde aynı yapılandırma kullanılıyorsa Kritik olur.
- Konum:
  - `docker-compose.yml:18-21`: `redis:7-alpine`, `requirepass` veya `command` yok, `ports: "6379:6379"` (host IP verilmemiş, Docker varsayılanı 0.0.0.0). verified
  - `backend/app/config.py:26`: `redis_url` varsayılanı kimlik bilgisi ve TLS içermiyor. verified
  - `backend/app/services/live_location.py:29-35`: anahtar `leg_loc:{leg_id}`, düz JSON `{lat,lng,heading,at}`, TTL 120 sn. verified
  - `backend/app/worker.py:44-45`: `RedisSettings.from_dsn(...)`, `job_deserializer` verilmemiş, yani varsayılan `pickle.loads`. verified
  - arq 0.28.0 `arq/worker.py:519-532` (main checkout `.venv`): `deserialize_job_raw(v, deserializer=self.job_deserializer)` fonksiyon adı kontrolünden (`self.functions[function_name]`) önce çalışıyor; `functions: list = []` olması koruma sağlamıyor. verified (`sed -n 505,535p .../site-packages/arq/worker.py`)
- Redis'teki diğer veriler: `leg_eta:*`, `leg_eta_ms:*` (`eta.py:48-53`), rota önbelleği (`route_line.py`), uçuş sayaçları (`flight_tracking.py:52`), Places IP sayaçları (`places.py:106-112`). verified
- Kavramsal istismar:
  1. Aynı ağdaki saldırgan 6379'a bağlanır, `KEYS leg_loc:*` / `SCAN` ile aktif yolculukların kesin konumunu ve yönünü 3 sn'de bir izler (kişisel veri, fiziksel güvenlik).
  2. `SET leg_loc:<id>` ile müşteriye sahte sürücü konumu gösterir; `trip_event` FINISHED olayında konum gönderilmezse son Redis konumu kullanıldığı için (`driver.py:364-365`) varış yarıçapı kontrolünü de etkileyebilir.
  3. `arq:job:<id>` anahtarına zararlı pickle yazıp `arq:queue` zset'ine ekler; worker işi çektiğinde `pickle.loads` worker hostunda komut çalıştırır.
  4. Places sayaçlarını silip ücretli API hız sınırını sıfırlar.
- Önerilen düzeltme:
  - Compose: `ports: "127.0.0.1:6379:6379"` (aynısı `db` için de geçerli, ayrı alan), `command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]` ve parolanın `.env` üzerinden verilmesi; `redis_url` `redis://:<parola>@...` ile.
  - Üretimde Redis yalnızca özel ağda, ACL kullanıcısı (en az yetki, `-@dangerous`), TLS (`rediss://`).
  - ARQ için pickle yerine JSON (veya msgpack) serializer: `WorkerSettings.job_serializer/job_deserializer` ve `create_pool(..., job_serializer=..., job_deserializer=...)`.
  - Doğrulama: Docker Desktop'ın Windows'ta 0.0.0.0 bağlamasının güvenlik duvarıyla LAN'a açılıp açılmadığı test edilmeli (belief).

## RT-02 Üretim yapılandırma doğrulayıcısı Redis kimlik doğrulaması ve TLS'i zorunlu kılmıyor

- OWASP: A05:2021. CWE-1188 (Insecure Default Initialization), CWE-319.
- Önem: Orta. Gerekçe: Diğer gizli değerler (`jwt_secret`, Fernet, blind index) için üretim koruması var, Redis için yok; yanlış yapılandırma sessizce geçer. Sömürü ağ erişimine bağlı, etkisi RT-01 kadar büyük.
- Konum: `backend/app/config.py:114-130` (`_no_dev_secrets_in_prod`): `redis_url` kontrol edilmiyor. `config.py:26` varsayılanı `redis://localhost:6379/0`. verified. Ayrıca `database_url` varsayılanı da dev kimlik bilgisiyle kontrol dışı (bu alanın dışında, yalnızca not).
- Kavramsal istismar: Üretimde `GETAWAY_REDIS_URL` verilmez veya parolasız verilirse uygulama açılır; RT-01 zinciri üretimde geçerli olur.
- Önerilen düzeltme: `env == "prod"` iken `redis_url` için parola (veya ACL kullanıcı adı) ve `rediss://` şemasını zorunlu tutan kontrol; `database_url` dev değerine eşitse reddetme.

## RT-03 WebSocket jetonu yalnızca bağlantı başında doğrulanıyor; oturum iptali ve jeton süresi akışı kesmiyor

- OWASP: A07:2021 Identification and Authentication Failures. CWE-613 (Insufficient Session Expiration).
- Önem: Orta. Gerekçe: Çıkış yapan, oturumu iptal edilen, hesabı pasife alınan veya anonimleştirilen müşterinin açık bağlantısı kesintisiz kesin konum almaya devam eder. Kimlik ve konum (kişisel veri) kesişimi. Sömürü için önceden geçerli bir jeton ve sahiplik gerekir, bu da olasılığı düşürür.
- Konum: `backend/app/api/customer.py:272-282`. Kimlik `current_principal` + `current_customer` + `_own_booking` ile yalnızca ilk mesajda (`:274-276`) kontrol edilir; döngü (`:278-282`) yalnızca `booking_id` ile `db.get(Booking, ...)` yapar, oturum (`get_active_session`, `services/auth.py:92-98`), JWT `exp` (30 dk), `customer.deleted_at` veya `booking.customer_id` tekrar kontrol edilmez. Döngünün çıkış koşulu yok; yolculuk bitse de bağlantı sonsuza dek `{"location": null}` gönderir. verified
- Kavramsal istismar: Çalınmış cihazdaki veya paylaşılan hesaptaki oturum admin tarafından iptal edilir; saldırganın önceden açtığı WebSocket aynı rezervasyonun sonraki (ör. dönüş) bacağında da sürücü konumunu almaya devam eder. Erişim jetonunun 30 dk ömrü fiilen sınırsız olur.
- Önerilen düzeltme: Döngüde her N saniyede (ör. 30 sn) oturum durumunu ve `exp`'i yeniden doğrulamak, `exp` geçince 4401 ile kapatmak; rezervasyonun tüm bacakları terminal duruma geçince bağlantıyı kapatmak; mutlak bağlantı ömrü (ör. jeton `exp`'ine kadar) koymak.
- Olumlu (negatif bulgu):
  - Sahiplik kontrolü var: `_own_booking` `Booking.customer_id == customer.id` ile filtreler (`customer.py:48-54`); başka müşterinin jetonu 4401 alır (test `backend/tests/test_api_driver_admin.py:149-153`). Rezervasyon kodunu bilmek tek başına yetmez. verified
  - Kimlik doğrulama öncesi sunucu hiçbir veri göndermez (`accept` sonrası ilk `send_json` doğrulamadan sonra, `:281`). verified
  - Kimlik öncesi 10 sn zaman aşımı var (`:272`). verified
  - Yanlış jeton, bulunmayan rezervasyon ve başkasının rezervasyonu aynı kapanış koduyla (4401) sonuçlanır; rezervasyon kodu varlığı için kâhin yok. verified
  - Jeton URL'de taşınmıyor (log/Referer sızıntısı yok), istemci `mobile/app/booking/[code].tsx:179-180`. Üretimde `API_URL` https olduğundan `wss` (`mobile/lib/api.ts:116-117`). verified
  - Origin kontrolü yok ama kimlik bilgisi çerezle değil mesajla geldiği için Cross-Site WebSocket Hijacking uygulanamaz. verified (kod), belief (çerez tabanlı kimlik eklenmediği sürece)

## RT-04 WebSocket döngüsü async içinde senkron DB ve Redis çağrıları; Redis istemcisinde zaman aşımı yok

- OWASP: A04:2021 Insecure Design. CWE-400 (Uncontrolled Resource Consumption), CWE-1088 (Synchronous Access of Remote Resource without Timeout).
- Önem: Orta. Gerekçe: Tek bir uvicorn sürecinde tüm HTTP isteklerini etkileyen kullanılabilirlik riski. Kimliği doğrulanmış bir müşteri hesabı yeterli (OTP ile kolay edinilir). Etki büyüklüğü dağıtım yapılandırmasına (worker sayısı) bağlı, ölçülmedi.
- Konum:
  - `backend/app/api/customer.py:268` `async def`; içinde senkron `SessionLocal()` sorguları (`:273-276`, `:279-280`) ve senkron Redis `GET` (`live_location.for_booking`, `:281`). Bunlar olay döngüsü iş parçacığında çalışır ve tüm sunucuyu bloke eder. verified
  - `backend/app/services/live_location.py:24-26`: `redis.Redis.from_url(..., decode_responses=True)`; `socket_timeout`/`socket_connect_timeout` yok (karşılaştırma: `eta.py:44-45` 1 sn veriyor). Redis yanıt vermezse (ağ kara deliği) çağrı süresiz bekleyebilir ve olay döngüsü donar. verified
  - `live_location.for_booking` RedisError yakalamıyor; HTTP uçlarında (`customer.py:137`, `trips.py:300`, `admin/operations.py:53`) Redis hatası 500 olur. verified
- Kavramsal istismar: Saldırgan kendi rezervasyonu için yüzlerce WebSocket açar (RT-05: sınır yok); her biri 3 sn'de bir senkron DB + Redis çağrısı yapar, olay döngüsü sürekli bloke olur, diğer kullanıcıların istek gecikmesi artar. Redis gecikirse API tamamen yanıtsız kalır.
- Önerilen düzeltme: Döngüdeki DB/Redis çağrılarını `await asyncio.to_thread(...)` (veya `run_in_threadpool`) ile taşımak ya da `redis.asyncio` kullanmak; `live_location._redis` için `socket_connect_timeout`/`socket_timeout` ve `RedisError` yakalama; her tikte DB yerine önbelleğe alınmış `leg_id` listesiyle yalnızca Redis okumak.

## RT-05 WebSocket bağlantı sayısı, süre ve kimlik öncesi bağlantı için sınır yok

- OWASP: A04:2021. CWE-770 (Allocation of Resources Without Limits or Throttling).
- Önem: Düşük. Gerekçe: Kimlik öncesi bağlantı 10 sn ile sınırlı ve veri sızdırmıyor; asıl yük RT-04 ile birleşince anlam kazanır. Uç noktada ters vekil/Cloudflare sınırları olabilir (repoda yok, belief).
- Konum: `backend/app/api/customer.py:267-286`; kullanıcı/IP başına bağlantı sayacı, mutlak süre sınırı yok. `grep -rn -i -E "rate.?limit|max_connections|ws_max|--ws" backend/app .vscode/tasks.json` yalnızca Places ve sohbet sınırlarını buldu. Kimlik öncesi ilk mesaj boyutu yalnızca uvicorn varsayılanı (`ws_max_size`, varsayılan 16 MiB, belief) ile sınırlı ve `json.loads` ile tam olarak ayrıştırılıyor. verified (kod), belief (uvicorn varsayılanı)
- Kavramsal istismar: Kimliksiz istemci sürekli bağlantı açıp 10 sn bekleterek dosya tanıtıcısı ve bağlantı kapasitesini tüketir; ya da büyük ilk mesajlarla ayrıştırma maliyeti yaratır. Kimlikli istemci sınırsız kalıcı bağlantı açar.
- Önerilen düzeltme: Kimlik öncesi zaman aşımını 3-5 sn'ye indirmek, ilk mesaj için boyut sınırı (ör. 4 KiB, aşılırsa kapat), müşteri/oturum başına eşzamanlı bağlantı sınırı (Redis sayaç), IP başına bağlantı hız sınırı (uygulama veya ters vekil).
- Ek (Bilgi): `except Exception` dalında (`customer.py:285-286`) bağlantı zaten kopmuşsa `websocket.close` tekrar istisna fırlatabilir; işlenmemiş hata log gürültüsü yaratır. belief

## RT-06 Şifreli sohbet metni bildirim akışında ve push yükünde düz metin

- OWASP: A02:2021 Cryptographic Failures. CWE-312 (Cleartext Storage of Sensitive Information), CWE-359.
- Önem: Düşük. Gerekçe: Sohbet `trip_messages.body` olarak `EncryptedString` ile saklanıyor (recon §4); ancak ilk 120 karakteri her mesajda düz metin `trip_updates.body` (String(500)) satırına yazılıyor ve FCM'e gidiyor. Koruma tasarımı kısmen boşa çıkıyor; erişim için DB okuma yetkisi veya cihaz kilit ekranı gerekiyor. Saklama süresi mesajlarla aynı (30 gün), bu etkiyi sınırlıyor.
- Konum: `backend/app/services/messages.py:92-96` (önizleme), `backend/app/services/trip_updates.py:75-80,86,114-119,128-133` (`{text}` gövdeye ve push'a), `backend/app/services/push_outbox.py:44-51,78` (FCM'e başlık/gövde), `backend/app/providers/push.py:51` (konsol sağlayıcıda gövde loglanıyor, yalnızca dev). Silme: `backend/app/services/jobs.py:49-55` (30 gün). verified
- Kavramsal istismar: DB yedeğine veya okuma replikasına erişen biri, alan şifreleme anahtarı olmadan müşteri-sürücü yazışmalarını (telefon numarası, adres paylaşımı olabilir) okur. Kilitli telefonun ekranında mesaj içeriği görünür.
- Önerilen düzeltme: `trip_updates.body` için `new_message` kodunda metni saklamamak ("Yeni mesaj" gibi sabit metin) veya `EncryptedString` kullanmak; push gövdesinde içerik yerine genel metin (ya da istemci tarafında `data` ile çekilen içerik).

## RT-07 Devredilen bacakta yeni sürücü önceki sürücünün yazışmasını okuyabiliyor

- OWASP: A01:2021 Broken Access Control. CWE-200, CWE-639.
- Önem: Düşük. Gerekçe: Okuyan taraf yine bu yolculuğa atanmış meşru sürücü; sızan veri müşteri ile başka bir sürücü arasındaki yazışma. Devir senaryosu nadir.
- Konum: `backend/app/api/trips.py:153-157` (`_own_leg` yalnızca güncel `leg.driver_id`), `:229-232`; `backend/app/services/messages.py:53-56` geçmişi yalnızca `booking_leg_id` ile süzer, `TripMessage.driver_id` (gönderen sürücü, `messages.py:88-90`) kullanılmaz. Ayrıca müşteri mesajlarında `driver_id` hiç tutulmadığı için müşterinin hangi sürücüye yazdığı ayırt edilemez. verified (kod). İş kuralı açısından niyet edilip edilmediği: belief.
- Kavramsal istismar: Sürücü A ile müşteri arasında kişisel bilgi içeren yazışma olur, iş B'ye devredilir; B sohbeti açınca A'nın ve müşterinin önceki mesajlarını görür. Ayrıca B'nin `history` çağrısı A'ya yazılmış müşteri mesajlarını "okundu" işaretler.
- Önerilen düzeltme: Sürücü görünümünde mesajları devir anından sonrasıyla veya `driver_id == current` (sürücü mesajları) ve devir zamanından sonraki müşteri mesajlarıyla sınırlamak; müşteri mesajlarına da alıcı sürücü kimliği yazmak.
- Olumlu (negatif bulgu):
  - Sürücü uçları `_own_leg` ile bacak sahipliğini, müşteri uçları `_own_booking` ile rezervasyon sahipliğini kontrol ediyor (`trips.py:229-269`). Önceki sürücü devirden sonra erişemiyor. verified
  - Gönderim yalnızca açık durumlarda (`messages.py:20,39-40,77-78`), uzunluk 1000 ile sınırlı (`trips.py:205-206`, `messages.py:75`), hız sınırı 10 dk'da 40 (`messages.py:22-23,79-87`). verified
  - XSS: sohbet gövdesi web'de `TripTools.tsx:200`, admin'de `ChatReview.tsx:73` JSX metin düğümü olarak, mobilde `chat/[id].tsx:128` `<Text>` içinde gösteriliyor; React kaçışlıyor. `grep -rn -E 'dangerouslySetInnerHTML|innerHTML|v-html|eval\(|new Function' web admin mobile` yalnızca `mobile/components/GoogleMapWeb.tsx:92` buldu; oradaki HTML sabit şablon (renk değişkenleri, `:192-215`), kullanıcı verisi içermiyor. verified
  - Bildirim şablonları `str.format_map` ile `_Safe` sözlüğe uygulanıyor; kullanıcı metni şablon değil değer olarak girdiği için format string enjeksiyonu yok (`trip_updates.py:113-114,127-128`). verified
  - Admin sohbet okuması gerekçe ister ve denetim kaydına yazılır (`admin/trip_review.py:32-54`). verified

## RT-08 Push jetonu kaydında cihaz sahipliği doğrulanmıyor

- OWASP: A01:2021 / A04:2021. CWE-639, CWE-345.
- Önem: Düşük. Gerekçe: FCM kayıt jetonu tahmin edilemez ve cihazdan dışarı normalde çıkmaz; istismar için kurbanın jetonunu ele geçirmek gerekir. Etki: kurbanın bildirimlerinin kesilmesi ve kurbanın cihazına saldırganın hesabındaki bildirimlerin (uygulama markasıyla) gitmesi.
- Konum: `backend/app/api/trips.py:338-351`, `backend/app/services/notifications.py:113-122`. Herhangi bir müşteri/sürücü istediği jeton dizgesini (255 karaktere kadar, biçim kontrolü yok) kendi hesabına bağlar; aynı türdeki diğer hesaplarda aynı jeton varsa silinir. verified (kod), belief (jetonun ele geçirilebilirliği)
- Kavramsal istismar: Saldırgan kurbanın FCM jetonunu (ör. log, paylaşılan cihaz, kötü amaçlı uygulama) elde eder, kendi müşteri hesabına `POST /me/push-token` ile bağlar; kurbanın hesabı jetonsuz kalır (bildirim almaz), saldırgan kendi rezervasyonları üzerinden sohbet mesajı göndererek (`new_message`, `{text}` serbest metin) kurbanın cihazında "getawaytransfers" bildirimi gösterir (oltalama).
  - Not: Sürücü bir müşteriye sohbet üzerinden serbest metinli push gönderebiliyor; bu tasarım gereği, ancak hız sınırı (40/10 dk) dışında içerik denetimi yok.
- Önerilen düzeltme: Jeton biçimini doğrulamak (FCM jetonu deseni/uzunluğu); `bind_push_token` sırasında jetonun başka bir hesaba bağlı olması durumunda denetim kaydı; mümkünse jetonu oturuma (`sessions` satırına) bağlamak ve çıkışta/oturum iptalinde otomatik silmek (bugün `release_push_token` yalnızca açık çıkışta çalışıyor, `notifications.py:125-131`). Customer ve Driver tabloları arasında aynı jetonun aynı anda bulunabildiği de not edilmeli (`bind_push_token` yalnızca aynı modelde temizliyor).
- Olumlu: Bildirim akışı (`/updates`) yalnızca `recipient_id == customer.id/driver.id` ile süzülüyor, başka hesabın bildirimleri okunamıyor (`trips.py:315-335`). verified

## RT-09 Sürücü konumu tamamen istemci beyanı

- OWASP: A04:2021. CWE-602 (Client-Side Enforcement of Server-Side Security).
- Önem: Bilgi. Gerekçe: Mobil konum doğası gereği istemci beyanıdır; burada amaç kayıt düşmek. Bitirme yarıçapı (K-49) ve "yaklaşıyor" bildirimleri sahte koordinatla tetiklenebilir.
- Konum: `backend/app/api/driver.py:356-391`. Yazım yetkisi doğru: `leg.driver_id == driver.id` ve durum `TRACKABLE` (`:383-387`). Hız/sıçrama kontrolü (iki konum arası imkânsız hız) yok. verified
- Önerilen düzeltme: Ardışık konumlar arasında makul hız kontrolü, erken bitirmelerin işaretlenmesi (admin'de K-48 için benzer rapor var, `admin/trip_review.py:76`).
- Olumlu: Konum okuma yetkisi: müşteri yalnızca kendi rezervasyonu ve yalnızca `EN_ROUTE/ARRIVED/STARTED` durumunda (`live_location.py:21,42-49`, `customer.py:133-137`, `trips.py:293-300`); admin `OpsOrSupport` panosunda (`admin/operations.py:53`). Sürücü uçlarında başka bacağın konumunu okuyan uç bulunamadı (`grep -rn "live_location\." backend/app`). Bitişte ve müşteri bitirişinde konum siliniyor (`driver.py:368-369`, `trips.py:281`). verified. İptalde Redis anahtarı silinmiyor ama `TRACKABLE` dışı durumda okunmuyor ve 120 sn'de düşüyor. verified

## RT-10 Sohbet hız sınırı say-sonra-ekle

- OWASP: A04:2021. CWE-362.
- Önem: Bilgi. Gerekçe: Eşzamanlı isteklerle sınır az miktarda aşılabilir; etki bildirim spamıyla sınırlı.
- Konum: `backend/app/services/messages.py:79-91`; sayım ve ekleme arasında kilit yok. belief (yarış dinamik olarak denenmedi)
- Önerilen düzeltme: Redis `INCR` + `EXPIRE` tabanlı sayaç veya bacak satırında `FOR UPDATE`.

---

## Aranan ve bulunamayanlar (negatifler)

- Başka WebSocket/SSE ucu ve Redis pub/sub: `grep -rn -E 'publish|subscribe|pubsub|EventSourceResponse|StreamingResponse|\.websocket\(' backend/app` yalnızca `customer.py:267` eşleşti. Konum bir kanala yayınlanmıyor; `leg_loc:{id}` anahtarına yazılıp yoklanıyor (`grep -rn "live_location\.|_redis\(|redis.Redis|from_url" backend/app` çıktısında yalnızca GET/SET/DEL/SADD/SMEMBERS/INCR).
- Web BFF WebSocket iletmiyor; web müşterisi `driver-location` HTTP yoklaması (5 sn) kullanıyor (`web/components/BookingDetail.tsx:43,63`).

## Kapsam dışı bırakılanlar / atlananlar

- `docker-compose.yml` PostgreSQL 5432'nin de tüm arayüzlere açık olması (zayıf dev kimlik bilgisiyle) yalnızca not edildi; altyapı alanına ait.
- `mobile/lib/notify.ts` ve `mobile/components/UpdatesWatcher.tsx` içinde bildirim `data` alanından yönlendirme (deep link) işleme ayrıntılı okunmadı.
- FCM sağlayıcısı (`providers/push.py`) OAuth/servis hesabı işleme yalnızca log satırı için okundu.
- Dinamik test yok: RT-04 etki büyüklüğü, RT-05 uvicorn varsayılanları, RT-01 LAN erişilebilirliği ölçülmedi.
