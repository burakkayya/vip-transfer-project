# STRIDE tehdit modeli

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Girdi: `docs/security/recon.md` (mimari, giriş noktaları, veri haritası). Recon'daki iddialar yeniden türetilmedi; kritik olanlar aşağıda "doğrulandı" notuyla dosya:satır üzerinden yeniden okundu.
- Kapsam: tasarım düzeyi tehdit modeli. Kod değiştirilmedi, dinamik test yapılmadı.
- Etiketler: **doğrulandı** = kod satırı bu çalışmada okundu; **doğrulanmadı** = çıkarım, denetim ajanı tarafından teyit edilmeli.
- Secret değerleri yazılmaz; yalnızca değişken adları.

---

## 1. Varlıklar

| ID | Varlık | Nerede | Koruma (mevcut) | Etki sınıfı |
|---|---|---|---|---|
| A1 | Müşteri PII (ad, telefon, e-posta, yolcu adı, not) | `users`, `customers`, `bookings` | Fernet `EncryptedString`, telefon/e-posta blind index (recon §4) | KVKK ihlali, itibar |
| A2 | Adres ve kesin koordinat (alış/bırakış) | `booking_legs` adres şifreli, lat/lng düz `Numeric` | kısmi (koordinat düz metin) | Fiziksel güvenlik, ev adresi ifşası |
| A3 | Canlı sürücü konumu | Redis `leg_loc:{leg_id}`, TTL 120 sn | Redis parolasız, hosta açık (`docker-compose.yml:18-21`) | Gerçek zamanlı takip, sürücü/yolcu güvenliği |
| A4 | Ödeme ve tahsilat durumu | `payments`, `payment_webhooks`, PayTR | kart verisi tutulmaz (iFrame), webhook HMAC | Doğrudan para kaybı |
| A5 | Hakediş / defter / ödeme çıkışı (payout) | `driver_ledger`, `driver_payouts`, `refunds`, CSV export | FinanceStaff rolü, denetim kaydı | Doğrudan para kaybı, iç dolandırıcılık |
| A6 | Sürücü IBAN ve kimlik belgeleri (ehliyet, ruhsat, sigorta) | `drivers.iban` şifreli, belgeler diskte Fernet | içerik türü listesi + magic byte (`services/documents.py:24,45-49`), kök dışı yol reddi | Kimlik hırsızlığı, ödeme yönlendirme |
| A7 | Jetonlar: access JWT, refresh, MFA ara jetonu, TOTP sırrı | `jwt_secret`, `sessions.refresh_token_hash`, `users.two_factor_secret` | HS256 + `typ`, refresh SHA-256 özet ve döndürme, TOTP şifreli | Hesap ele geçirme, personel yetkisi |
| A8 | Ana anahtarlar: `GETAWAY_JWT_SECRET`, `GETAWAY_FIELD_ENCRYPTION_KEYS`, `GETAWAY_BLIND_INDEX_KEY`, PayTR key/salt, Google/AeroDataBox/Netgsm anahtarları, FCM servis hesabı | ortam / `.env` | prod'da dev sabiti reddi (`config.py:114-139`) | Tüm varlıkların toplu ifşası; JWT sahteciliği; webhook sahteciliği |
| A9 | Müşteri-sürücü yazışmaları | `trip_messages.body` şifreli | sahiplik kontrolü (`trips.py:153-157`, `customer.py:48-54`) | Gizlilik |
| A10 | Denetim kaydı | `audit_logs` | UPDATE/DELETE tetikleyiciyle engelli | İnkâr edilemezlik |
| A11 | Fiyatlandırma, komisyon, kur, ayarlar | `pricing_rules`, `commission_rules`, `exchange_rates`, `settings` | AdminOnly / FinanceStaff | Gelir kaybı |
| A12 | Dış servis kotası ve faturası (Google Places/Routes, AeroDataBox, Netgsm SMS) | backend çıkışları | Places için IP başına sınır (`public.py:109,125,132`), OTP telefon başına saatlik sınır | Mali kayıp (fatura şişirme), SMS pompalama |

---

## 2. Aktörler

