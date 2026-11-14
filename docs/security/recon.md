# Güvenlik denetimi öncesi keşif (recon)

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban commit `0f13f2b`
- Kapsam: yalnızca envanter ve harita. Yorum, öneri ve düzeltme bu belgede yer almaz.
- Etiketler: `verified: <komut veya dosya:satır>` doğrudan okundu veya komutla görüldü; `belief: bağımsız doğrula` çıkarımdır.
- Secret değerleri bu belgede yazılmaz; yalnızca değişken adı ve konum verilir.

---

## 1. Mimari özeti

| Parça | Teknoloji | Yerel port | Kanıt |
|---|---|---|---|
| backend API | FastAPI + uvicorn, önek `/api/v1` | 8000 (`--host 0.0.0.0` VS Code görevinde) | verified: `backend/app/main.py:64-70`, `.vscode/tasks.json:42-43`, `README.md:7` |
| backend worker | ARQ, cron işleri (dakikalık, saatlik, günlük 00:10 UTC) | port yok, Redis'e bağlanır | verified: `backend/app/worker.py:44-50` |
| PostgreSQL + PostGIS | `postgis/postgis:16-3.4` | 5432 hosta açık | verified: `docker-compose.yml:3-12` |
| Redis | `redis:7-alpine`, parola tanımı yok | 6379 hosta açık | verified: `docker-compose.yml:18-21` |
| web (müşteri) | Next.js 15.5.28, next-intl; `/bff/*` backend vekili | 3000 | verified: `web/package.json` (`dev`/`start` -p 3000), `web/app/bff/[...path]/route.ts` |
| admin | Next.js 15.5.28; `/bff/*` backend vekili | 3001 | verified: `admin/package.json` (`dev` -p 3001), `admin/app/bff/[...path]/route.ts` |
| mobile | Expo SDK 58, React Native 0.88.1; müşteri ve sürücü varyantı (`APP_VARIANT`) | Metro 8081/8082 (web önizleme), 8083/8084 (Android) | verified: `mobile/app.config.ts:5`, `backend/app/config.py:27-33`, `.vscode/tasks.json:145,162` |

Ağ sınırları ve veri akışı:

- docker-compose yalnızca `db` ve `redis` servislerini tanımlar; backend, worker, web ve admin compose içinde değil, hostta çalışır. Ayrı ağ tanımı yok (varsayılan compose ağı). verified: `docker-compose.yml:1-24`
- Tarayıcı (web/admin) backend'e doğrudan değil, Next.js `/bff/[...path]` route handler üzerinden gider; route handler `GETAWAY_API_URL` (varsayılan `http://localhost:8000`) adresine `fetch` yapar. verified: `admin/app/bff/[...path]/route.ts:7,50-65`, `web/app/bff/[...path]/route.ts:9,67`
- Web BFF izin listesi: `regions`, `vehicle-types`, `quotes`, `routes/preview`, `places/.+`, `auth/otp/(request|verify)`, `auth/(logout|me)`, `me/.+`. verified: `web/app/bff/[...path]/route.ts:14-23`
- Admin BFF izin listesi: `auth/staff/(login|2fa|password)`, `auth/(logout|me)`, `admin/.+`. verified: `admin/app/bff/[...path]/route.ts:13`
- Web BFF `driver/*`, `payments/*` ve `ws/*` yollarını izin listesinde içermiyor (regex okundu). verified: `web/app/bff/[...path]/route.ts:14-23`
- BFF'ler istemci IP'sini `cf-connecting-ip` (yoksa `x-forwarded-for` ilk değer) olarak backend'e iletir; backend `client_ip` önce `cf-connecting-ip` başlığını okur. verified: `admin/app/bff/[...path]/route.ts:56-57`, `backend/app/api/deps.py:29-31`
- Mobil uygulama backend'e doğrudan bağlanır (`GETAWAY_API_URL`), üretim profili `https://api.getawaytransfers.com`. verified: `mobile/app.config.ts:9`, `mobile/eas.json:15,27`
- Android'de `GETAWAY_ANDROID_CLEARTEXT=1` ise `usesCleartextTraffic=true` eklenir (Android emulator CI'da açık). verified: `mobile/app.config.ts:46-50`, `.github/workflows/android-emulator.yml:106`
- CORS: `allow_origins` = `cors_origins` (varsayılan localhost 3000/3001/8081/8082), `allow_credentials=False`. verified: `backend/app/main.py:28-34`, `backend/app/config.py:28-33`
- OpenAPI/Swagger `/docs` ve `/openapi.json` yalnızca `env != "prod"` iken açık. verified: `backend/app/main.py:24-26`
- Güvenlik başlıkları: backend `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` (CSP frame-ancestors yoksa); web ve admin `next.config.ts` içinde CSP dahil başlık listesi. verified: `backend/app/main.py:51-58`, `web/next.config.ts:9-42`, `admin/next.config.ts:3-32`
- Üretim dağıtım topolojisi (reverse proxy, Cloudflare, TLS sonlandırma) için repoda yapılandırma bulunamadı; Cloudflare varsayımı yalnızca koddaki yorumda. belief: bağımsız doğrula (kaynak: `backend/app/api/deps.py:30` yorumu)

Dış servisler (backend çıkışları):

| Servis | Adres | Dosya |
|---|---|---|
| Google Places (New) | `https://places.googleapis.com/v1` | `backend/app/providers/places.py:58` |
| Google Routes | `https://routes.googleapis.com/directions/v2` | `backend/app/providers/routing.py:64` |
| PayTR | `https://www.paytr.com` | `backend/app/providers/payments.py:95` |
| AeroDataBox (RapidAPI) | `https://aerodatabox.p.rapidapi.com/flights/number/` | `backend/app/providers/flights.py:91` |
| TCMB kur | `https://www.tcmb.gov.tr/kurlar/today.xml` | `backend/app/providers/fx.py:16` |
| FCM HTTP v1 + OAuth | `https://fcm.googleapis.com/v1/projects/`, `https://oauth2.googleapis.com/token` | `backend/app/providers/push.py:32-33,69` |
| Netgsm SMS | `https://api.netgsm.com.tr/sms/send/get` (GET, kimlik bilgileri query parametresinde) | `backend/app/providers/sms.py:41-53` |

verified: `grep -rn -o -E 'https?://...' backend/app/providers`

---

## 2. Giriş noktaları envanteri

Sayım komutları (kesme yok):

