# Admin paneli

Next.js 15 + TypeScript. Yalnızca Türkçe (iç kullanım). Kapsam: `docs/ekranlar.md`, "Admin paneli".

## Çalıştırma

```
cd admin
npm install
copy .env.example .env.local      # GETAWAY_API_URL: backend adresi
npm run dev                       # http://localhost:3001
npm run typecheck
npm run lint                      # ESLint (taban: docs/ui-review/lint-taban.md)
```

## Test (Playwright + axe)

Sunucu ayakta olmalıdır (`npm run start` veya `npm run dev`, 3001). `npm run test:e2e`.
Girişli testler için yerelde ayrı bir e2e admin hesabı kullanılır: `ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD` ve (ilk girişte otomatik yazılan) `ADMIN_E2E_TOTP_SECRET` değerleri yalnızca git'e girmeyen `admin/.env.e2e.local` dosyasında tutulur; repoya yazılmaz. Değerler yoksa bu testler atlanır. Oturum `e2e/.auth/admin.json` (gitignore) dosyasına kaydedilir.

İlk kullanıcı backend'den oluşturulur: `.venv\Scripts\python -m app.cli create-admin --email siz@getawaytransfers.com`.
İlk girişte doğrulama uygulamasıyla QR okutulur (2FA zorunlu, K-22).

## Ekranlar

| # | Ekran | Yol | Rol |
|---|---|---|---|
| 1 | Giriş ve 2FA | `/login` | herkes |
| 2 | Genel panel | `/` | operasyon, destek |
| 3 | Rezervasyonlar, detay, iptal (iade oranı ezme) | `/bookings`, `/bookings/{id}` | operasyon, destek (iptal: operasyon) |
| 4 | Eşleştirme: bekleyen işler, uygun sürücüler, atama, teklif | `/dispatch` | operasyon |
| 5 | Sürücüler: başvuru kuyruğu, onay, askıya alma, belge inceleme | `/drivers`, `/drivers/{id}` | operasyon |
| 6 | Araçlar ve araç tipleri | `/vehicles` | operasyon (tip düzenleme: admin) |
| 7 | Belge takibi | `/documents` | operasyon |
| 8 | Bölgeler | `/regions` | operasyon |
| 9 | Fiyat kuralları, gidiş-dönüş indirimi, iptal politikaları | `/pricing` | operasyon görür, admin ekler |
| 10 | Komisyon kuralları | `/commission` | muhasebe görür, admin ekler |
| — | Döviz kuru | `/exchange-rates` | muhasebe |
| 11 | Ödemeler ve iadeler | `/payments` | muhasebe |
| 12 | Sürücü hakedişleri, banka dosyası | `/payouts` | muhasebe |
| 13 | Faturalar | `/invoices` | muhasebe |
| 14 | Müşteriler (maskeli) | `/customers` | operasyon, destek (veri silme: admin) |
| 15 | Bildirim şablonları | `/templates` | operasyon |
| 16 | KVKK veri talepleri | `/data-requests` | operasyon, destek |
| 17 | Kullanıcılar ve roller | `/users` | admin |
| 18 | Denetim kayıtları | `/audit-logs` | tüm personel |
| 19 | Sistem ayarları | `/settings` | admin |

Admin rolü her ekrana erişir. Menü role göre süzülür; asıl yetki kontrolü backend'dedir.

## Güvenlik

- Tarayıcı backend'e doğrudan bağlanmaz. `app/bff/[...path]/route.ts` yalnızca personel giriş uçlarını ve `/admin/*` uçlarını iletir.
- Jetonlar `httpOnly`, `SameSite=Strict` çerezlerde tutulur. Oturum 12 saat işlem yapılmazsa düşer.
- Durum değiştiren isteklerde `Origin` kontrol edilir. Sayfa çerçevelenemez (`frame-ancestors 'none'`), arama motorlarına kapalıdır.
- Belge görüntüleme ve IBAN içeren banka dosyası indirme backend'de denetim kaydına yazılır.
- 2FA QR kodu tarayıcıda üretilir. Sır, üçüncü taraf bir servise gönderilmez.
- Üretimde panel ayrı bir alt alan adında yayınlanmalı ve tercihen Cloudflare Access veya IP kısıtıyla korunmalıdır.