| ID | Aktör | Erişim | Motivasyon / not |
|---|---|---|---|
| T1 | Anonim ziyaretçi | public uçlar, OTP isteği, webhook, WS el sıkışma, `/health` | SMS pompalama, kota tüketimi, hesap numaralandırma |
| T2 | Müşteri (meşru) | `/api/v1/me/*`, WS, web BFF | — |
| T3 | Kötü niyetli müşteri | kendi jetonu | IDOR ile başkasının rezervasyonu/konumu, fiyat manipülasyonu, iade suistimali, sohbet üzerinden taciz |
| T4 | Sürücü (onaylı / onaysız / askıya alınmış) | `/api/v1/driver/*`, mobil doğrudan | — |
| T5 | Kötü niyetli sürücü | kendi jetonu, cihaz üzerinde tam kontrol | Konum sahteciliği ile erken bitirme ve hakediş, belge sahteciliği, başka işleri kapma, yolcu PII toplama |
| T6 | Personel rolleri: ADMIN, OPERATIONS, ACCOUNTING, SUPPORT | admin BFF → `/api/v1/admin/*` | Rol ayrımı `require_staff` (`deps.py:95-118`); ADMIN her şeye geçer |
| T7 | Kötü niyetli içeriden kişi (personel) | geçerli personel oturumu | Sahte payout / mark-paid, manuel ödeme işaretleme, iade, belge indirip sızdırma, PII toplu dışa aktarma |
| T8 | Geliştirici / CI / altyapı erişimi olan kişi | repo, CI, host, DB/Redis portları | Dev sabit anahtarlarıyla paylaşılan ortam, parolasız Redis |
| T9 | Dış servisler: PayTR, Google (Places/Routes/FCM/OAuth), Netgsm, AeroDataBox (RapidAPI), TCMB | backend'in çıkış yaptığı uçlar; PayTR ayrıca backend'e callback yapar | Yanlış/kötü veri, ele geçirilmiş servis, MITM; TCMB kuru imzasız XML |
| T10 | Ağ saldırganı | mobil cleartext (dev), hosta açık portlar | MITM, port tarama |

---

## 3. Güven sınırları

| ID | Sınır | Açıklama | Kanıt |
|---|---|---|---|
| TB1 | Tarayıcı → web BFF (Next.js, 3000) | httpOnly çerez `path=/bff`, `sameSite=lax`, izin listesi | `web/app/bff/[...path]/route.ts:14-35` |
| TB2 | Tarayıcı → admin BFF (Next.js, 3001) | httpOnly çerez `sameSite=strict`, Origin kontrolü (`x-forwarded-host` öncelikli), izin listesi | doğrulandı: `admin/app/bff/[...path]/route.ts:13,19-48,92-94` |
| TB3 | BFF → backend API (8000) | BFF Bearer ekler, `cf-connecting-ip` iletir | doğrulandı: `admin/.../route.ts:50-65` |
| TB4 | Mobil uygulama → backend API (doğrudan) | Bearer; native SecureStore; Android dev'de cleartext | `mobile/app.config.ts:46-50`, `mobile/lib/storage.ts` |
| TB5 | İnternet → backend doğrudan (BFF atlanarak) | Backend 0.0.0.0'da dinliyor; mobil zaten doğrudan geliyor, dolayısıyla tüm `/api/v1` uçları internetten erişilebilir kabul edilmeli | `.vscode/tasks.json:42-43`, `mobile/eas.json` |
| TB6 | PayTR → backend callback | Kimliksiz; yalnızca HMAC | doğrulandı: `providers/payments.py:140-154` |
| TB7 | Backend → dış servisler | httpx çıkışları; Netgsm kimlik bilgisi query string'de | recon §1 tablo, `providers/sms.py:41-53` |
| TB8 | Backend/worker → PostgreSQL ve Redis | Compose; Redis parolasız, ikisi de hosta açık | `docker-compose.yml:3-21` |
| TB9 | Backend → yerel disk (`var/storage`) | Fernet şifreli belge dosyaları | `providers/storage.py:29-46` |
| TB10 | CI (GitHub Actions) → repo, secret'lar, artefaktlar | action'lar SHA ile sabitlenmemiş, Google anahtarları secret | recon §7 |
| TB11 | Admin tarayıcısı → belge indirme içeriği | Sürücünün yüklediği dosya admin kökeninde `inline` açılıyor | `admin/api/fleet.py:196-206`, admin BFF `PASS_HEADERS` (`route.ts:14`) |

---

## 4. STRIDE tablosu

Sütunlar: Tehdit ID, sınır/varlık, kategori, senaryo, giriş noktası, mevcut önlem, değerlendirme (açık / kısmi / yeterli görünüyor).