```
grep -c -E '^\s*@[a-z_]*router\.(get|post|put|patch|delete|websocket)\(' backend/app/api/*.py backend/app/api/admin/*.py backend/app/main.py
grep -n -E '^\s*@[a-zA-Z_]*\.(get|post|put|patch|delete|websocket|api_route)\(' backend/app/api/*.py backend/app/api/admin/*.py backend/app/main.py
```

Ek olarak her endpoint fonksiyonunun kimlik bağımlılığı Python `ast` ile çıkarıldı (scratchpad betiği, repo dışında); çıktı 136 satır, decorator sayımıyla eşleşiyor.

### 2.1 Router özeti

| Router dosyası | Önek (tam) | Endpoint | Kimliksiz | Kanıt |
|---|---|---|---|---|
| `backend/app/api/auth.py` | `/api/v1/auth` | 8 | 5 | verified: `auth.py:16`, satırlar 80-183 |
| `backend/app/api/customer.py` (`router`) | `/api/v1/me` | 13 | 0 | verified: `customer.py:42`, satırlar 57-246 |
| `backend/app/api/customer.py` (`ws_router`) | `/api/v1` | 1 (WebSocket) | bağımlılık yok, kimlik ilk mesajda | verified: `customer.py:264,267` |
| `backend/app/api/driver.py` | `/api/v1/driver` | 16 | 0 | verified: `driver.py:43`, satırlar 70-429 |
| `backend/app/api/payments.py` | `/api/v1/payments` | 3 | 3 | verified: `payments.py:17`, satırlar 20,69,81 |
| `backend/app/api/public.py` | `/api/v1` | 6 | 6 | verified: `public.py:31`, satırlar 34-129 |
| `backend/app/api/trips.py` (`driver_router`) | `/api/v1/driver` | 10 | 0 | verified: `trips.py:27` |
| `backend/app/api/trips.py` (`customer_router`) | `/api/v1/me` | 7 | 0 | verified: `trips.py:28` |
| `backend/app/api/admin/*` (7 modül) | `/api/v1/admin` | 72 | 0 | verified: `admin/__init__.py:5-7` |
| `backend/app/main.py` | `/health` (önek yok) | 1 | 1 | verified: `main.py:60` |
| **Toplam** | | **137** (136 HTTP + 1 WebSocket) | **15 HTTP + 1 WS** | |

Admin alt kırılımı: operations 11, manual_bookings 10, trip_review 2, fleet 12, catalog 20, finance 9, people 8. verified: grep -c çıktısı.

Rol bağımlılığı dağılımı (AST çıktısı): admin uçlarında OpsStaff 27, AdminOnly 15, OpsOrSupport 14, FinanceStaff 13, OpsOrFinance 2, AnyStaff 1 (toplam 72). Müşteri/sürücü tarafında CurrentDriver 25, CurrentCustomer 20, CurrentPrincipal 3, `current_driver_user` 1. verified: AST betiği çıktısı

### 2.2 Kimlik doğrulaması gerektirmeyen uçlar (bağımlılık imzasında auth yok)

| Metod ve yol | Dosya:satır |
|---|---|
| POST `/api/v1/auth/otp/request` | `backend/app/api/auth.py:80` |
| POST `/api/v1/auth/otp/verify` | `backend/app/api/auth.py:94` |
| POST `/api/v1/auth/refresh` | `backend/app/api/auth.py:118` |
| POST `/api/v1/auth/staff/login` | `backend/app/api/auth.py:147` |
| POST `/api/v1/auth/staff/2fa` | `backend/app/api/auth.py:162` |
| POST `/api/v1/payments/paytr/callback` (webhook) | `backend/app/api/payments.py:20` |
| GET `/api/v1/payments/fake/{oid}` (sahte ödeme sayfası, HTML) | `backend/app/api/payments.py:69` |
| POST `/api/v1/payments/fake/{oid}/complete` (sahte ödeme onayı, HTML) | `backend/app/api/payments.py:81` |
| GET `/api/v1/regions` | `backend/app/api/public.py:34` |
| GET `/api/v1/vehicle-types` | `backend/app/api/public.py:41` |
| POST `/api/v1/quotes` | `backend/app/api/public.py:97` |
| POST `/api/v1/routes/preview` | `backend/app/api/public.py:103` |
| GET `/api/v1/places/autocomplete` (ücretli Google çağrısı, IP başına dakikalık sınır ayarı var) | `backend/app/api/public.py:118`, `backend/app/config.py:67` |
| GET `/api/v1/places/{place_id}` | `backend/app/api/public.py:129` |
| GET `/health` | `backend/app/main.py:60` |
| WS `/api/v1/ws/bookings/{code}/location` (kimlik ilk mesajda) | `backend/app/api/customer.py:267` |

verified: AST betiği çıktısı (`NO-AUTH-DEP`), dosyalar okundu.

### 2.3 Tam endpoint listesi

auth (`/api/v1/auth`):
`auth.py:80` POST /otp/request · `:94` POST /otp/verify · `:118` POST /refresh · `:130` POST /logout · `:138` GET /me · `:147` POST /staff/login · `:162` POST /staff/2fa · `:183` POST /staff/password

customer (`/api/v1/me`):
`customer.py:57` POST /bookings · `:87` GET /bookings · `:95` GET /bookings/{code} · `:100` GET /bookings/{code}/cancellation · `:107` POST /bookings/{code}/cancel · `:123` POST /bookings/{code}/payments · `:133` GET /bookings/{code}/driver-location · `:170` GET /profile · `:175` PATCH /profile · `:202` POST /consents · `:211` GET /consents · `:234` POST /data-requests · `:246` GET /data-requests · `:267` WS /ws/bookings/{code}/location (önek `/api/v1`)

driver (`/api/v1/driver`):
`driver.py:70` POST /register · `:89` GET /me · `:99` POST /me/online · `:113` POST /documents (dosya yükleme) · `:142` GET /documents · `:200` POST /vehicles · `:218` GET /vehicles · `:296` GET /offers · `:316` POST /offers/{offer_id}/accept · `:327` POST /offers/{offer_id}/reject · `:333` GET /trips · `:341` GET /trips/{leg_id} · `:356` POST /trips/{leg_id}/events · `:381` POST /trips/{leg_id}/location (konum yazımı) · `:403` GET /earnings · `:429` GET /document-alerts

trips, sürücü (`/api/v1/driver`):
`trips.py:105` GET /jobs · `:115` GET /jobs/{leg_id} · `:125` POST /jobs/{leg_id}/accept · `:132` POST /jobs/{leg_id}/decline · `:160` GET /trips/{leg_id}/approach · `:229` GET /trips/{leg_id}/messages · `:235` GET /trips/{leg_id}/messages/unread · `:240` POST /trips/{leg_id}/messages · `:328` GET /updates · `:348` POST /me/push-token

