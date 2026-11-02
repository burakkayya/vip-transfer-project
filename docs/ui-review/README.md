# Arayüz taraması (Impeccable): taban ve ekran envanteri

Durum: **taban çizgisi alındı, plan onayı bekleniyor** (2026-11-02). Plan: `docs/plans/2026-11-impeccable-tarama.md` (henüz yazılmadı, brainstorming sonrası).

## 1. Taban çizgisi (2026-11-02, `main` 7ba4480)

| Kontrol | Komut | Sonuç |
|---|---|---|
| Backend testleri | `backend: .venv\Scripts\python -m pytest -q` | 78 passed, 4 uyarı (35 sn) |
| Web tip denetimi | `web: npx tsc --noEmit` | rc=0 |
| Admin tip denetimi | `admin: npx tsc --noEmit` | rc=0 |
| Mobil tip denetimi | `mobile: npx tsc --noEmit` | rc=0 |
| Web build | `web: npm run build` | rc=0, 43 statik sayfa |
| Admin build | `admin: npm run build` | rc=0, 24 sayfa |
| Lint | — | **Yapılandırılmamış**: hiçbir uygulamada ESLint yapılandırması veya `lint` betiği yok; `next build`'in lint adımı boş geçiyor |
| Ön yüz testleri | — | **Yok**: Playwright, axe, Jest veya RN test altyapısı yok |
| Bağımlılıklar | `npm ls --depth=0` | Tutarlı; web ve admin'de 2 zararsız "extraneous" wasm paketi. `npm ci` gerekmedi |

### Ekran görüntüleri ("önce")

`screenshots/before/` (toplam 138 görüntü, 26 MB). Betikler proje dışında (geçici klasörde `playwright-core` + makinedeki chromium-1248) çalıştırıldı; projeye bağımlılık eklenmedi.

| Yüzey | Kapsam | Adet |
|---|---|---|
| Web | `tr` ve `de` × 1440 ve 390 px; oturumsuz ve oturumlu sayfalar; rezervasyon sihirbazının 5 adımı, ödeme, ödeme reddi, ödenmiş detay, iptal önizlemesi | 93 |
| Mobil müşteri | `tr` ve `de`; giriş, SMS kodu, ana sayfa, boş liste, profil, rota, adres arama, araç, bilgiler, ödeme bekleniyor, detay, canlı takip (tr), iptal önizlemesi, liste | 31 |
| Mobil sürücü | `tr`; giriş, SMS kodu, çevrimdışı (GO), çevrimiçi, teklif kartı, atanmış yolculuk, karşılama tabelası, yolda, yaklaşan işler, belgeler, kazanç, yeni kayıt | 12 |
| Admin | Yalnızca giriş (1440, 390). Diğer ekranlar parola ve 2FA kodu gerektirir | 2 |

Mobil web önizlemesi her genişlikte 390×844 telefon çerçevesi çizer (`mobile/app/_layout.tsx` `PhoneFrame`, 11 px kenarlık); görüntüler 440×920 pencerede çerçeveyle alındı, iç alan yaklaşık 368 px.

### axe (WCAG 2.0/2.1/2.2 A+AA), oturumsuz sayfalar

Ham sonuç: `screenshots/before/_axe-baseline.json`.

| Kural | Etki | Nerede |
|---|---|---|
| `label-content-name-mismatch` | serious | Web başlığındaki logo bağlantısı (`a[aria-label="Getaway Transfers"]`), 1440 px'te tüm sayfalarda |
| `aria-prohibited-attr` | serious | Web ana sayfa `h1 > span` (tr, de; 1440 ve 390) |
| `html-has-lang` | serious | Hiçbir rotaya uymayan adres (ör. `/tr/yok`): Next'in varsayılan İngilizce 404'ü, `lang` yok, site düzeni yok |
| — | — | Admin giriş: 0 ihlal |

## 2. Ekran envanteri (koddan)

Rota düzeyinde **46 ekran**: web 13, admin 23, mobil 10.

### Web (`web/app/[locale]`), 13

