# Web ödeme sonucu (`/booking/payment-result`, `PaymentResult`): Impeccable geçişi (B-W5)

Tarih: 2026-11-02 · Dal: `ui/impeccable-pass` · Mod: **Operate** (geçiş ekranı) · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass. Skill'in soru/karar adımları yerine görev brifi kullanıldı (soru sorulmadı).
Kapsam: gelir akışında ödemeden sonra gelen geçiş ekranı. PayTR (geliştirmede sahte sağlayıcı) iFrame'i `merchant_ok_url` / `merchant_fail_url` ile `/booking/payment-result?status=ok|fail` adresine döner; sayfa iFrame'den çıkar ve `/bookings/[code]/pay?result=ok|fail` adresine geçer. Bekleyen rezervasyon kodu `sessionStorage.ga_pending_booking`'dedir (B-W4 yazar). Bu sözleşme (adresler, parametreler, kodun kaynağı) **değişmedi**; backend değişikliği yok.

## Puanlar

Bu ekran bir geçiş ekranıdır: girdi, seçenek, hafıza ve yardım yoktur. Uygulanamayan Nielsen ilkeleri `n/a` işaretlendi ve puan uygulanabilir azamîye göre yeniden normalleştirildi (6 ilke, /24). Önce ve sonra aynı 6 ilke puanlandı.

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, 6 uygulanabilir, /24) | **7/24 (%29, Critical)** | **22/24 (%92, Excellent)** |
| audit | **13/20 (Acceptable)** | **19/20 (Excellent)** |
| axe (wcag2a/2aa/21a/21aa/22aa) | 0 (sayfa boştu; denetlenecek içerik yok) | **0** (bekleme durumu ve gecikme notu) |
| detector (`impeccable detect`, `PaymentResult.tsx`, `payment-result/page.tsx`) | 0 | 0 |
| lint (`PaymentResult.tsx`, `page.tsx`, `payment-result.spec.ts`) | 0 | **0** |

Gelir akışı eşiği %85: sonra **%92**.

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not |
|---|---|---|---|---|
| 1 | Sistem durumu | 0 | 4 | "Ödeme sonucu alınıyor…" `LoadingState` (`role="status"`), iFrame içinde de görünür ve duyurulur; sayfa başlığı "Ödeme" |
| 2 | Gerçek dünya | 1 | 4 | Hiçbir metin yoktu; dört dilde sade, somut mesaj ("Zahlungsergebnis wird abgerufen…") |
| 3 | Kullanıcı kontrolü | 1 | 3 | Boş sayfadan çıkış yoktu; 8 sn sonra "Rezervasyonlarım" bağlantılı not. Anında eylem yok (otomatik geçiş) |
| 4 | Tutarlılık | 2 | 4 | Ödeme sayfasıyla aynı `container narrow page` + `h1.page-title` + ortak `LoadingState` |
| 5 | Hata önleme | n/a | n/a | Girdi yok |
| 6 | Tanıma | n/a | n/a | Seçenek ve hafıza yükü yok |
| 7 | Esneklik | n/a | n/a | Tek, otomatik adım |
| 8 | Estetik ve sadelik | 2 | 4 | Başlık + üç iskelet çizgisi + tek satır; başka öğe yok |
| 9 | Hata kurtarma | 1 | 3 | `sessionStorage` erişimi hata verirse sayfa çöküyordu (Next hata sayfası); artık "Rezervasyonlarım"a gider. Üst pencereye geçiş engelliyse (iFrame) not + bağlantı. Otomatik yeniden deneme yok |
| 10 | Yardım | n/a | n/a | Geçiş ekranı |
| **Toplam** | | **7/24** | **22/24** | |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 1 | 4 | `h1`, `role="status"` (iFrame içinde de), gecikme notu kalıcı `aria-live="polite"` bölgesinde; axe 0 |
| Performans | 3 | 3 | Ekstra ağ çağrısı yok; istemci bileşeni zorunlu (`useRouter`, `sessionStorage`); tek zamanlayıcı, çıkışta temizlenir |
| Tema | 3 | 4 | Yalnızca tokenlar (`--muted`, `--text`); yeni stil `.result-stalled` |
| Duyarlılık | 3 | 4 | 360/390/768/1024/1440 px Almanca taşma ve kesilme yok (test) |
| Uygulama bütünlüğü | 3 | 4 | Lint 0, detector 0; mantıksal özellik (`margin-block`); sözleşme korundu |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Ekran `null` çiziyor: yönlendirme beklerken boş sayfa (Review Focus 2); iFrame içinde de boş | **Kapandı**: `LoadingState` "Ödeme sonucu alınıyor…" + `h1` "Ödeme". Testler: "payment-result shows a status message while redirecting", "payment-result status message is translated", "inside the iframe the status message is visible and announced" |
| P1 | `sessionStorage.getItem` hata verirse (depolama engelli) bileşen çöküyor, Next hata sayfası (bulundu, harden) | **Kapandı**: `pendingCode()` `try/catch`; kod yoksa `/bookings`. Test: "a broken session storage still redirects to bookings" (önce FAIL: sayfa `__next_error__`) |
| P2 | Yavaş ağda veya üst pencereye geçiş engelliyse sonsuz bekleme, çıkış yok | **Kapandı**: 8 sn sonra "Yönlendirme beklenenden uzun sürüyor. Ödemenizin durumunu rezervasyonlarınızdan görebilirsiniz." + "Rezervasyonlarım" bağlantısı (`target="_top"`). Üst pencereye atama `try/catch` içinde. Testler: "a slow redirect shows a note…", iFrame testi |
| P3 | Sağlayıcı iFrame'i içinde site üst bilgisi ve alt bilgisi bir an görünür (layout ortak) | Açık (P3): iFrame'den çıkış milisaniyeler sürer; layout'u iFrame'e göre koşullandırmak ortak dosya değişikliği ister |
| P3 | Backend adresi dilsiz (`/booking/payment-result?status=…`); dil ara katman yazılımıyla seçilir (çerez/tarayıcı) | Açık (P3): davranış değişmedi; backend kapsam dışı |