trips, müşteri (`/api/v1/me`):
`trips.py:248` GET /bookings/{code}/messages · `:254` GET /bookings/{code}/messages/unread · `:264` POST /bookings/{code}/messages · `:275` POST /bookings/{code}/finish · `:293` GET /bookings/{code}/eta · `:333` GET /updates · `:342` POST /push-token

payments (`/api/v1/payments`):
`payments.py:20` POST /paytr/callback · `:69` GET /fake/{oid} · `:81` POST /fake/{oid}/complete

public (`/api/v1`):
`public.py:34` GET /regions · `:41` GET /vehicle-types · `:97` POST /quotes · `:103` POST /routes/preview · `:118` GET /places/autocomplete · `:129` GET /places/{place_id}

admin (`/api/v1/admin`), yanında rol bağımlılığı:

- operations: `operations.py:29` GET /dashboard (OpsOrSupport) · `:86` GET /bookings (OpsOrSupport) · `:132` GET /bookings/{booking_id} (OpsOrSupport) · `:190` POST /bookings/{booking_id}/cancel (OpsStaff) · `:206` POST /bookings/{booking_id}/refund (OpsOrFinance) · `:220` POST /ledger/{entry_id}/cancel (OpsOrFinance) · `:234` GET /dispatch/pending (OpsStaff) · `:252` GET /dispatch/legs/{leg_id}/candidates (OpsStaff) · `:267` POST /dispatch/legs/{leg_id}/assign (OpsStaff) · `:274` POST /dispatch/legs/{leg_id}/offer (OpsStaff) · `:282` GET /drivers/online (OpsStaff)
- manual_bookings: `manual_bookings.py:88` POST /customers (OpsOrSupport) · `:106` GET /customers/lookup (OpsOrSupport) · `:123` GET /booking-catalog (OpsOrSupport) · `:139` GET /places/autocomplete (OpsOrSupport) · `:146` GET /places/{place_id} (OpsOrSupport) · `:171` POST /quotes (OpsOrSupport) · `:288` POST /bookings (OpsStaff) · `:337` POST /bookings/{booking_id}/manual-payment (OpsStaff) · `:351` POST /bookings/{booking_id}/resend-sms (OpsStaff) · `:368` POST /refunds/{refund_id}/complete-manual (FinanceStaff)
- trip_review: `trip_review.py:37` POST /bookings/{booking_id}/messages (OpsOrSupport) · `:76` GET /trips/customer-finished (OpsOrSupport)
- fleet: `fleet.py:42` GET /drivers (OpsStaff) · `:59` GET /drivers/{driver_id} (OpsStaff) · `:78` POST /drivers/{driver_id}/status (OpsStaff) · `:94` GET /vehicles (OpsStaff) · `:107` POST /vehicles/{vehicle_id}/status (OpsStaff) · `:135` GET /vehicle-types (OpsStaff) · `:140` POST /vehicle-types (AdminOnly) · `:151` PUT /vehicle-types/{vt_id} (AdminOnly) · `:169` GET /documents (OpsStaff) · `:178` GET /documents/expiring (OpsStaff) · `:196` GET /documents/{doc_id}/file (OpsStaff, dosya indirme) · `:215` POST /documents/{doc_id}/review (OpsStaff)
- catalog: `catalog.py:61` GET /regions (OpsStaff) · `:66` POST /regions (OpsStaff) · `:77` PUT /regions/{region_id} (OpsStaff) · `:106` GET /pricing-rules (OpsStaff) · `:112` POST /pricing-rules (AdminOnly) · `:137` POST /pricing-rules/{rule_id}/deactivate (AdminOnly) · `:159` GET /round-trip-discounts (OpsStaff) · `:165` POST /round-trip-discounts (AdminOnly) · `:176` POST /round-trip-discounts/{discount_id}/deactivate (AdminOnly) · `:210` GET /cancellation-policies (OpsStaff) · `:215` POST /cancellation-policies (AdminOnly) · `:246` GET /commission-rules (FinanceStaff) · `:252` POST /commission-rules (AdminOnly) · `:268` POST /commission-rules/{rule_id}/deactivate (AdminOnly) · `:281` GET /exchange-rates (FinanceStaff) · `:287` POST /exchange-rates (FinanceStaff) · `:310` GET /notification-templates (OpsStaff) · `:316` PUT /notification-templates (OpsStaff) · `:336` GET /settings (AdminOnly) · `:345` PUT /settings/{key} (AdminOnly)
- finance: `finance.py:36` GET /payments · `:52` GET /refunds · `:68` POST /refunds/{refund_id}/retry · `:86` GET /ledger · `:111` POST /payouts · `:148` GET /payouts · `:159` GET /payouts/export.csv · `:180` POST /payouts/{payout_id}/mark-paid · `:202` GET /invoices (hepsi FinanceStaff)
- people: `people.py:40` GET /customers (OpsOrSupport) · `:60` GET /data-requests (OpsOrSupport) · `:77` POST /data-requests/{request_id} (OpsOrSupport) · `:94` POST /customers/{customer_id}/anonymize (AdminOnly) · `:134` GET /users (AdminOnly) · `:139` POST /users (AdminOnly) · `:156` PATCH /users/{user_id} (AdminOnly) · `:182` GET /audit-logs (AnyStaff)

verified: `grep -n` çıktısı ve AST betiği çıktısı.

### 2.4 WebSocket

- Tek WebSocket: `/api/v1/ws/bookings/{code}/location`. `websocket.accept()` kimlik doğrulamadan önce çağrılır; ilk mesaj `{"token": "<access_token>"}` 10 sn içinde beklenir, sonra `current_principal` + `current_customer` + `_own_booking` çağrılır; ardından 3 sn arayla Redis'ten konum gönderilir. Hata halinde kapanış kodu 4401. verified: `backend/app/api/customer.py:267-286`
- Web BFF WebSocket iletmez (izin listesinde `ws/` yok; route handler GET/POST/PATCH/DELETE dışa aktarır). verified: `web/app/bff/[...path]/route.ts:14-23,146-149`. WS istemcisinin hangi uygulamada olduğu (mobil doğrudan bağlanıyor mu) bu taramada okunmadı. belief: bağımsız doğrula

### 2.5 Webhook ve ödeme uçları