### 4.1 Kimlik ve oturum (TB1-TB4, A7)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| S-01 | TB5 / A7 | S | `GETAWAY_JWT_SECRET` dev sabitiyle çalışan paylaşılan bir ortamda (staging, demo, CI'dan çıkan imaj) herkes repo'daki sabitle STAFF/ADMIN jetonu üretir. `sid` kontrolü var, ancak saldırgan bir oturum id'si bilmeli; refresh/oturum tablosuna erişimi olmayan biri için zor. FakeProvider da aynı sırrı imza anahtarı olarak kullanıyor. | `security/tokens.py:31-41`, `config.py:14`, `providers/payments.py:223-224` | prod'da validator (`config.py:114-139`) | kısmi: yalnızca `env=="prod"` korunuyor; `env` yanlış ayarlanırsa koruma devre dışı |
| S-02 | TB5 / A7 | S | Refresh jetonu çalınırsa (XSS yok sayılsa da cihaz/log sızıntısı) saldırgan döndürmeyi önce yapar; meşru kullanıcının eski jetonu sadece 401 alır, yeniden kullanım tespiti ve oturum ailesinin iptali yok. | doğrulandı: `services/auth.py:60-77` | döndürme, SHA-256 özet | açık |
| S-03 | TB2 / A7 | S, E | Personel refresh jetonu backend'de 30 gün geçerli; admin BFF'nin 12 saatlik sınırı yalnızca çerez `maxAge`. Çalınan personel refresh jetonu doğrudan backend `/auth/refresh` ile 30 gün kullanılır. | `admin/.../route.ts:10-11,31`, `config.py:37`, `auth.py:118` | yok (backend tarafında tür bazlı ömür yok, doğrulanmadı) | açık |
| S-04 | TB5 / A7 | S | Personel girişi ve 2FA uçlarında hesap kilitleme/deneme sayacı yok; 6 haneli TOTP `valid_window=1` ile 5 dk'lık `mfa` jetonu süresince çevrimiçi kaba kuvvet. TOTP tekrar kullanımı engellenmiyor. | `auth.py:147,162`, `services/auth.py:244-288` | Argon2, denetim kaydı `staff.2fa_failed` | açık (doğrulanmadı: üst katmanda proxy rate limit olabilir) |
| S-05 | TB5 / A7 | S | İlk girişte 2FA kurulmamış personel için parola tek başına `mfa_setup` jetonu ve `provisioning_uri` verir; parolayı ele geçiren saldırgan 2FA'yı kendi cihazına bağlar. | `services/auth.py:252-262` | yok | açık (tasarım riski, admin CLI ile oluşturulan hesaplar) |
| S-06 | TB5 / A1, A12 | S, D | OTP isteğinde IP sınırı yok; telefon başına 5/saat. Saldırgan farklı numaralara (premium/uluslararası) SMS pompalar; Netgsm faturası şişer. Ayrıca OTP doğrulamasında başarıda hesap otomatik oluşturulur. | `auth.py:80,94`, `services/otp.py:38-79` | telefon başına saatlik sınır, deneme sınırı 5 | açık |
| S-07 | TB5 / A12 | S, D | `client_ip` koşulsuz `cf-connecting-ip` başlığına güveniyor. Backend doğrudan erişilebilir olduğundan (mobil yolu) saldırgan her istekte farklı IP yazarak Places IP sınırını aşar, denetim/KVKK onay kayıtlarındaki IP'yi sahteler, PayTR'a giden `user_ip`'yi (dolandırıcılık skoru) manipüle eder. | doğrulandı: `api/deps.py:29-31`; kullanım `public.py:109,125,132`, `customer.py:124-126,203-206` | yok (güvenilir proxy listesi yok) | açık |
| S-08 | TB2 / A7 | S, T | Admin BFF CSRF kontrolü `x-forwarded-host` başlığını `host`'a tercih ediyor. Saldırgan bu başlığı tarayıcıdan ayarlayamaz (CORS dışı özel başlık), ancak BFF önünde başlığı temizlemeyen bir proxy/ön uç varsa kontrol baypas edilebilir. `sameSite=strict` ikinci katman. | doğrulandı: `admin/.../route.ts:39-48` | Origin kontrolü + SameSite=strict | yeterli görünüyor (dağıtım topolojisine bağlı, doğrulanmadı) |
| S-09 | TB1 / A7 | T | Web BFF `sameSite=lax`; GET dışı isteklerde Origin kontrolü web BFF'de var mı recon'da belirtilmedi. Lax, üst düzey POST navigasyonunu engeller; ancak `me/*` altında GET ile durum değiştiren uç yok görünüyor. | `web/app/bff/[...path]/route.ts:28-35` | SameSite=lax | doğrulanmadı |
| S-10 | TB1, TB2 / BFF izin listesi | E | BFF yol birleştirme `params.path.join("/")` ve regex `^admin\/.+$` / `^me\/.+$`. `..` segmentli (yüzde kodlanmış) bir yol regex'i geçip `fetch` URL normalizasyonuyla başka önek altına çözülebilir (ör. `me/%2e%2e/driver/...`). Jetonun türü değişmediği için doğrudan yetki yükselmesi beklenmez; ancak izin listesinin bir güvenlik sınırı olarak sayılmaması gerekir. | `admin/.../route.ts:13,59,88-89`, `web/app/bff/[...path]/route.ts:14-23` | backend tarafında rol kontrolü | doğrulanmadı |
| S-11 | TB4 / A7 | I | Mobil web önizlemede jeton `localStorage`'da; dev derlemesi yanlışlıkla dağıtılırsa XSS ile jeton çalınır. Android cleartext bayrağı üretim derlemesine sızarsa MITM. | `mobile/lib/storage.web.ts`, `mobile/app.config.ts:46-50` | "yalnızca geliştirme" yorumu, eas profili | kısmi |
| S-12 | A10 | R | Erişim jetonu 30 dk geçerli; oturum iptali her istekte `sid` ile kontrol edildiğinden HTTP için iyi. WebSocket ise yalnızca bağlantı başında doğrular (bkz. I-03). | `api/deps.py:48-61` | oturum kontrolü | yeterli görünüyor (HTTP) |