### Sözleşme ve "bozuk mu?" değerlendirmesi

Yönlendirme mantığı **bozuk değil**, korundu: iFrame'de `window.top.location.href = window.location.href`; üst pencerede `ga_pending_booking` varsa `/bookings/<kod>/pay?result=<status>`, yoksa `/bookings`; `status` yalnızca `ok` ise `ok`, aksi hâlde `fail`. Bu davranış önce de çalışıyordu; kırmızı olmayan (mevcut davranışı belgeleyen) testler: "without pending booking it redirects to bookings", "with pending booking ok/fail…", "unknown status counts as fail", "inside the provider iframe it breaks out…". Yalnızca iki küçük sağlamlaştırma yapıldı (`sessionStorage` ve `window.top` atamasında `try/catch`), ikisi de gerçek hata yolu (çökme / sonsuz bekleme) için. `PaymentPanel` (B-W4, `?result=ok` → "Ödemeniz onaylanıyor…") dokunulmadı; `pay.spec.ts` 19 test yeşil.

## Yapılanlar (Impeccable adımları)

- **harden**: yükleniyor, depolama hatası, yavaş yönlendirme, üst pencereye geçiş engeli; Almanca uzun metin (`overflow-wrap: anywhere`); mantıksal özellik (`margin-block`). Tutar/ad gösterilmiyor (120 karakter, `₺12.345,00` bu ekranda uygulanamaz).
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca testi (taşma + kesilme); yeni bir düzen yok, ortak `container narrow page`.
- **clarify** (tr, en, de, ru): yeni `pay.resultLoading` ve `pay.resultStalled`; `pay` 26 anahtar, dört dilde eşit. Bağlantı metni mevcut `nav.bookings`. Yasal metne dokunulmadı.
- **optimize**: `"use client"` gerekli (yönlendirme, depolama); sayfa sunucu bileşeni; `LoadingState` sunucu-güvenli, sunucuda çizilir (JS yüklenmeden de metin görünür). Görsel yok.
- **animate / delight / overdrive**: eklenmedi (Operate, geçiş ekranı; ödeme anında hareket dikkat dağıtır). İskelet parıltısı ortak, `prefers-reduced-motion` altında kapalı (K-43, B-W4).
- **polish**: kalıcı canlı bölge, bağlantı vurgusu (`--text`, 600), not `--muted`.

## Değişen dosyalar

`web/components/PaymentResult.tsx`, `web/app/[locale]/booking/payment-result/page.tsx` (`h1` + `setRequestLocale`), `web/app/globals.css` (`.result-stalled`), `web/messages/{tr,en,de,ru}.json` (`pay.resultLoading`, `pay.resultStalled`), `web/e2e/payment-result.spec.ts` (yeni, 16 test), `scripts/ui-shots/web.js` (yeni ekran `payment-result`: yönlendirme hedefi tutulur).

## Uygulanamadı: neden

- iFrame içinde site üst/alt bilgisini gizlemek: ortak layout değişikliği (P3, yukarıda).
- Anında kullanıcı eylemi (Rezervasyonlarım bağlantısı hemen): otomatik geçişte 100 ms'lik yanıp sönmeyi önlemek için 8 sn gecikmeyle gösterilir.

## Doğrulama

- Kırmızı testler önce (`npx playwright test payment-result --project=desktop`): **11 başarısız, 5 geçti**. Başarısızlar: "shows a status message while redirecting" ve "translated" (`getByRole('status')` yok: bileşen `null`), iFrame testi (`status` yok), "slow redirect" (`.result-stalled` yok), "broken session storage" (sayfa `html#__next_error__`, `/tr/bookings` açılmadı), axe testi (`status` yok), 5 Almanca taşma testi (`status` yok). Geçenler (mevcut davranışı belgeleyen): "without pending booking it redirects to bookings", "with pending booking ok", "with pending booking fail", "unknown status counts as fail", "inside the provider iframe it breaks out…".
- Sonra: `npx playwright test payment-result --workers=1` (iki proje): **27 geçti, 5 atlandı** (taşma testleri yalnızca `desktop`'ta). `npx playwright test pay.spec --project=desktop --workers=1`: **19 geçti** (sahte sağlayıcı iFrame'inin gerçek `payment-result` dönüşü dahil). Not: dev sunucuda varsayılan çok işçili koşu yükten zaman aşımına düştü (bilinen, `acik_konular.md`); `--workers=1` ile temiz.
- `npx tsc --noEmit` temiz; `npx eslint` (üç dosya) 0; `impeccable detect` 0 (`[]`).
- `npm run build` başarılı (dev sunucu durduruldu, build, yeniden başlatıldı, 200).
- Ekran görüntüsü `node scripts/ui-shots/web.js --out after --only payment-result --locales tr,de`: 4 görüntü, taşma yok, konsol hatası yok, kaçan yok.

## Görüntüler

- Önce (boş içerik alanı): `screenshots/before/web/{tr,de}-{1440,390}-payment-result.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-payment-result.png`