- PayTR bildirim: POST `/api/v1/payments/paytr/callback`, form gövdesi, sağlayıcı PayTR değilse 404. İmza `base64(HMAC-SHA256(merchant_key, oid + salt + status + total))`, `hmac.compare_digest` ile karşılaştırılır. Her bildirim `payment_webhooks` tablosuna maskelenmiş payload ile yazılır; geçersiz imzada commit + DomainError. Yanıt düz metin `OK`. verified: `backend/app/api/payments.py:20-29`, `backend/app/providers/payments.py:70-72,76,144-145`, `backend/app/services/payments.py:95-135`
- Sahte ödeme sayfası ve onayı: `env == "prod"` veya sağlayıcı FakeProvider değilse 404. FakeProvider imza anahtarı olarak `jwt_secret` kullanır ve `public_api_url` sabit `http://localhost:8000`. Sonuç sayfası `frame-ancestors {public_web_url}` CSP başlığı ile döner. verified: `backend/app/api/payments.py:57-96`, `backend/app/providers/payments.py:185-188,223-224`
- Callback'te loglanan alanlar: geçersiz imzada `merchant_oid`, eksik tahsilatta `merchant_oid` ve tutarlar. verified: `backend/app/services/payments.py:110,132`

### 2.6 Dosya yükleme / statik / indirme

- Yükleme: POST `/api/v1/driver/documents` (multipart; `doc_type`, `file`, `valid_until`, `vehicle_id`), `documents.MAX_DOCUMENT_BYTES + 1` bayta kadar okunur, `content_type` istemciden gelir. verified: `backend/app/api/driver.py:113-139`
- Depolama: yerel disk `storage_dir` (varsayılan `var/storage`), dosya Fernet ile şifreli yazılır; `_path` `resolve()` sonrası kök dışı yolları reddeder. Belge `storage_key` veritabanında `EncryptedString`. verified: `backend/app/providers/storage.py:29-46`, `backend/app/config.py:98`, `backend/app/models/fleet.py:97`
- İndirme: GET `/api/v1/admin/documents/{doc_id}/file` (OpsStaff), `media_type=doc.content_type`, `Content-Disposition: inline`, `Cache-Control: no-store`, her görüntüleme denetim kaydına yazılır. verified: `backend/app/api/admin/fleet.py:196-206`
- CSV dışa aktarım: GET `/api/v1/admin/payouts/export.csv` (FinanceStaff). verified: `backend/app/api/admin/finance.py:159`
- Statik dosya mount: aramam `StaticFiles` veya `app.mount(` desenini bulamadı (komut: `grep -n -E 'APIRouter\(|include_router|mount\(|add_middleware|CORSMiddleware|StaticFiles' -r backend/app`).
- Kullanılan MIME türü ve izin verilen içerik türleri listesi `backend/app/services/documents.py` içinde; bu taramada okunmadı. belief: bağımsız doğrula

### 2.7 Frontend sunucu tarafı giriş noktaları

- `web/app/bff/[...path]/route.ts` (GET, POST, PATCH, DELETE), `admin/app/bff/[...path]/route.ts` (GET, POST, PUT, PATCH, DELETE). verified: `route.ts:146-149` (web), `route.ts:125-129` (admin)
- `web/middleware.ts` yalnızca next-intl yönlendirmesi; matcher `bff`, `_next`, `_vercel` ve uzantılı yolları hariç tutar. verified: `web/middleware.ts:4-8`
- `web/lib/server.ts` sunucu bileşenleri için backend'den JSON okur. verified: `web/lib/server.ts:3-5`
- Aramam başka `route.ts`, `"use server"` veya server action desenini bulamadı (komut: `git ls-files web admin | grep -E '(route\.(ts|js)|middleware\.(ts|js)|proxy\.(ts|js)|next\.config|actions?\.ts|server\.ts)$'` ve `grep -rn '"use server"' web admin`).

### 2.8 Diğer giriş noktaları

- CLI: `backend/app/cli.py` (seed, seed-demo, admin oluşturma; parola `getpass` ile alınır). verified: `backend/app/cli.py:33-47`
- ARQ worker cron işleri (dakikalık/saatlik/günlük). verified: `backend/app/worker.py:44-50`

---

## 3. Kimlik doğrulama mekanizmaları

### 3.1 Jetonlar

- Erişim jetonu: JWT HS256, `jwt_secret` ile imzalı; claim'ler `sub`, `sid`, `kind`, `typ="access"`, `iat`, `exp` (varsayılan 30 dk). verified: `backend/app/security/tokens.py:20,31-41`, `backend/app/config.py:35-36`
- MFA ara jetonu: aynı anahtar, `typ` = `mfa` veya `mfa_setup`, varsayılan 5 dk. verified: `backend/app/security/tokens.py:44-53`, `backend/app/config.py:38`
- Doğrulama: `jwt.decode(..., algorithms=["HS256"])` + `typ` kontrolü. verified: `backend/app/security/tokens.py:56-63`
- Yenileme jetonu: `secrets.token_urlsafe(48)`, veritabanında SHA-256 özeti (`sessions.refresh_token_hash`), her kullanımda döndürülür (modül docstring). verified: `backend/app/security/tokens.py:1-6,66-71`, `backend/app/models/identity.py:68`. Döndürme ve yeniden kullanım tespiti mantığı `backend/app/services/auth.py:60-78` içinde; ayrıntı okunmadı. belief: bağımsız doğrula
- Oturum kontrolü: her istekte `sid` ile `get_active_session` çağrılır, `session.user_id == sub` karşılaştırılır. verified: `backend/app/api/deps.py:48-61`, `backend/app/services/auth.py:92`
- Ayar varsayılan ömürleri: refresh 30 gün (`jwt_refresh_days`); admin BFF yenileme çerezini 12 saat tutar, web BFF `REFRESH_DAYS` sabitiyle. verified: `backend/app/config.py:37`, `admin/app/bff/[...path]/route.ts:10-11`, `web/app/bff/[...path]/route.ts:40`

### 3.2 Jetonun istemcide saklanması

- web: `httpOnly`, `secure` yalnızca `NODE_ENV=production`, `sameSite=lax`, `path=/bff`. verified: `web/app/bff/[...path]/route.ts:28-35`
- admin: `httpOnly`, `secure` yalnızca `NODE_ENV=production`, `sameSite=strict`, `path=/bff`; GET dışı isteklerde Origin host karşılaştırması (Origin yoksa ret); host olarak `x-forwarded-host` öncelikli. verified: `admin/app/bff/[...path]/route.ts:19-27,39-48,92-94`
- mobile: native'de `expo-secure-store`; web önizlemesinde `localStorage` (dosya yorumunda "yalnızca geliştirme"). verified: `mobile/lib/storage.ts:2-7`, `mobile/lib/storage.web.ts:1-7`