### 4.2 Müşteri alanı ve IDOR (TB4/TB5, A1-A3, A9)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| I-01 | A1, A2 | I | Başka müşterinin rezervasyon koduyla `/me/bookings/{code}*` erişimi. | doğrulandı: `customer.py:48-54` (`customer_id` filtresi) | sahiplik filtresi tüm `/me/bookings/{code}` uçlarında `_own_booking` ile | yeterli görünüyor |
| I-02 | A3 | I | Canlı konum: müşteri yalnızca kendi rezervasyonunun aktif bacağını görür. | `customer.py:133-137`, `live_location.py:42-49` | `_own_booking` | yeterli görünüyor |
| I-03 | A3 / WS | I, R | WebSocket kimlik doğrulaması yalnızca ilk mesajda; döngü içinde oturum iptali, hesap pasifleşmesi, rezervasyon iptali veya erişim jetonu süresi yeniden kontrol edilmiyor. Çıkış yapılmış/askıya alınmış bir müşteri veya çalınan bir jetonla açılmış bağlantı, bağlantı açık kaldıkça sonraki yolculuklarda da sürücünün canlı konumunu almaya devam eder. | doğrulandı: `customer.py:267-286` | 10 sn ilk mesaj zaman aşımı | açık |
| D-01 | WS | D | `websocket.accept()` kimlikten önce; her bağlantı 10 sn bekletilebilir, doğrulanmış bağlantı her 3 sn'de yeni DB oturumu ve Redis okuması yapar; bağlantı sayısı sınırı yok. | doğrulandı: `customer.py:270-282` | yok | açık |
| T-01 | A11 / A4 | T | Müşteri fiyatı manipüle eder: istemci `expected_total` gönderir ama fiyat sunucuda `build_quote` ile yeniden hesaplanır. Rota/mesafe girdileri (koordinat, `place_id`) istemciden geliyorsa mesafe tabanlı fiyat düşürülebilir. | doğrulandı: `customer.py:57-84`; doğrulanmadı: `services/quotes.py` mesafe kaynağı | sunucu tarafı fiyat | kısmi (doğrulanmadı) |
| T-02 | A4, A5 | T | Müşteri `POST /me/bookings/{code}/finish` ile yolculuğu her an "tamamlandı" yapar (K-48); sürücü hakedişi ve iade yokluğu iş kuralı. Kötüye kullanım: yolculuk başladıktan hemen sonra bitirip ardından ödeme itirazı (chargeback). | doğrulandı: `trips.py:275-282`, `dispatch.py:344-360` | denetim kaydı | iş kuralı riski |
| T-03 | A4 | T | İptal/iade akışında zaman penceresi ve iade yüzdesi `refund_quote` ile; yarış koşulu (iptal ile callback eşzamanlı) callback tarafında `PENDING_PAYMENT` kontrolü ve kilitle ele alınmış. | `customer.py:107-119`, doğrulandı: `services/payments.py:113-149` | `FOR UPDATE`, geç ödemede tam iade | yeterli görünüyor (iptal tarafı doğrulanmadı) |
| I-04 | A9 | I, T | Sohbet: müşteri sürücünün adının ilk kelimesini, sürücü yolcu adının ilk kelimesini görür; mesaj gövdesi uzunluk sınırı ve hız sınırı (spam/taciz) recon'da yok. | `trips.py:229-269` | sahiplik kontrolü | kısmi (hız sınırı doğrulanmadı) |
| I-05 | A1 | I | Hesap/telefon numaralandırma: OTP uçları kayıtlı/kayıtsız numaraya farklı yanıt veriyor mu bilinmiyor; doğrulamada hesap otomatik oluştuğu için muhtemelen ayrım yok. | `auth.py:80-113` | — | doğrulanmadı |
| R-01 | A1 | R | KVKK onay kaydındaki IP sahtelenebilir (S-07), bu da onay kaydının ispat değerini düşürür. | `customer.py:202-208` | IP kaydı | açık (S-07'ye bağlı) |

### 4.3 Sürücü alanı (TB4, A2, A3, A5, A6)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| T-04 | A5 / A3 | T, S | Konum sahteciliği: sürücü `FINISHED` olayını istemciden gelen `lat/lng` ile gönderir; varış yarıçapı kontrolü (K-49) tamamen istemci koordinatına dayanır. Sürücü yolculuğu yapmadan/yarıda bırakıp "bitir" der, hakediş defterine yazılır. Aynı şekilde `/location` ile sahte konum müşteriye gösterilir ve ETA bildirimleri tetiklenir. | doğrulandı: `driver.py:356-372,381-391`, `dispatch.py:319-328` | yarıçap kontrolü (istemci verisiyle) | açık (tasarım sınırı; sunucu tarafı makullük kontrolü yok) |
| E-01 | A2 | E, I | Sürücü yalnızca kendisine atanmış bacağı görür; teklif aşamasında yolcu adı ve adres maskelenir. | doğrulandı: `driver.py:296-313,341-346`, `trips.py:153-157` | sahiplik + maskeleme | yeterli görünüyor |
| E-02 | A5 | E | Onaysız/askıya alınmış sürücünün iş alması: `eligible_candidates` `Driver.status == APPROVED` filtreliyor; ancak askıya alınan sürücünün zaten atanmış bacakları için `/trips/{leg_id}/events` ve `/location` onay durumuna bakmıyor, bitirme ve hakediş üretme sürebilir. | doğrulandı: `dispatch.py:117,242-247,442-444`; `driver.py:356-391` | atamada onay kontrolü | kısmi |
| T-05 | A6 | T, E | Belge yükleme: içerik türü istemciden gelir ama izin listesi (pdf/jpeg/png) ve magic byte kontrolü var; boyut 10 MB. PDF içinde aktif içerik, admin `inline` görüntülemede admin kökeninde açılır (TB11). PDF JavaScript tarayıcı PDF görüntüleyicisinde sandbox'lı, risk düşük. | doğrulandı: `services/documents.py:24-49`, `driver.py:113-139`; `admin/fleet.py:196-206` | izin listesi, magic byte, Fernet, `no-store` | kısmi (yanıtta `X-Content-Type-Options: nosniff` ve `Content-Security-Policy: sandbox` olup olmadığı doğrulanmadı) |
| T-06 | A6 | R, T | Sahte/başkasına ait belge yükleme ile onay alma; insan incelemesine dayanır (`documents/{id}/review`). | `admin/fleet.py:215` | OpsStaff incelemesi, denetim kaydı | iş süreci riski |
| T-07 | A6 / A5 | T | Sürücü `register` sırasında IBAN belirler; IBAN değişikliği akışı ve bunun payout'lara etkisi (değişikliğin onay gerektirip gerektirmediği) incelenmedi. Ele geçirilmiş sürücü hesabında IBAN değişimi para yönlendirir. | `driver.py:70-86` | denetim kaydı | doğrulanmadı |
| D-02 | A12 | D | `/driver/jobs?lat&lng` ve rota önizlemesi Google Routes çağırabilir (`preview_polyline`); sürücü başına hız sınırı yok. | `trips.py:105-122` | doğrulanmadı (önbellek olabilir) | doğrulanmadı |
| T-08 | Push | T, I | `push-token` bağlama: aynı FCM jetonu başka hesaba bağlanabiliyorsa bildirimler (yolcu adı, varış) yanlış cihaza gider. `bind_push_token` önceki sahibi temizliyor mu bilinmiyor. | `trips.py:342-351`, `driver.py:99-107` | uzunluk sınırı | doğrulanmadı |

### 4.4 Ödeme ve webhook (TB6, A4)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| S-13 | TB6 / A4 | S | Sahte PayTR callback ile ödeme onayı. İmza `HMAC(merchant_key, oid+salt+status+total)` ve sabit zamanlı karşılaştırma. | doğrulandı: `payments.py:20-29`, `providers/payments.py:140-154` | HMAC, idempotens (`PENDING` dışı tekrar işlenmez) | yeterli görünüyor |
| T-09 | A4 | T | `total_amount` rakam değilse `None` olur ve eksik tahsilat kontrolü atlanır (`result.total_amount is not None and ...`). İmza `total` alanını kapsadığı için saldırganın bunu üretmesi PayTR anahtarı olmadan mümkün değil; ancak savunma derinliği açısından `None` kabul edilmemeli. Para birimi eşleşmesi callback'te karşılaştırılmıyor. | doğrulandı: `services/payments.py:129`, `providers/payments.py:150` | imza | kısmi (düşük) |
| D-03 | TB6 | D | Geçersiz imzalı her callback `payment_webhooks` tablosuna commit edilir; kimliksiz uç ile tablo şişirme. | doğrulandı: `services/payments.py:100-111` | yok | açık (düşük-orta) |
| S-14 | A4 | S, E | Sahte ödeme sayfası ve onayı kimliksiz; `env != "prod"` ve FakeProvider ile açık. Prod dışı ama internete açık bir ortamda herkes herhangi bir `oid` için ödemeyi "tamamlandı" yapar. İmza anahtarı `jwt_secret` (dev'de sabit). | `payments.py:57-96`, `providers/payments.py:185-224` | env ve sağlayıcı koşulu | kısmi (ortam yapılandırmasına bağlı) |
| I-06 | A4 | I | Webhook payload'ı maskeli saklanıyor; `merchant_oid` ve tutarlar loglanıyor (PII değil). | `providers/payments.py:76-80` | maskeleme | yeterli görünüyor |
| R-02 | A4 | R | Ödeme onayında `actor_id=None` denetim kaydı ve webhook tablosu; inkâr edilemezlik sağlanıyor. | `services/payments.py:137` | audit + webhook kaydı | yeterli görünüyor |

### 4.5 Admin / personel (TB2, A5, A6, A10, A11)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| E-03 | A5 | E | SUPPORT rolü OpsOrSupport uçlarında müşteri oluşturma, müşteri arama, mesaj gönderme ve KVKK taleplerini işleme yetkisine sahip; `customers/lookup` telefonla PII sorgulama aracı olarak kötüye kullanılabilir. | `manual_bookings.py:88,106`, `people.py:40,60,77` | rol kontrolü, denetim kaydı (her uçta mı doğrulanmadı) | kısmi |
| T-10 | A5 | T, R | İçeriden kişi: FinanceStaff payout oluşturur, CSV'yi dışa aktarır ve `mark-paid` yapar; aynı kişi hem hazırlayıp hem onaylayabiliyor (görevler ayrılığı yok). OpsStaff `manual-payment` ile ödemeyi alınmış işaretler; FinanceStaff `refunds/{id}/complete-manual`. | `finance.py:111,159,180`, `manual_bookings.py:337,368`, `operations.py:206,220` | rol ayrımı, denetim kaydı | açık (iş süreci; dört göz kontrolü yok, doğrulanmadı) |
| T-11 | A5 | T | CSV dışa aktarımda sürücü adı/IBAN gibi alanlar `=`, `+`, `-`, `@` ile başlıyorsa formül enjeksiyonu (sürücü kendi adını belirliyor). | `finance.py:159`, `driver.py:80-81` | doğrulanmadı | doğrulanmadı |
| T-12 | A11 | T | AdminOnly `PUT /settings/{key}` ile serbest anahtar/değer; hangi anahtarların güvenlik etkili olduğu (ör. iade oranı, varış yarıçapı) incelenmedi. | `catalog.py:345` | AdminOnly | doğrulanmadı |
| T-13 | A11 | T | Kur verisi TCMB'den imzasız XML olarak çekiliyor; XML ayrıştırıcının XXE/billion-laughs korumalı olup olmadığı ve FinanceStaff'ın manuel kur girişi (`POST /exchange-rates`) sınırları incelenmedi. | `providers/fx.py:16`, `catalog.py:287` | doğrulanmadı | doğrulanmadı |
| I-07 | A6 | I | OpsStaff tüm belgeleri indirip sızdırabilir; her görüntüleme denetimde, ancak toplu indirme için hız sınırı/uyarı yok. | `admin/fleet.py:196-206` | denetim kaydı, `no-store` | kısmi |
| E-04 | A7 | E | `PATCH /admin/users/{id}` ile rol ataması; ADMIN'in kendi hesabını veya son ADMIN'i değiştirmesi/kilitlemesi, rol değişince mevcut oturumların iptal edilip edilmediği. Erişim jetonu rol taşımıyor, rol her istekte DB'den okunuyor (`principal.user.role_codes`), bu iyi. | `people.py:156`, doğrulandı: `deps.py:100-105` | rol DB'den | kısmi (oturum iptali doğrulanmadı) |
| R-03 | A10 | R | Denetim kaydı DB'de değiştirilemez; ancak IP sahtelenebilir (S-07) ve bazı yazma uçlarında `audit.record` çağrısı olmayabilir (ör. `vehicle.create` IP'siz, `trip_event` için yalnızca `TripEvent`). | `driver.py:213`, `ops.py:44-56` | tetikleyici | kısmi |
| I-08 | A10 | I | `GET /admin/audit-logs` AnyStaff'a açık; `changes` JSON alanında PII bulunuyorsa SUPPORT dahil tüm personel görür. | `people.py:182` | rol | doğrulanmadı |

### 4.6 Dış servisler (TB7, A8, A12)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| I-09 | A8 | I | Netgsm kullanıcı kodu ve parola GET query string'inde; ara proxy, httpx hata mesajları veya istisna izleri URL'yi loglarsa kimlik bilgisi sızar. | `providers/sms.py:41-53`, `services/notifications.py:99` (`log.exception`) | yok | açık |
| I-10 | A1 | I | Konsol SMS sağlayıcısı telefon ve OTP kodunu WARNING ile logluyor; dev/CI loglarında (artefakt) OTP ve telefon. `dev_code` prod dışı API yanıtında. | `providers/sms.py:30`, `services/otp.py:78` | yalnız console sağlayıcı / prod dışı | kısmi |
| D-04 | A12 | D | Kimliksiz `quotes` ve `routes/preview` uçları Google Routes çağırabilir; IP sınırı yalnızca Places uçlarında görünüyor ve IP sahtelenebilir (S-07). Fatura şişirme. | `public.py:97,103` | Places'te IP sınırı | açık (Routes önbelleği doğrulanmadı) |
| T-14 | A2 | T | AeroDataBox yanıtına göre tahmini iniş ve sürücü bildirimleri; uçuş no kullanıcı girdisi, URL yoluna ekleniyor (`flights/number/`); kaçışlama yoksa yol enjeksiyonu. | `providers/flights.py:91` | doğrulanmadı | doğrulanmadı |
| S-15 | A8 | S | Tarayıcı/mobil Google anahtarları istemciye gömülü; uygulama/referer kısıtlaması Google Console'da yapılmamışsa kötüye kullanım. Repo'dan doğrulanamaz. | `web/.env.example:6`, `mobile/app.config.ts:16,22` | — | doğrulanmadı |
| I-11 | A8 | I | FCM servis hesabı dosya yolu ile yükleniyor; dosya izinleri ve depolama yeri repo dışı. | `config.py:57`, `providers/push.py:61` | `.gitignore` | doğrulanmadı |

### 4.7 Veri katmanı ve altyapı (TB8, TB9, TB10, A3, A8)

| ID | Sınır / varlık | STRIDE | Senaryo | Giriş noktası | Mevcut önlem | Durum |
|---|---|---|---|---|---|---|
| I-12 | TB8 / A3 | I, T | Redis parolasız ve 6379 hosta açık; ağdaki biri `leg_loc:*` anahtarlarından tüm aktif sürücülerin canlı konumunu okur veya sahte konum yazar; ARQ kuyruğuna iş enjekte eder (worker kod yürütmez ama iş argümanları manipüle edilir). | `docker-compose.yml:18-21`, `services/live_location.py:20-35` | yok | açık (üretim topolojisi doğrulanmadı) |
| I-13 | TB8 / A1 | I | PostgreSQL 5432 hosta açık ve dev parolası düz metin; koordinatlar (`pickup_lat/lng`) şifresiz, hassas alanlar Fernet ile şifreli. | `docker-compose.yml:3-12`, `models/booking.py:126-129` | alan şifreleme | kısmi |
| I-14 | A8 | I | Dev sabit Fernet ve blind index anahtarları repo'da; paylaşılan bir ortamda bu anahtarlarla oluşturulmuş bir DB yedeği sızarsa tüm PII çözülür. | `config.py:15-16` | prod validator | kısmi |
| E-05 | TB10 | E | Üçüncü taraf action'lar (ör. `reactivecircus/android-emulator-runner@v2`) etiketle; etiket yeniden yazılırsa CI'daki Google anahtarı secret'ları sızar. `permissions: contents: read` etkiyi sınırlıyor. | `.github/workflows/*.yml` | asgari izin | kısmi |
| I-15 | TB10 | I | CI artefaktları (Maestro/emülatör çıktıları) konsol SMS logları içeriyorsa OTP/telefon (test verisi) sızar. | `android-emulator.yml:158`, `ios-simulator.yml:227` | test verisi | doğrulanmadı |
| D-05 | TB5 | D | Uygulama düzeyinde genel hız sınırı yok (yalnızca OTP ve Places); dağıtımda Cloudflare varsayımı repo'da yapılandırılmamış. | `api/deps.py:30` yorumu | — | doğrulanmadı |
| I-16 | TB5 | I | `/docs` ve `/openapi.json` `env != "prod"` iken açık; `env` yanlış ise tüm şema ifşa olur. | `main.py:24-26` | env koşulu | kısmi |

---

## 5. Önceliklendirilmiş saldırı yüzeyleri (denetim ajanları için ilk 10)

Sıralama: istismar kolaylığı x etki (para, konum, hesap ele geçirme). Her maddede ilgili tehdit ID'leri.

1. **`client_ip` ve `cf-connecting-ip` güveni** (`backend/app/api/deps.py:29-31`) - S-07, D-04, R-01, R-03. Tüm IP tabanlı sınırların ve denetim IP'lerinin temeli; backend doğrudan erişilebilir olduğu için tek başlıkla atlanıyor. Güvenilir proxy listesi gereksinimini doğrula.
2. **Personel giriş ve 2FA akışı** (`backend/app/api/auth.py:147,162`, `backend/app/services/auth.py:244-288`) - S-04, S-05, S-03. Kaba kuvvet sınırı, TOTP tekrar kullanımı, ilk 2FA kurulumunun yalnızca parolayla yapılması, personel refresh ömrünün backend'de 30 gün olması.
3. **Sürücü yolculuk olayları ve konum yazımı** (`backend/app/api/driver.py:356-391`, `backend/app/services/dispatch.py:301-341`) - T-04, E-02. İstemci koordinatıyla bitirme ve hakediş; askıya alınmış sürücünün mevcut işleri sürdürmesi.
4. **Finans ve manuel ödeme uçları** (`backend/app/api/admin/finance.py:111-200`, `manual_bookings.py:337,368`, `operations.py:206,220`) - T-10, T-11. Görevler ayrılığı, payout tutarının nereden hesaplandığı, `mark-paid` idempotensi, CSV formül enjeksiyonu, IBAN değişimi (T-07).
5. **OTP isteği ve doğrulama** (`backend/app/api/auth.py:80-113`, `backend/app/services/otp.py:38-110`) - S-06, I-05. IP/küresel sınır yokluğu, SMS pompalama, otomatik hesap oluşturma, numaralandırma.
6. **Canlı konum WebSocket'i** (`backend/app/api/customer.py:267-286`) - I-03, D-01. Bağlantı süresince yeniden yetkilendirme yok; kimlik öncesi `accept`; bağlantı sınırı yok.
7. **Refresh jetonu döndürme** (`backend/app/services/auth.py:60-77`) - S-02, S-03. Yeniden kullanım tespiti, oturum ailesi iptali, kullanıcı türüne göre ömür.
8. **PayTR callback ve sahte ödeme uçları** (`backend/app/api/payments.py:20-96`, `backend/app/services/payments.py:95-149`) - T-09, D-03, S-14. `total_amount=None` yolu, para birimi eşleşmesi, kimliksiz tablo yazımı, prod dışı ortamlarda fake ödeme ve `jwt_secret` paylaşımı.
9. **BFF vekilleri** (`admin/app/bff/[...path]/route.ts`, `web/app/bff/[...path]/route.ts`) - S-08, S-09, S-10, T-05. Yol normalizasyonu ile izin listesi baypası, `x-forwarded-host` güveni, web BFF CSRF, belge indirmede iletilen `content-type`/`content-disposition` ve eksik `nosniff`/`sandbox`.
10. **Redis/DB ve ortam yapılandırması** (`docker-compose.yml`, `backend/app/config.py:14-16,114-139`) - I-12, I-13, I-14, S-01, I-16. Parolasız Redis, hosta açık portlar, dev sabit anahtarlar ve tüm korumaların yalnızca `env=="prod"` koşuluna bağlı olması.

Sonraki adımda bakılması önerilen ek yerler (ilk 10 dışında): `services/quotes.py` mesafe girdisi (T-01), `providers/flights.py` URL oluşturma (T-14), `providers/fx.py` XML ayrıştırma (T-13), `services/notifications.py` push jetonu bağlama (T-08), `admin/people.py` rol değişikliği ve oturum iptali (E-04), audit log içeriğinde PII (I-08).

---

## 6. Bu modelde yapılmayanlar

- `services/quotes.py`, `services/bookings.py` (iptal/iade hesabı), `admin/finance.py` gövdeleri, `providers/fx.py`, `providers/flights.py`, `services/notifications.py` okunmadı; ilgili satırlar "doğrulanmadı".
- Web BFF'nin Origin kontrolü ve yol birleştirme davranışı satır satır okunmadı (yalnızca recon özeti).
- İstemci kodu (web/admin sayfaları, mobil ekranlar) ve XSS yüzeyi incelenmedi.
- Üretim dağıtım topolojisi (reverse proxy, TLS, Cloudflare, ağ ayrımı) repoda yok; altyapı tehditleri varsayıma dayanıyor.
- Bağımlılık açık taraması ve dinamik test yapılmadı.