| Ekran | Rota | Ekran içi durumlar |
|---|---|---|
| Ana sayfa | `/` | rota formu, adres önerileri, mobil menü, filo, SSS |
| Rezervasyon sihirbazı | `/book` | rota girişi (boş), araç (iskelet / fiyatlı / "uygun değil"), bilgiler, uçuş no hatası, doğrulama (telefon), SMS kodu (geliştirme kodu kutusu), onaylar, fiyat değişti hatası |
| Rezervasyonlarım | `/bookings` | oturumsuz (kodla sorgulama + giriş), liste, boş liste |
| Rezervasyon detayı | `/bookings/[code]` | yükleniyor (**gösterge yok, boş döner**), bulunamadı, ödendi bildirimi, ödeme bekliyor, canlı takip (5 sn yoklama), iptal önizlemesi, iptal edildi |
| Ödeme | `/bookings/[code]/pay` | iFrame, ödeme hatası + tekrar dene, ödeme gerekmiyor, hata |
| Ödeme sonucu | `/booking/payment-result` | görünmez yönlendirme (iFrame'den çıkar, `null` çizer) |
| Hesabım | `/account` | oturumsuz giriş, profil formu, pazarlama onayı, başarı/hata mesajı |
| Veri talebi | `/data-request` | oturumsuz giriş, form, gönderildi |
| Yasal: iptal ve iade | `/legal/cancellation` | taslak uyarısı |
| Yasal: KVKK aydınlatma | `/legal/privacy` | taslak uyarısı |
| Yasal: mesafeli satış | `/legal/distance-sales` | taslak uyarısı |
| Yasal: çerez | `/legal/cookies` | taslak uyarısı |
| Bulunamadı | `not-found.tsx` | yerel 404 (`notFound()` çağrılınca) / Next varsayılan 404 (eşleşmeyen adres) |

### Admin (`admin/app`), 23

`login` (parola, 2FA kurulum QR, 2FA kodu), panel ana sayfa `/`, `account`, `audit-logs`, `bookings`, `bookings/[id]`, `commission`, `customers`, `data-requests`, `dispatch`, `documents`, `drivers`, `drivers/[id]`, `exchange-rates`, `invoices`, `payments`, `payouts`, `pricing`, `regions`, `settings`, `templates`, `users`, `vehicles`. Ekran içi durumlar plan aşamasında giriş yapılarak çıkarılacak.

### Mobil (`mobile/app`), 10 (+ `index` yönlendirme)

| Ekran | Dosya | Ekran içi durumlar |
|---|---|---|
| Giriş (müşteri ve sürücü çeşidi) | `login.tsx` | telefon, SMS kodu (6 kutu), geliştirme kodu, tekrar gönder sayacı, hata |
| Sürücü kaydı | `driver-register.tsx` | form |
| Müşteri: rezervasyon | `(customer)/book.tsx` | ana sayfa ("Nereye?", havalimanları, iskelet), rota (Planla/Şimdi, gidiş-dönüş, sayaçlar), adres arama penceresi, araç (iskelet / fiyat / hata), bilgiler ve onaylar |
| Müşteri: rezervasyonlarım | `(customer)/bookings.tsx` | Yaklaşan / Geçmiş, boş durum + "Transfer planla" |
| Müşteri: profil | `(customer)/profile.tsx` | kişisel bilgiler, pazarlama, veri talebi, yasal metinler |
| Müşteri: rezervasyon detayı ve canlı takip | `booking/[code].tsx` | ödeme bekleniyor, onaylandı, sürücü kartı, canlı takip (WebSocket), iptal önizlemesi, iptal edildi |
| Sürücü: ana sayfa | `(driver)/home.tsx` | onay bekliyor / askıda, çevrimdışı (GO), çevrimiçi (radar), teklif kartı (geri sayım), yaklaşan işler, boş liste, hata |
| Sürücü: yolculuk | `trip/[legId].tsx` | atandı → yolda → vardı → başladı → bitti, karşılama tabelası (tam ekran), navigasyon, konum paylaşımı (açık / kapalı / izin reddi) |
| Sürücü: belgeler | `(driver)/documents.tsx` | tamamlama halkası, belge durumları, araç ekleme, yükleme |
| Sürücü: kazanç | `(driver)/earnings.tsx` | haftalık grafik, hakediş listesi (bekliyor / ödendi / iptal) |

Not: `trip/[legId]` sürücünün yolculuk ekranıdır; müşterinin canlı takibi `booking/[code]` içindedir.

## 3. `ekranlar.md` ile farklar

| Konu | `ekranlar.md` | Kod |
|---|---|---|
| Admin ekran sayısı | 19 | 23 rota: `exchange-rates` ve `account` listede yok; `bookings/[id]`, `drivers/[id]` ayrı rota |
| Admin genel panel | "canlı harita" | Harita yok; durum sayaçları ve OpenStreetMap bağlantısı |
| Web 9, mobil 5 | "değişiklik ve iptal" | Değişiklik akışı yok; e-posta yönlendirme metni var |
| Mobil müşteri 6 | "bildirim tercihleri" | Yalnızca pazarlama anahtarı; push yok (FCM bekliyor) |
| Web | — | `account`, `booking/payment-result` ve 404 listede yok |
| Günlük kiralama (K-29) | — | Hiçbir yüzeyde ekran yok (bilinen, bekleyen) |