### 3.3 Roller

- Kullanıcı türü `UserKind`: CUSTOMER, DRIVER, STAFF. Personel rolleri `RoleCode`: ADMIN, OPERATIONS, ACCOUNTING, SUPPORT. verified: `backend/app/api/deps.py:67-118` (kullanımlar); enum tanımları `backend/app/models/enums.py` (satır numaraları okunmadı)
- `require_staff(*allowed)`: kind STAFF ve rol kesişimi; ADMIN her zaman geçer. Takma adlar: AnyStaff, OpsStaff, OpsOrSupport, FinanceStaff, OpsOrFinance, AdminOnly. verified: `backend/app/api/deps.py:95-118`
- `current_customer`: kind CUSTOMER ve silinmemiş müşteri kaydı. `current_driver`: kind DRIVER ve `drivers` kaydı (yoksa `driver_profile_missing`). verified: `backend/app/api/deps.py:67-92`
- Sürücü onay durumunun (approved/active) uç bazında kontrol edildiği yer bu taramada okunmadı. belief: bağımsız doğrula

### 3.4 OTP akışı (müşteri ve sürücü)

- İstek: telefon `blind_index` ile özetlenir; son 1 saatte aynı telefon için `otp_max_per_hour` (varsayılan 5) aşılırsa 429. Kod `secrets.randbelow`, uzunluk 6, TTL 300 sn. Kod HMAC-SHA256(`blind_index_key`, `challenge_id:code`) olarak saklanır. verified: `backend/app/services/otp.py:38-79`, `backend/app/config.py:44-47`
- `dev_code`: `env != "prod"` ve `sms_provider == "console"` iken API yanıtında döner. verified: `backend/app/services/otp.py:78`, `backend/app/api/auth.py:28-29,91`
- Doğrulama: son, tüketilmemiş, süresi dolmamış challenge `FOR UPDATE` ile alınır; `attempts >= otp_max_attempts` (5) ise ret; deneme sayısı artırılır, `hmac.compare_digest`. Hata durumunda deneme sayısı commit edilir. verified: `backend/app/services/otp.py:82-110`, `backend/app/api/auth.py:101-105`
- OTP isteğinde IP başına sınır: aramam `otp/request` yolunda IP tabanlı sayım desenini bulamadı (komut: `grep -n -E '^def |^async def |pyotp|totp|mfa|lock|attempt|rate' backend/app/services/auth.py backend/app/services/otp.py`; `ip` yalnızca kayda yazılıyor, `otp.py:64-72`).
- Başarılı doğrulamada müşteri veya sürücü kullanıcısı yoksa oluşturulur (`get_or_create_customer`, `get_or_create_driver_user`). verified: `backend/app/api/auth.py:106-113`

### 3.5 Personel girişi ve 2FA (admin)

- Parola: Argon2 (`argon2-cffi`, varsayılan parametreler), en az 12 karakter; kullanıcı yoksa da özet hesaplanır. verified: `backend/app/security/passwords.py:1-23`
- `staff_login`: e-posta blind index ile aranır, başarısız girişte `staff.login_failed` denetim kaydı. 2FA açıksa `mfa` jetonu; değilse TOTP sırrı üretilir (`pyotp.random_base32`) ve `mfa_setup` jetonu + `provisioning_uri` döner. verified: `backend/app/services/auth.py:244-262`
- `staff_verify_2fa`: önce `mfa`, sonra `mfa_setup` jetonu denenir; `pyotp.TOTP(...).verify(code, valid_window=1)`; başarısızlıkta `staff.2fa_failed` denetim kaydı; ilk başarıda `two_factor_enabled=True`. verified: `backend/app/services/auth.py:265-288`
- TOTP sırrı `users.two_factor_secret` (EncryptedString). verified: `backend/app/models/identity.py:38`
- Personel giriş/2FA uçlarında hesap kilitleme veya deneme sayacı: aramam `lock|attempt|rate` desenini `services/auth.py` içinde bulamadı (komut yukarıdaki grep). TOTP kodunun tekrar kullanımını engelleyen kayıt alanı: aramam `last_totp|used_code` desenini modellerde bulamadı (komut: `grep -n ... backend/app/models/*.py` alan listesi). belief: bağımsız doğrula
- Parola değişikliği: POST `/auth/staff/password` yalnızca STAFF, değişince diğer oturumlar kapatılır. verified: `backend/app/api/auth.py:183-190`
- İlk admin CLI ile oluşturulur. verified: `backend/app/cli.py:40-47`

---

## 4. Hassas veri haritası

Kaynak: `grep -n -E '__tablename__|EncryptedString|_hash|phone|email|...' backend/app/models/*.py` ve ilgili model satırlarının okunması.

| Tablo | Alan | Tür / koruma | Veri sınıfı | Kanıt |
|---|---|---|---|---|
| users | email, phone | EncryptedString (Fernet) | PII | `identity.py:33,35` |
| users | email_hash, phone_hash | HMAC blind index | PII türevi | `identity.py:34,36` |
| users | password_hash | Argon2 | kimlik bilgisi | `identity.py:37` |
| users | two_factor_secret | EncryptedString | kimlik bilgisi | `identity.py:38` |
| sessions | refresh_token_hash, device_info, ip | SHA-256 / düz metin / düz metin | oturum, IP, UA | `identity.py:68-70` |
| otp_challenges | phone_hash, code_hash, ip | HMAC / HMAC / düz metin | PII türevi, IP | `identity.py:84-90` |
| customers | full_name, email | EncryptedString | PII | `customer.py:31-32` |
| customers | push_token | String(255) düz metin | cihaz tanımlayıcı | `customer.py:39` |
| consents | ip | düz metin | IP (KVKK onay kaydı) | `customer.py:56` |
| data_requests | note | String(1000) düz metin | serbest metin | `customer.py:70` |
| bookings | passenger_name, note | EncryptedString | PII | `booking.py:50-51` |
| booking_legs | pickup_address, dropoff_address | EncryptedString | adres | `booking.py:124-125` |
| booking_legs | pickup_lat/lng, dropoff_lat/lng | Numeric(9,6) düz | kesin konum | `booking.py:126-129` |
| flight_infos | flight_no (+ takip durumu) | String(10) düz | seyahat bilgisi | `booking.py:152-175` |
| trip_messages | body | EncryptedString | müşteri-sürücü yazışması | `booking.py:224` |
| trip_updates | body | String(500) düz | bildirim metni | `booking.py:245` |
| drivers | full_name, iban | EncryptedString | PII, banka bilgisi | `fleet.py:34,36` |
| drivers | push_token | String(255) düz | cihaz tanımlayıcı | `fleet.py:41` |
| vehicles | plate | String(20) düz, unique | araç kimliği | `fleet.py:63` |
| documents | storage_key | EncryptedString; dosya diskte Fernet şifreli | sürücü/araç belgeleri (ehliyet vb.) | `fleet.py:97`, `providers/storage.py:39` |
| document_reviews | note | String(1000) düz | serbest metin | `fleet.py:115` |
| payments | merchant_oid, provider_ref, amount, currency, checkout_url, failure_reason, note | düz | ödeme verisi (kart verisi alanı yok) | `finance.py:26-47` |
| payment_webhooks | raw_payload (JSON, "maskelenmiş") | `hash, email, user_phone, user_name, user_address` maskelenir | ödeme bildirimi | `finance.py:60-70`, `providers/payments.py:76` |
| refunds, driver_ledger, driver_payouts, invoices | tutarlar, durum | düz | finansal | `finance.py:73-127` |
| audit_logs | actor_id, action, entity, changes (JSON), ip | düz; UPDATE/DELETE tetikleyiciyle engelli | denetim, IP | `ops.py:44-56`, `alembic/versions/20261029_0002_audit_logs_immutable.py` |
| regions | latitude/longitude, Geography POINT | PostGIS | kamuya açık bölge merkezi | `pricing.py:27-33` |

