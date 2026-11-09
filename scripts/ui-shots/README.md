# ui-shots: önce/sonra ekran görüntüsü ve axe betikleri

Arayüz taramasında (plan `docs/plans/2026-11-impeccable-tarama.md`) her ekranın önce/sonra görüntüsünü ve axe (WCAG 2.2 AA) ölçümünü aynı adlarla üretir. Çıktı `docs/ui-review/screenshots/<out>/` altına yazılır; `<out>` yalnızca `before` veya `after` olur. `before/` klasörü taban çizgisidir, yeniden üretilmez.

## Kurulum

```
cd scripts/ui-shots
npm ci
```

Bağımlılıklar: `playwright-core` ve `@axe-core/playwright` (sürümler sabit). Chromium yolu sırasıyla:

1. `PW_CHROMIUM` ortam değişkeni,
2. `%LOCALAPPDATA%\ms-playwright\chromium-1248\chrome-win64\chrome.exe` (varsa),
3. `playwright-core`'un kendi tarayıcısı.

## Önkoşul

Geliştirme yığını ayakta olmalıdır: API (8000), web (3000), admin (3001), müşteri mobil önizlemesi (8081), sürücü önizlemesi (8082). Adresler ortam değişkeniyle değişir: `WEB_URL`, `ADMIN_URL`, `MOBILE_URL`, `DRIVER_URL`.

Web, mobil ve sürücü betikleri yerel geliştirme veritabanında gerçek rezervasyon, OTP girişi ve sahte ödeme oluşturur; bu beklenen davranıştır. Üretim adreslerine karşı çalıştırılmaz. `web.js` `--only` ile yalnızca `book-1-vehicle` … `book-5-confirm` arası istenirse akış son istenen ekranda durur: rezervasyon oluşturulmaz, ödeme yapılmaz (`book-3-verify` ve sonrası yine OTP girişi yapar).

## Betikler

Hepsi `--out <before|after>` ister; `--only` virgülle ayrılmış ekran adlarıyla sonucu süzer.

| Betik | Yüzey | Çıktı | Ek seçenek |
| --- | --- | --- | --- |
| `web.js` | web, diller × 1440/390 | `web/<dil>-<genişlik>-<ekran>.png`, `web/_log.json` | `--locales tr,de` (varsayılan `tr,de`; sonra `ar,zh,ja,fr`) |
| `mobile.js` | müşteri mobil (8081) | `mobile/customer-<dil>-<ekran>.png` | `--locales tr,de` |
| `driver.js` | sürücü (8082) | `mobile/driver-tr-<ekran>.png` | yok |
| `admin.js` | admin (3001) | `admin/<genişlik>-<ekran>.png` | yok |
| `axe.js` | web + admin | `_axe.json` | `--locales`, `--pages web:/tr/book,admin:/bookings` |

Örnekler:

```
node web.js --out after --only home
node web.js --out after --only book-1-vehicle,pay --locales tr
node mobile.js --out after --only customer-tr-home        # tam ad
node mobile.js --out after --only home,book-vehicle       # son ek, tüm dillerde
node driver.js --out after --only home-offer,documents
node admin.js --out after --only login,bookings,bookings-detail
node axe.js --out after
```

### Ekran adları

- **web**: `home`, `book-empty`, `bookings-anon`, `account-anon`, `data-request-anon`, `legal-cancellation`, `legal-privacy`, `legal-distance-sales`, `legal-cookies`, `not-found` (`/<dil>/bu-sayfa-yok`), `not-found-in-locale` (`/<dil>/legal/olmayan`), `booking-not-found`, `payment-result` (yönlendirme hedefi tutulur, bekleme durumu çekilir), `book-1-vehicle`, `book-2-details`, `book-3-verify`, `book-4-otp`, `book-5-confirm`, `pay`, `pay-failed`, `booking-detail-paid`, `booking-cancel-preview`, `bookings-list`, `account`, `data-request`. `--only` tam eşleşir. Oturumsuz ekranlar tek başına çekilebilir; akış ve oturumlu ekranlar için tam rezervasyon akışı (OTP + sahte ödeme) çalışır.
- **mobile / driver**: dosya adının uzantısız hali (`customer-tr-home`, `driver-tr-home-offer`) veya son eki (`home`). `driver-tr-home-offer`, `-trip-assigned`, `-trip-sign`, `-trip-enroute` ve `customer-tr-booking-live` bir müşteri rezervasyonu ile çevrimiçi sürücü ister; betik bunu kendisi kurar. Müşteri akışı `--only` ile son istenen ekrandan sonra durur. Metin seçicileri yalnızca `tr` ve `de` içindir; yeni dillerde mobil betik seçicileri güncellenmelidir.
- **admin**: `login` (her zaman oturumsuz) ve panel ekranları `dashboard`, `bookings`, `dispatch`, `drivers`, `documents`, `vehicles`, `regions`, `pricing`, `commission`, `exchange-rates`, `payments`, `payouts`, `invoices`, `customers`, `templates`, `data-requests`, `users`, `audit-logs`, `settings`, `account`, `bookings-new` (manuel rezervasyon formu), `trip-reviews` (müşteri bitirişleri), ayrıca listedeki ilk satırın ayrıntısı `bookings-detail` ("Yeni rezervasyon" bağlantısı hariç) ve `drivers-detail` (süzgeç "Tümü"ne alınır; satır yoksa atlanır).

## Admin oturumu

Betik kimlik bilgisi içermez. Panel ekranları için `admin/e2e/.auth/admin.json` (git'e girmez) gerekir; yoksa yalnızca giriş ekranı çekilir. Oluşturmak için (kimlik bilgisi `admin/.env.e2e.local` içinde, bkz. admin Playwright kurulumu):

```
cd admin
npx playwright test --project=setup
```

Admin yenileme jetonu her kullanımda döner. Bu yüzden `admin.js` ve `axe.js` tüm genişlikler için tek tarayıcı bağlamı kullanır ve çalışma sonunda dönen oturumu aynı dosyaya geri yazar. Oturum dosyasını başka bir araçla (ör. `playwright test`) aynı anda veya aralarına yeni bir `setup` koymadan paylaşırsanız oturum düşebilir; betik bunu algılar, uyarı yazar ve exit 1 verir. Çözüm `setup` projesini yeniden çalıştırmaktır. Oturum 12 saat geçerlidir.

## Notlar

- `--only` kullanıldığında web günlüğü `_log-only.json` olarak yazılır (tam günlük `_log.json` ezilmez).
- Çıktı adları taban çizgisindeki dosyalarla aynıdır; önce/sonra çiftleri dosya adıyla eşleşir.
- Web betiği her çalıştırmada benzersiz OTP telefonu kullanır; bir ekran zaman aşımına uğrarsa `missed` listesine yazılır, `_log.json` yine yazılır ve betik sonunda exit 1 verir.
- Admin oturum dosyası, çalışma hata ile kesilse bile `finally` içinde geri yazılır (oturum geçersiz değilse).
- Mobil betikte bir adım başarısız olursa `missed` listesinde raporlanır ve betik exit 1 ile biter; kalan ekranlar yine çekilir.
