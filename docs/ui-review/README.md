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

`screenshots/before/` (toplam 138 görüntü, 26 MB). Betikler proje dışında (geçici klasörde `playwright-core` + makinedeki chromium-1248) çalıştırıldı; parametrelendirilmiş halleri artık `scripts/ui-shots/` altındadır (bkz. oradaki README; önce/sonra aynı adlarla üretilir).

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
| Rezervasyonlarım | `/bookings` | oturum denetleniyor ("Oturum denetleniyor…"; B-W6'dan önce boş), oturumsuz (kodla sorgulama + giriş), liste, boş liste |
| Rezervasyon detayı | `/bookings/[code]` | yükleniyor ("Rezervasyon bilgileri yükleniyor…"; B-W6'dan önce boş), ağ hatası + tekrar dene, bulunamadı (geçersiz kod 404 ve API 404/403: "Rezervasyon bulunamadı"), ödendi bildirimi, ödeme bekliyor, canlı takip (5 sn yoklama; canlı / konum güncellenemiyor / konum yok), iptal önizlemesi (yükleniyor, hata + tekrar dene, iade tutarı + K-14), iptal edildi (duyurulur), iptal edilemez (409) |
| Ödeme | `/bookings/[code]/pay` | iFrame, ödeme hatası + tekrar dene, ödeme gerekmiyor, hata |
| Ödeme sonucu | `/booking/payment-result` | yönlendirme beklerken "Ödeme sonucu alınıyor…" (iFrame'den çıkar); 8 sn sonra gecikme notu (B-W5'ten önce: `null`, boş sayfa) |
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

## 4. Tarama durumu

Ortak dosya görevlerinde (`*0`) critique puanı verilmez; yalnızca detector, axe ve ilgili testler.

| Ekran | Önce | Sonra | Açık P0/P1 | Durum | Rapor |
|---|---|---|---|---|---|
| web/shared (B-W0: `globals.css`, `home.css`, üst bilgi, logo, `Motion.tsx`, `States.tsx`, yerel 404) | — (ortak dosyalar) | — | 0 | Tamamlandı (2026-11-02, düzeltme turu 1 dahil): başlıkta axe 0 (1440 ve 390), yerel 404 (`html[lang]`, 404 kodu, site düzeni), `:focus-visible` 2 px halka, yer tutucu `--muted` (dinlenme ve üzerine gelmede ≥ 4,5:1, ölçülerek test edilir), mantıksal özellikler, hareket azaltma, Esc ile mobil menü; `shared.spec.ts` 14/14. Açık P2: logo "TRANSFERS" 9,28 px (kimlik kararı), üretimde 404 HTML kabuğu (Next 15) | `docs/degisiklik_gunlugu.md` (2026-11-02, B-W0); görüntüler `screenshots/after/web/*-{home,not-found,legal-privacy}.png` |
| web/home (B-W1: `/`) | critique 25/36 (%69), audit 13/20, axe 2 | critique 31/36 (%86), audit 17/20, axe 0 | 0 | Tamamlandı (2026-11-02): kicker ve pirinç küçük metin kalktı, giriş sahnesi saf CSS (JS'siz ve hareket azaltmada tüm bölümler görünür), combobox `aria-activedescendant`, adlı sayaçlar ve radyo grubu, eksik adres mesajı, "Nasıl çalışır" rota rayı, koyu güven şeridi, Vito yola girer; `home.spec.ts` 14 test (2 proje), 360–1440 Almanca taşma yok. Açık P2: uçuş takibi metni (kullanıcı kararı), logo alt yazısı, arama yeniden deneme (B-W2) | `web-home.md`; görüntüler `screenshots/after/web/*-home.png` |
| web/book (B-W2: `/book`) | critique 27/40 (%68), audit 14/20, axe 1 (bilgiler adımı, animasyonlu yarı saydam ipucu) | critique 35/40 (%88), audit 18/20, axe 0 (4 adım) | 0 | Tamamlandı (2026-11-02): adım göstergesi `aria-current` ve yolda değişmez (doğrulama dahil), adım değişince odak başlığa; ad/uçuş alan düzeyi hata; fiyat, araç tipi ve adres aramasında yeniden dene; onay kutuları işaretsiz, ödeme kapalıyken nedeni yazılı; onayda K-14 iptal kademeleri; "2 yolcu · 2 bagaj"; `next/image`; lint 0. `book.spec.ts` 360–1440 Almanca taşma yok, TRY tek satır. Açık P2: telefonda onayda özet altta, rezervasyon oluşturma genel hata metni | `web-book.md`; görüntüler `screenshots/after/web/*-book-*.png` |
| web/otp (B-W3: `OtpLogin`, `RequireLogin`) | critique 26/40 (%65), audit 14/20, axe 0 (sorunlar otomatik kural dışı) | critique 36/40 (%90), audit 19/20, axe 0 (telefon, kod, yanlış kod) | 0 | Tamamlandı (2026-11-02): hatalar `role="alert"` ve alana bağlı (yanlış kodda odak alana), telefon alanının adı ülke kodunu içerir (görünür ön ek), "+90…" çift ön ek almaz, tekrar gönder 45 sn bekler ve yeni kodu duyurur, devre dışı düğme yerine alan hatası, meşgul metni, `autoFocus` yerine eylem sonrası odak, `RequireLogin` yükleniyor durumu, geliştirme kutusu yalnızca kehribar; lint 0 (web geneli). `otp.spec.ts` 12 test (360–1440 Almanca taşma yok). Açık: 429 kalan süre (backend), kod geçerlilik süresi (P3) | `web-otp.md`; görüntüler `screenshots/after/web/*-{book-3-verify,book-4-otp,account-anon,data-request-anon}.png` |
| web/pay (B-W4: `/bookings/[code]/pay`, `PaymentPanel`) | critique 22/40 (%55), audit 14/20, axe 0 (sorunlar otomatik kural dışı: rolsüz hata ve red) | critique 36/40 (%90), audit 18/20, axe 0 (ödeme açık ve red) | 0 | Tamamlandı (2026-11-02): rezervasyon ve ödeme sayfası için yükleniyor durumları, yükleme/ağ/başlatma hatasında `ErrorState` + yeniden dene (tutar yerinde), ödeme reddi `role="alert"` + birincil "Tekrar dene", sağlayıcı sayfası açıkken tekrar dene yok, bekleme `role="status"`, özet kartında kod/güzergâh/tarih, iptal edilmiş rezervasyon açıklaması, tutar tek satır tabular; ortak iskelet parıltısı yalnızca hareket serbestken; "30 dakika" metni backend ile uyuşuyor. Düzeltme turu 1: `?result=ok` için "Ödemeniz onaylanıyor" + 75 sn sonra "Durumu yenile"/"Ödemeye dön", başlatma kilidi, yoklamada 401 → giriş ve 3 hatada "Otomatik güncelleme durdu" (K-42, K-43). `pay.spec.ts` 20 test (360–1440 Almanca taşma yok, `₺12.345,00` tek satır). Açık P3: telefonda iFrame ilk ekranın altında, redde yardım bağlantısı, süre metni sabit (admin ayarı), açık sağlayıcı sayfasında oturum dolması | `web-pay.md`; görüntüler `screenshots/after/web/*-{pay,pay-failed,pay-loading,pay-error,pay-cancelled,pay-confirm-slow}.png` |
| web/payment-result (B-W5: `/booking/payment-result`, `PaymentResult`) | critique 7/24 (%29; geçiş ekranı: 4 ilke n/a), audit 13/20, axe 0 (sayfa boştu) | critique 22/24 (%92), audit 19/20, axe 0 (bekleme ve gecikme notu) | 0 | Tamamlandı (2026-11-02): ekran artık boş değil: "Ödeme sonucu alınıyor…" (`LoadingState`, `role="status"`, iFrame içinde de) + `h1` "Ödeme"; 8 sn sonra "Rezervasyonlarım" bağlantılı gecikme notu (üst pencereye geçiş engelliyse de); `sessionStorage` hatasında çökme yerine `/bookings`. Yönlendirme sözleşmesi (`?status=` → `/bookings/[code]/pay?result=`) değişmedi, `pay.spec.ts` 19 yeşil; `payment-result.spec.ts` 16 test (360–1440 Almanca taşma yok). Açık P3: iFrame içinde site üst/alt bilgisi bir an görünür, backend adresi dilsiz | `web-payment-result.md`; görüntüler `screenshots/after/web/*-payment-result.png` |
| web/booking-detail (B-W6: `/bookings/[code]`, `BookingDetail`; yan bulgu `BookingsHome`) | critique 19/40 (%48), audit 12/20, axe 0 (sorunlar otomatik kural dışı: odak kaybı, duyurulmayan sonuç, simge-yalnız etiket) | critique 36/40 (%90), audit 18/20, axe 0 (ödenmiş + iptal paneli; konum güncellenemiyor) | 0 | Tamamlandı (2026-11-03): yükleniyor/ağ hatası + tekrar dene/bulunamadı (geçersiz kod 404 dahil)/401 durumları; iptal paneli API'nin iade tutarı ve oranı ("%100"), K-14 kademeleri birebir + politika bağlantısı, eşit görünür çerçeveli "Vazgeç", odak yönetimi ve duyurulan "Rezervasyon iptal edildi", çift tıklama kilidi, 409 açıklaması; eskiyen canlı konum kehribar "Konum güncellenemiyor" + son güncelleme saati (K-44), nabız hareket tercihine bağlı; yazılı bilgi etiketleri, telefonda dikey zaman çizelgesi; `BookingsHome` oturum denetlenirken `LoadingState`. Düzeltme turu 1: duvar saatiyle eskime (asılı istek, değişmeyen konum zamanı), üst üste binmeyen yoklama, ilk hata durumu, panel içinde iptal hatası, liste hatasında `ErrorState` + 401 girişi. `booking-detail.spec.ts` 23 test (360–1440 Almanca + 120 karakter + `12.345,00 TRY` taşma yok). Açık P3: durum kendiliğinden yenilenmiyor, sekme başlığı genel, iade süresi panelde yok | `web-booking-detail.md`; görüntüler `screenshots/after/web/*-{booking-detail-paid,booking-cancel-preview,booking-not-found,bookings-anon,booking-live,booking-live-stale,booking-loading,booking-error,booking-cancel-long}.png` |
| web/bookings (B-W8: `/bookings`, `BookingsHome`) | critique 22/40 (%55), audit 14/20, axe 0 | critique 35/40 (%88), audit 18/20, axe 0 (oturumsuz + alan hatası, liste, boş liste) | 0 | Tamamlandı (2026-11-03): kod alanında görünür biçim ipucu ve örnekli alan hatası (devre dışı düğme yerine; gönderimde odak alana), yapıştırılan "GA7K-3P9Q" temizlenir, boş liste `EmptyState` + "Yeni rezervasyon", liste `h2` + `ul`, telefonda tam genişlik düğme. `bookings.spec.ts` 8 test (360–1440 Almanca + `12.345,00 TRY` taşma yok). Açık P3: sayfalama yok (API) | `web-bookings.md`; görüntüler `screenshots/after/web/*-{bookings-anon,bookings-list}.png` |

## 5. Yüzey 1 kapanışı (web gelir akışı, 2026-11-03)

Yüzey incelemesi (`.superpowers/sdd/2026-11-impeccable-tarama/surface1-review.md`, aralık `d5e53d7..e07a97a`): **düzeltmelerle hazır**; Kritik yok, 3 Önemli, 12 Küçük bulgu. Değişmezler korundu: istemcide fiyat hesaplanmaz, K-14 kademeleri birebir, yasal metin değişmedi, önceden işaretli onay kutusu yok, PayTR canlı/split/garanti kapalı, backend değişikliği yok.

| # | Bulgu | Çözüm |
|---|---|---|
| 1 (Önemli) | Ağ kesintisi veya `auth/me` 5xx giriş formu gösteriyordu; testler `/bff/auth/` hariç tutuyordu | Oturum üç durumlu (`checkSession`, `useSession().error`): yalnızca 401 "oturum yok"; `RequireLogin`, `BookingsHome`, sihirbaz `ErrorState` + yeniden dene. Tam kesinti testleri tüm `/bff/**`'yi düşürür; `auth/me` ağ hatası ve 500 testleri |
| 2 (Önemli) | Ödeme yoklamasında üst üste binme koruması ve süre sınırı yoktu | Ortak `usePoll` (`lib/poll.ts`): istek sürerken atlanır, 2,5 sn'de iptal, iptal başarısız sayılır (3'te durur); canlı konum da aynı kancayı kullanır. Asılı istek testi |
| 3 (Önemli) | Yoklama 401'i açık ödeme iFrame'ini kaldırıyor, yeniden girişte yeni ödeme açılıyordu | K-45: iFrame kalır, yoklama durur, not + "Yeniden giriş yap"; yeniden girişte `start()` çağrılmaz, aynı rezervasyon yoklanır |
| 4 | `PaymentPanel` depolama erişimi korumasız | `lib/booking.ts` `session.get/set/remove` (try/catch) |
| 5 | "Oturumunuz sona erdi" metni yoktu | `errors.unauthorized` (4 dil): sihirbaz, `RequireLogin`, Rezervasyonlarım |
| 6 | `useSessionExpired` sözleşmesi örtük, iki panelde kullanılmıyordu | Sözleşme belgelendi, sağlayıcı dışında geliştirmede `console.warn`; `AccountPanel`, `DataRequestPanel` 401'de girişe döner |
| 7 | İlk yüklemede süre sınırı yoktu | `api()` varsayılan 15 sn (`AbortController`, çağıranın sinyaliyle birleşir); iptal hiçbir zaman 401 değildir. Ödeme, detay ve oturum denetimi süre aşımı testleri |
| 8 | Yinelenen yardımcılar; ödemede 404/403 genel hata | `PAID`, `isFinal`, `isUnauthorized`, `statusClass`, kod biçimi `lib/booking.ts`'te; ödemede `BookingNotFound` (h2) |
| 9 | "Tekrar dene" sonrası odak `<body>`'ye düşüyordu | `ErrorState` odağı bölge başlığına (yoksa yükleniyor durumuna) taşır; detayda yüklenince rezervasyon kodu başlığına |
| 10 | Devre dışı ödeme düğmesi açıklamasına bağlı değildi | `aria-describedby="pay-hint"` |
| 11 | Metin tutarsızlıkları | Rezervasyonlarım `regionLabel()`; de/ru yükleniyor metinleri birleşti; de `otp.checking` boşluğu |
| 12 | Test yalıtımı | Ortak `e2e/session.ts`; kurgusal numaralar (ABD 555-01XX, Birleşik Krallık 07700 900xxx) rastgele sonekli; "yeni hesapta rezervasyon yok" varsayımı kalktı; yerel olmayan hedefte SMS testleri atlanır; e2e kayıt bırakır notu `acik_konular.md`'de |
| 13 | `.skeleton` sayfa stilindeydi | `globals.css`'te durum bileşenlerinin yanında; K-43 hareket koşulu korundu |
| 14 | `PaymentResult` saklanan kodu denetlemeden adrese koyuyordu | `BOOKING_CODE_RE` ile denetlenir |
| 15 | Onay adımındaki yeni sekme bağlantıları bunu söylemiyordu | "(yeni sekmede açılır)" (`bookings.newTab`, 4 dil) |

Doğrulama: `tsc` ve `eslint .` temiz, `npm run build` başarılı. Tam web e2e (`--workers=1`, iki proje, `5d4e87d`): 254 geçti, 42 atlandı, 0 hata. Ayrıntılar: `.superpowers/sdd/2026-11-impeccable-tarama/task-B-W7-report.md`. Kalan (P3): `AccountPanel`/`DataRequestPanel` durum bileşenleri (B-W9), sağlayıcı sayfası boş çizilirse kurtarma eylemi.