- Kart numarası/CVV alanı: aramam `card` desenini modellerde bulamadı (komut yukarıdaki model grep'i). PayTR iFrame kullanılıyor. verified: `backend/app/providers/payments.py:95-109`
- Canlı sürücü konumu veritabanında değil Redis'te: anahtar `leg_loc:{leg_id}`, TTL 120 sn, JSON. Redis parolasız (compose). verified: `backend/app/services/live_location.py:20-35`, `docker-compose.yml:18-21`
- Alan şifrelemesi: MultiFernet, `field_encryption_keys` virgülle ayrılmış (rotasyon); blind index HMAC-SHA256 `blind_index_key`. verified: `backend/app/security/crypto.py:25-49,80-94`
- Dokümanda kişisel veri: `docs/test_senaryolari.md:74` bir admin hesabı için kişisel e-posta adresi içeriyor (maskelendi: `e***@gmail.com`). verified: `grep -n -i -A12 'Test hesapları' docs/test_senaryolari.md`

### 4.1 Loglama noktaları

Komut: `grep -rn -E 'log\.(debug|info|warning|error|exception)|logger\.|print\(' backend/app`

| Dosya:satır | İçerik |
|---|---|
| `backend/app/providers/sms.py:30` | konsol SMS: telefon numarası ve SMS metni (OTP kodu dahil) WARNING seviyesinde |
| `backend/app/providers/sms.py:58` | Netgsm yanıtının ilk 20 karakteri |
| `backend/app/providers/push.py:51` | konsol push: jetonun ilk 8 karakteri, başlık, gövde |
| `backend/app/services/payments.py:110` | geçersiz imzalı bildirimde merchant_oid |
| `backend/app/services/payments.py:132` | eksik tahsilatta merchant_oid ve tutarlar |
| `backend/app/services/flight_tracking.py:65,67,177,180` | uçuş no, bacak id, istisna |
| `backend/app/services/eta.py:83,99` | `exc_info=True` |
| `backend/app/services/route_line.py:62,112,122` | bacak id, `exc_info=True` |
| `backend/app/services/notifications.py:99` | `log.exception` SMS hatası |
| `backend/app/services/push_outbox.py:82,98` | `log.exception` push hatası |
| `backend/app/services/jobs.py:66` | kur hatası |
| `backend/app/worker.py:23` | iş adı ve kayıt sayısı |
| `backend/app/cli.py:33-47` | `print`: seed çıktısı, oluşturulan admin id |

- Denetim kaydı (`audit.record`) DB'ye yazılır; çağrı noktalarının tam listesi çıkarılmadı. belief: bağımsız doğrula (komut önerisi değil, kapsam notu: `grep -rn 'audit.record' backend/app`)
- Logging yapılandırması (handler, format, seviye) için aramam `logging.basicConfig|dictConfig` desenini aramadım; bu madde açık. belief: bağımsız doğrula

---

## 5. Secret yönetimi

Okuma kaynağı: ortam değişkenleri, önek `GETAWAY_`, `.env` dosyası (pydantic-settings). verified: `backend/app/config.py:19-22`

### 5.1 Backend ayar adları (değer yazılmadı)

| Değişken | config.py satırı | .env.example satırı |
|---|---|---|
| GETAWAY_JWT_SECRET | 35 (varsayılan: gömülü dev sabiti, satır 14) | 10 (yorum, boş) |
| GETAWAY_FIELD_ENCRYPTION_KEYS | 41 (varsayılan: gömülü dev sabiti, satır 15) | 11 (yorum, boş) |
| GETAWAY_BLIND_INDEX_KEY | 42 (varsayılan: gömülü dev sabiti, satır 16) | 12 (yorum, boş) |
| GETAWAY_DATABASE_URL | 25 (varsayılan kullanıcı/parola içeren yerel DSN) | 3 |
| GETAWAY_REDIS_URL | 26 | 4 |
| GETAWAY_NETGSM_USERCODE / _PASSWORD / _HEADER | 50-52 | aramam `.env.example` içinde bulamadı (komut: `grep -n -o -E '^[A-Za-z_][A-Za-z0-9_]*=' backend/.env.example`) |
| GETAWAY_FCM_CREDENTIALS_FILE (dosya yolu) | 57 | 43 |
| GETAWAY_GOOGLE_ROUTES_API_KEY | 62 | 19 (boş) |
| GETAWAY_GOOGLE_MAPS_API_KEY | 65 | 24 (boş) |
| GETAWAY_AERODATABOX_API_KEY | 77 | 36 (boş) |
| GETAWAY_PAYTR_MERCHANT_ID / _KEY / _SALT | 92-94 | 28-30 (boş) |

- Üretim koruması: `env == "prod"` iken JWT, Fernet ve blind index değerleri dev sabitine eşit ya da boşsa uygulama açılmaz; fake ödeme, fake places ve console push üretimde reddedilir. verified: `backend/app/config.py:114-139`
- FakeProvider imza anahtarı olarak `jwt_secret` kullanır. verified: `backend/app/providers/payments.py:223-224`
- `.env.example` içindeki secret değişkenleri boş: `backend/.env.example` satır 10-12 değer uzunluğu 0 (awk ile ölçüldü), 19, 24, 28-30, 36 boş. verified: `grep -n -E '^[A-Za-z_][A-Za-z0-9_]*=.+' backend/.env.example` boş olmayan satırlar yalnızca 2,3,4,15,17,22,27,31,35,39,42 (sağlayıcı seçimi ve yerel URL'ler)

### 5.2 Frontend / mobil değişken adları

| Değişken | Konum | Not |
|---|---|---|
| GETAWAY_API_URL | `web/.env.example:2`, `admin/.env.example:2`, `mobile/app.config.ts:9`, `mobile/eas.json:10,15,21,27,33` | adres, secret değil |
| NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY | `web/.env.example:6` (boş) | `NEXT_PUBLIC_` önekiyle istemciye gömülür |
| GETAWAY_GOOGLE_MAPS_ANDROID_KEY | `mobile/.env.example:3` (boş), `mobile/app.config.ts:16` | uygulama paketine gömülür |
| GETAWAY_GOOGLE_MAPS_IOS_KEY | `mobile/.env.example:5` (boş), `mobile/app.config.ts:22` | uygulama paketine gömülür |
| EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY | `mobile/.env.example:8` (boş) | istemciye gömülür |
| GETAWAY_GOOGLE_SERVICES_FILE (dosya yolu) | `mobile/.env.example:10`, `mobile/app.config.ts:25,140` | FCM istemci yapılandırması |
| ADMIN_E2E_EMAIL, ADMIN_E2E_PASSWORD, ADMIN_E2E_TOTP_SECRET | `admin/e2e/auth.setup.ts:14-15,26-27,36-40`, `admin/e2e/session.ts:10` | TOTP sırrı git dışı `admin/.env.e2e.local` dosyasına yazılır |

- `.gitignore`: `.env`, `.env.*` (istisna `.env.example`), `backend/var/`, `admin/e2e/.auth/`. verified: `.gitignore:27-29,35,59`
- Git'te izlenen env/anahtar dosyaları: yalnızca dört `.env.example`. verified: `git ls-files | grep -i -E '\.env$|\.env\.|credentials|service-account|google-services|GoogleService|\.pem$|\.key$|\.p12|\.jks|keystore'`

### 5.3 docker-compose ve CI'da düz metin kimlik bilgileri

- `docker-compose.yml:6-8` POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB (yerel geliştirme değeri). verified
- `.github/workflows/ci.yml:28` POSTGRES_PASSWORD, `ci.yml:42` GETAWAY_DATABASE_URL (parola içerir). verified
- `.github/workflows/android-emulator.yml:22,45` GETAWAY_DATABASE_URL, POSTGRES_PASSWORD. verified
- `.github/workflows/ios-simulator.yml:22,76` GETAWAY_DATABASE_URL, `CREATE ROLE ... SUPERUSER PASSWORD` komutu. verified
- `backend/app/config.py:25` GETAWAY_DATABASE_URL varsayılanı aynı yerel kullanıcı/parolayı içerir. verified

### 5.4 Şüpheler

- ŞÜPHE: `backend/app/config.py:14`, `_DEV_JWT_SECRET` (gömülü varsayılan; prod'da validator reddediyor, dev/test ortamlarında JWT ve FakeProvider imza anahtarı olarak kullanılıyor).
- ŞÜPHE: `backend/app/config.py:15`, `_DEV_FERNET_KEY` (gömülü varsayılan alan şifreleme anahtarı).
- ŞÜPHE: `backend/app/config.py:16`, `_DEV_BLIND_INDEX_KEY` (gömülü varsayılan blind index / OTP HMAC anahtarı).
- Bu üçü kodda "yalnızca geliştirme" olarak etiketli; üretim veya paylaşılan bir ortamda (staging, CI) bu değerlerle çalışılıp çalışılmadığı repo üzerinden belirlenemedi. belief: bağımsız doğrula
- Yerel/CI veritabanı parolası (`docker-compose.yml:7`, CI dosyaları) düz metin; değer geliştirme amaçlı görünüyor. belief: bağımsız doğrula
- Gerçek dış servis anahtarı (Google, AWS, GitHub, Slack, özel anahtar PEM) deseni: `git grep -n -I -E '(AIza[0-9A-Za-z_-]{20,}|sk_live|-----BEGIN [A-Z ]*PRIVATE KEY|"private_key"|ghp_...|xox[bp]-|AKIA...)'` yalnızca `backend/app/providers/push.py:61` (alan okuma kodu) ve `backend/tests/test_push.py:30` (test içinde çalışma anında üretilen RSA anahtarı) eşleşti; gerçek anahtar değeri bulunamadı. verified
- Git geçmişinde `GETAWAY_(GOOGLE_MAPS_API_KEY|PAYTR_MERCHANT_KEY|AERODATABOX_API_KEY)=.+` deseni: `git log --all -G` sonuç vermedi. `GETAWAY_JWT_SECRET=` ilk kez `eb2a75e` commit'inde `.env.example` içinde boş değerle eklenmiş. verified

---

## 6. Bağımlılık envanteri

### 6.1 backend (`backend/requirements.txt`, tümü sabit sürüm)

| Paket | Sürüm | Satır |
|---|---|---|
| fastapi | 0.162.0 | 1 |
| uvicorn[standard] | 0.54.0 | 2 |
| pydantic[email] | 2.14.1 | 3 |
| pydantic-settings | 2.15.0 | 4 |
| SQLAlchemy | 2.0.55 | 5 |
| alembic | 1.20.1 | 6 |
| psycopg[binary] | 3.3.6 | 7 |
| GeoAlchemy2 | 0.20.0 | 8 |
| argon2-cffi | 25.1.0 | 9 |
| PyJWT | 2.15.1 | 10 |
| pyotp | 2.10.0 | 11 |
| cryptography | 50.0.2 | 12 |
| redis | 5.3.1 | 13 |
| arq | 0.28.0 | 14 |
| httpx | 0.28.1 | 15 |
| python-multipart | 0.0.32 | 16 |
| pytest | 9.2.0 | 17 (çalışma bağımlılıklarıyla aynı dosyada) |

pyproject.toml veya lock dosyası: aramam backend altında bulamadı (komut: `git ls-files | grep -E '\.(toml|txt)$'`; yalnızca `requirements.txt`). Geçişli bağımlılıklar sabitlenmemiş. verified

### 6.2 web (`web/package.json`, `web/package-lock.json` mevcut)

dependencies: next 15.5.28, next-intl 4.3.12, react 19.1.10, react-dom 19.1.10, motion ^12.43.0, lenis ^1.3.27
devDependencies: @playwright/test ^1.64.1, @axe-core/playwright ^4.14.0, eslint ^9.39.5, eslint-config-next 15.5.28, eslint-plugin-jsx-a11y ^6.10.2, @eslint/eslintrc ^3.3.7, typescript 5.9.3, @types/node 22.20.5, @types/react 19.1.17, @types/react-dom 19.1.11, @types/google.maps ^3.58.1

### 6.3 admin (`admin/package.json`, `admin/package-lock.json` mevcut)

dependencies: next 15.5.28, react 19.1.10, react-dom 19.1.10, qrcode 1.5.4
devDependencies: otpauth ^9.5.2, @playwright/test ^1.64.1, @axe-core/playwright ^4.14.0, eslint ^9.39.5, eslint-config-next 15.5.28, eslint-plugin-jsx-a11y ^6.10.2, @eslint/eslintrc ^3.3.7, typescript 5.9.3, @types/node 22.20.5, @types/qrcode 1.5.6, @types/react 19.1.17, @types/react-dom 19.1.11

### 6.4 mobile (`mobile/package.json`, `mobile/package-lock.json` mevcut)

Ana dependencies: expo ~58.0.21, react-native 0.88.1, react 19.3.0, react-dom 19.3.0, expo-router ~58.0.28, expo-secure-store ~58.0.2, expo-location ~58.0.20, expo-task-manager ~58.0.13, expo-notifications ~58.1.8, expo-web-browser ~58.0.7, expo-document-picker ~58.0.4, expo-linking ~58.0.15, expo-dev-client ~58.0.18, expo-constants ~58.0.14, expo-widgets ~58.0.27, react-native-maps 1.29.11, react-native-web ^0.21.4, react-native-reanimated 4.7.1, react-native-worklets 0.13.0, react-native-gesture-handler ~3.3.0, react-native-screens ~4.30.0, react-native-safe-area-context ~5.10.1, react-native-svg 15.16.0, @react-native-community/datetimepicker 9.2.1, @expo/ui ~58.0.27, @expo/metro-runtime ~58.0.15, @expo/vector-icons ^15.0.2, @expo-google-fonts/inter ^0.4.2, expo-font, expo-haptics, expo-linear-gradient, expo-localization, expo-modules-core, expo-status-bar (hepsi ~58.0.x)
devDependencies: jest ~30.5.2, jest-expo ~58.0.13, @testing-library/react-native ^14.1.0, eslint ^9.39.5, eslint-config-expo ^58.0.4, typescript ~6.0.3, cross-env ^7.0.3, @types/jest 30.0.0, @types/react ~19.3.0, @types/google.maps ^3.58.1

verified: `py -I -c "import json ..." <paket>/package.json` çıktısı. Bilinen açık (CVE) taraması yapılmadı.

### 6.5 Diğer

- `scripts/ui-shots/package.json` + `package-lock.json` (ekran görüntüsü araçları). İçerik okunmadı. belief: bağımsız doğrula

---

## 7. CI/CD

| Workflow | Tetikleyici | Runner | permissions | Kullanılan secret adları | Kanıt |
|---|---|---|---|---|---|
| `.github/workflows/ci.yml` | pull_request, push (`main`), workflow_dispatch | ubuntu-latest (4 iş) | `contents: read` | aramam `secrets.` desenini bulamadı | verified: `ci.yml:5-15,21,58,80,104` |
| `.github/workflows/android-emulator.yml` | workflow_dispatch, push (`ci/ios-*`, `ci/android-*`) | ubuntu-latest | `contents: read` | GETAWAY_GOOGLE_MAPS_API_KEY, GETAWAY_GOOGLE_MAPS_IOS_KEY, GETAWAY_GOOGLE_MAPS_ANDROID_KEY | verified: `android-emulator.yml:8-17,30,57-58,109` |
| `.github/workflows/ios-simulator.yml` | workflow_dispatch, push (`ci/ios-*`) | macos-26 | `contents: read` | GETAWAY_GOOGLE_MAPS_API_KEY, GETAWAY_GOOGLE_MAPS_IOS_KEY, GETAWAY_GOOGLE_MAPS_ANDROID_KEY | verified: `ios-simulator.yml:8-17,30,47-48,112` |

- Emülatör/simülatör iş akışları `GETAWAY_ENV=dev`, `SMS_PROVIDER=console`, `PAYMENT_PROVIDER=fake`, `PUSH_PROVIDER=console` ile çalışır. verified: `android-emulator.yml:21-31`, `ios-simulator.yml:21-31`
- Kullanılan action'lar sürüm etiketiyle (SHA ile değil): actions/checkout@v4, actions/setup-python@v5, actions/setup-node@v4, actions/setup-java@v4, actions/cache/restore@v4, actions/cache/save@v4, actions/upload-artifact@v4, reactivecircus/android-emulator-runner@v2. verified: `grep -n uses: .github/workflows/*.yml`
- Artefakt yükleme: `android-emulator.yml:158`, `ios-simulator.yml:227` (içerik yolu okunmadı). belief: bağımsız doğrula
- Yardımcı betik: `.github/scripts/android-flows.sh`; Maestro akışları `.maestro/android/*`, `.maestro/ios/*`. İçerik okunmadı.
- Dağıtım (deploy) workflow'u: aramam `.github/workflows` altında deploy işi bulamadı (komut: `git ls-files .github`; üç dosya). EAS build profilleri `mobile/eas.json` (development, preview, preview-driver, production, production-driver). verified: `mobile/eas.json`

---

## Bu taramada okunmayan / doğrulanmayan alanlar

- `backend/app/services/*.py` iş mantığı (bookings, dispatch, documents, messages, live_location yazım yetkisi) yalnızca seçili satırlarda okundu; nesne düzeyi yetki (IDOR) kontrolleri envantere alınmadı.
- `backend/app/api/schemas.py` girdi doğrulama şemaları okunmadı.
- Alembic migration'ları (tetikleyici dışında) okunmadı.
- web/admin/mobile istemci kodu (sayfalar, bileşenler) okunmadı; yalnızca BFF, middleware, depolama ve config.
- Bağımlılık açık taraması (pip-audit, npm audit) çalıştırılmadı.
- Çalışan servis yok; dinamik test yapılmadı.
