# Web SMS doğrulama (`OtpLogin`, `RequireLogin`): Impeccable geçişi (B-W3)

Tarih: 2026-11-02 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/axe/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass. Skill'in soru/karar adımları yerine görev brifi ve kontrolcü kararları kullanıldı.
Kapsam: `/book` "Doğrulama" adımı ve `RequireLogin` ile sarılan `/account`, `/data-request`, `/bookings/[code]`, `/bookings/[code]/pay` girişleri. Bileşen iki adımlıdır: telefon → SMS kodu.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, 10 sezgisel, hepsi uygulanır) | **26/40 (%65, Acceptable)** | **36/40 (%90, Excellent)** |
| audit | **14/20 (Good)** | **19/20 (Excellent)** |
| axe (wcag2a/2aa/21a/21aa/22aa; telefon, kod, yanlış kod; 1440 ve 390) | 0 (otomatik kurallar; sorunlar kural dışı: duyurulmayan hata, adda ülke kodu yok) | **0** |
| detector (`impeccable detect`, `OtpLogin.tsx`, `RequireLogin.tsx`) | 0 | 0 |
| lint (`OtpLogin`, `RequireLogin`, `otp.spec.ts`) | 1 hata (`jsx-a11y/no-autofocus`) | **0** (web geneli 0) |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not (sonra) |
|---|---|---|---|---|
| 1 | Sistem durumu | 2 | 4 | Düğmeler meşgulken "Gönderiliyor…" / "Doğrulanıyor…"; gönderim satırı `role="status"`, tekrar gönderince "Yeni kodu … numarasına gönderdik." duyurulur; tekrar gönder bekleme süresini sayar |
| 2 | Gerçek dünya | 3 | 4 | Numara okunur biçimde ("+90 5551234567", kalın, `bdi dir=ltr`); ipucu "Ülke kodu olmadan yazın." |
| 3 | Kullanıcı kontrolü | 3 | 4 | "Numarayı değiştir" yazılan numarayı korur, odak telefon alanına döner |
| 4 | Tutarlılık | 2 | 4 | B-W2 ile aynı alan hatası dili (`aria-invalid`, `aria-describedby`, odak); devre dışı düğme yerine gönderimde denetim; geliştirme kutusu yalnızca kehribar |
| 5 | Hata önleme | 2 | 4 | Alanın başında seçili ülke kodu görünür; "+90 …" veya "0090 …" yazılırsa kod ikinci kez eklenmez; tekrar gönder 45 sn bekler (saatlik 5 kod sınırını tüketmez) |
| 6 | Tanıma | 3 | 3 | Kod adımında numara görünür; ülke yalnızca telefon adımında değiştirilebilir |
| 7 | Esneklik | 3 | 3 | `one-time-code` otomatik doldurma, uluslararası yazım kabul; kod tamamlanınca kendiliğinden gönderilmez (bilinçli) |
| 8 | Estetik ve sadelik | 3 | 3 | Tek birincil eylem, ikincil bağlantılar alt satırda; geniş ekranda kod alanı solda dar kalır (Operate için kabul) |
| 9 | Hata kurtarma | 2 | 4 | Yanlış kod alana bağlı (`#otp-error`, `role="alert"`), odak alana döner ve kod seçilir; ağ hatasında aynı düğme yeniden dener |
| 10 | Yardım | 3 | 3 | İpucu alana bağlı; "SMS gelmedi" yardımı ve kod geçerlilik süresi yok (P3) |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | Telefon alanının adı "Telefon numarası +90" (`aria-labelledby`), açıklaması ipucu; hatalar duyurulur ve alana bağlı; odak kullanıcı eyleminden sonra programla verilir (`autoFocus` yok); axe 0 |
| Performans | 3 | 4 | Sayaç yalnızca bekleme sürerken saniyede bir; `RequireLogin` oturum denetlenirken boş ekran yerine `LoadingState` |
| Tema | 3 | 3 | Yalnızca tokenlar (`--warn`, `--warn-soft`, `--soft-2`, `--danger`); satır içi stil kalktı; koyu mod kapsam dışı |
| Duyarlılık | 3 | 4 | 360/390/768/1024/1440 Almanca taşma ve kesilme yok (test); bağlantı düğmeleri 44 px yükseklik, uzun metin satır kırar; telefonda birincil düğme tam genişlik |
| Uygulama bütünlüğü | 3 | 4 | Lint 0, detector 0; mantıksal özellikler (`max-inline-size`, `padding-inline-start`, `min-block-size`) |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Hatalar (yanlış kod, ağ, 429) `p.alert` içinde, `role` yok: ekran okuyucu duyurmuyor; yanlış kod alana bağlı değil (WCAG 4.1.3, 3.3.1) | **Kapandı**: kod hatası `#otp-error` (`role="alert"`) + `aria-invalid` + `aria-describedby`, odak alana; sunucu/ağ hatası `role="alert"`. Test: "wrong code shows error and keeps phone", "send code network failure shows alert and retry works" |
| P1 | Telefon alanının adı ülke kodunu söylemiyor, ipucu bağlı değil; alan "+90 532…" yazanı "+9090532…" gönderiyordu (WCAG 1.3.1, 3.3.2) | **Kapandı**: görünür `.phone-dial` ön eki adın parçası ("Telefon numarası +90"), ipucu `aria-describedby`; "+" / "00" ile başlayan numara olduğu gibi kullanılır. Test: "phone input announces dial code", "number typed with country code is not prefixed twice" |
| P1 | "Kodu tekrar gönder" sessiz ve sınırsız: yeni kod gittiği belli değil, art arda basınca saatlik 5 kod sınırı dolup kullanıcı gelir akışından kilitleniyor | **Kapandı**: her gönderimden sonra 45 sn bekleme (mobil girişle aynı değer), düğme adı "45 sn sonra tekrar gönderebilirsiniz", sonra "Yeni kodu … gönderdik." duyurusu. Test: "resend is rate-limited visually" (`page.clock` ile ileri sarılır) |
| P2 | `autoFocus` (lint hatası); "Numarayı değiştir" sonrası odak `body`'ye düşüyordu | **Kapandı**: odak yalnızca kullanıcı eyleminden sonra ref ile (kod adımına geçince kod alanı, geri dönünce telefon alanı) |
| P2 | "Kod gönder" ve "Doğrula" nedeni yazılmadan devre dışı (DESIGN.md: neden metinle söylenir), meşgul metni yok | **Kapandı**: düğmeler yalnızca istek sürerken kapalı ve "Gönderiliyor…/Doğrulanıyor…" yazar; kısa numara/kod gönderimde alan hatası verir ("Telefon numarasını kontrol edin.", "SMS ile gelen kodu yazın."). Test: "too short phone number shows field error instead of a silent disabled button" |
| P2 | `RequireLogin` oturum denetlenirken `null` (boş ekran; Review Focus 2) | **Kapandı**: `LoadingState` ("Oturum denetleniyor…") |
| P2 | Geliştirme kodu kutusu pirinç kesikli kenarlı (brif: yalnızca `amber-soft`) | **Kapandı**: zemin `--warn-soft`, kenar `--warn` karışımı, metin `--warn`; 44 px; yalnızca API `dev_code` döndürdüğünde (üretimde backend `None` döndürür) |
| P2 | Kodun gönderildiği numara ham E.164 | **Kapandı**: "+90 5551234567", kalın, `bdi dir="ltr"` (RTL'de ters dönmez) |
| P2 | 429 mesajı ne zaman tekrar denenebileceğini söylemiyor | Açık (backend `Retry-After`/kalan süre döndürmüyor; backend değişikliği kapsam dışı) |
| P3 | Kod alanı harf aralığı yüzünden ortadan sola kayık | **Kapandı**: `padding-inline-start` harf aralığı kadar artırıldı; rakamlar tabular |
| P3 | Üç eylem tek satırda, bağlantı düğmeleri ~22 px yüksek | **Kapandı**: birincil "Doğrula" tek başına; bağlantılar alt satırda 44 px |
| P3 | `RequireLogin` satır içi `style={{ maxWidth: 560 }}` | **Kapandı**: `.login-card` (`max-inline-size`) |
| P3 | Kodun geçerlilik süresi (API `expires_in`, 5 dk) ve "SMS gelmedi" yardımı gösterilmiyor | Açık (P3) |

### Kararlar (görev içi)

- **Tekrar gönder beklemesi 45 sn** (K-41): kontrolcü kararı "görsel bekleme yeterli, API'nin döndürdüğünün ötesinde iş kuralı ekleme". Değer mobil girişteki `RESEND_SECONDS = 45` ile aynıdır; bekleme ilk gönderimden itibaren başlar (mobil gibi). Gerçek sınır backend'in saatlik 5 kod sınırıdır; 429 gelirse mesajı gösterilir, bekleme yeniden başlamaz.
- **Ülke kodunun duyurulması**: kontrolcü kararı "telefon alanının erişilebilir adı seçili ülke kodunu içerir". Görünür ön ek (`#otp-dial`) ve etiket `aria-labelledby` ile birleşir; ülke değişince ad değişir.
- **Ön ekli yazım**: alana "+" veya "00" ile başlayan numara yazılırsa seçili ülke kodu eklenmez (backend `normalize_phone` ile aynı yorum). Ülke seçimi müşteri ülkesi olarak (`country_code`) gönderilmeye devam eder.
- **Geliştirme kodu kutusu**: görünürlüğü istemcide `NODE_ENV` ile değil API'nin `dev_code` alanıyla belirlenir (backend yalnızca üretim dışı + konsol SMS'te doldurur). Böylece `npm run start` ile çalışan e2e ve ekran görüntüsü betikleri bozulmaz.
- Kırmızı testteki duyuru metni "Yeni kod gönderildi" yerine "Yeni kodu" ile süzülür: son metin "Yeni kodu +90 … numarasına gönderdik." (clarify, numara cümlenin içinde).

## Yapılanlar (Impeccable adımları)

- **harden**: yanlış kod, ağ hatası (`page.route` abort testi), 429 ve kısa numara/kod durumları; meşgul metni; `RequireLogin` yükleniyor; RTL için numara ve kod alanları `dir="ltr"`, numara `bdi`; mantıksal özellikler.
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca, telefon ve kod adımı (test); ≤720 px birincil düğme tam genişlik; bağlantı düğmeleri satır kırar.
- **clarify** (tr, en, de, ru): `phoneHint` "Ülke kodu olmadan yazın…", `codeSent` "Kodu {numara} numarasına gönderdik." (numara etiketli), yeni `sending`, `resent`, `codeRequired`, `verifying`, `resendIn`, `checking`. `otp` 15 anahtar, dört dilde eşit. Yasal metne dokunulmadı.
- **optimize**: iki bileşen de durumlu, `"use client"` gerekli; sayaç yalnızca bekleme sürerken çalışır. Görsel yok.
- **animate / delight**: eklenmedi (Operate; tek bekleme sayacı yeterli geri bildirim). Hareket yok, `prefers-reduced-motion` etkilenmez.
- **polish**: geliştirme kutusu kehribar, ön ek kutusu `--soft-2`, hatalı alan kenarı odak dışında kırmızı, kod alanı ortalı.

## Değişen dosyalar

`web/components/OtpLogin.tsx`, `web/components/RequireLogin.tsx`, `web/app/globals.css` (`.dev-hint`, SMS doğrulama bloğu, ≤720 px `.otp-actions`), `web/messages/{tr,en,de,ru}.json` (`otp`), `web/e2e/otp.spec.ts` (yeni), `docs/ui-review/lint-taban.md`.

## Uygulanamadı: neden

- 429 için kalan süre: backend `Retry-After` döndürmüyor; backend değişikliği kapsam dışı (BLOCKED gerektirmiyor, açık P2).
- Kod geçerlilik süresi: API `expires_in` döndürüyor; eklemek metin ve sayaç demek, bu görevde P3 olarak bırakıldı.

## Doğrulama

- Kırmızı testler önce (`npx playwright test otp --project=desktop --workers=1`): **6 başarısız, 6 geçti**. Başarısızlar: "wrong code…" (`.otp [role=alert]` yok), "resend is rate-limited visually" (`button.otp-resend` yok), "phone input announces dial code" (beklenen `/Telefon numarası.*\+90/`, gelen `"Telefon numarası"`), "number typed with country code…" (`.otp-sent` yok), "too short phone number…" (düğme `disabled`), "send code network failure…" (yalnızca Next rota duyurucusu `role=alert`). Geçenler: axe testi (otomatik kurallar zaten 0) ve beş genişlik testi. Testte `getByRole("alert")` Next'in `#__next-route-announcer__` öğesini de bulduğu için tüm seçiciler `.otp` içine daraltıldı.
- Sonra: `npx playwright test otp --project=desktop --workers=1` → **12 geçti**. Tüm web e2e (`npx playwright test --workers=2`, iki proje): **90 geçti, 16 atlandı** (genişlik testleri yalnızca `desktop`), `book.spec.ts` dahil.
- `npx tsc --noEmit` temiz; `npx eslint .` (web) 0; `impeccable detect` 0; `npm run build` başarılı (dev sunucu durduruldu, build, yeniden başlatıldı, 200).
- Ekran görüntüsü betiği `--only account-anon,data-request-anon,book-3-verify,book-4-otp` (tr, de × 1440, 390): 16 görüntü; `tr-1440-data-request-anon` ilk turda soğuk derleme zaman aşımı, tek başına yeniden çekildi. Konsol hatası yalnızca oturumsuz `auth/me` 401 (beklenen). Akış OTP ekranında durdu.

## Düzeltme turu 1 (inceleme küçükleri)

| İnceleme bulgusu | Durum |
|---|---|
| 1. "+49…" TR seçiliyken `country_code: TR` gidiyordu (para birimi TRY) | **Kapandı**: uluslararası yazımın kodu listedeki ülkeyle eşlenir (en uzun kod; +7 gibi ortak kodda seçili ülke korunur), seçim o ülkeye döner ve `country_code` o ülkedir. Listede olmayan kod → alan hatası `otp.unknownCountry` (4 dil). Yeni ülke eklenmedi |
| 2. `toE164` birim testi yok | **Kapandı**: işlev `web/lib/phone.ts`'e taşındı; `web/e2e/phone.spec.ts` 17 durum + `displayPhone` (ağsız Playwright testi, yalnızca desktop projesi; web'de ayrı birim test koşucusu yok) |
| 3. "(+90) 532…" ve "90 532…" çift ön ek | **Kapandı**: biçim karakterleri "+"/"00" denetiminden önce atılır; seçili kod tekrar yazılmışsa ve kalan kısım ≥ 10 haneyse eklenmez (KZ "7172 12345" gibi kısa ulusal numara etkilenmez); ulusal önek 0 atılmaya devam eder |
| 4. İkinci tekrar gönderimde canlı bölge aynı metin, duyuru yok | **Kapandı**: duyuru ayrı `sr-only` `role="status"` bölgesinde (her zaman DOM'da); her tekrar gönderimde boşaltılır, 150 ms sonra yeniden yazılır. Görünür gönderim satırı canlı bölge değil |
| 5. Arka plan sekmesinde sayaç gecikmesi | **Kapandı**: kalan süre zaten bitiş anından (`Date.now`) hesaplanıyordu (adım sayılmıyordu); `visibilitychange` ile sekme dönünce hemen yeniden hesaplanır. Test: saat 30 sn atlatılınca ad doğrudan "1x sn" olur |
| 6. 45 sn kararı `kararlar.md`'de yok | **Kapandı**: K-41 |
| 7. `BookingsHome` boş döner, satır içi `maxWidth` | Kapsam dışı (B-W6) |
| 8. 429 gösterimi testi yok | **Kapandı**: gönderimde ve tekrar gönderimde `page.route` ile 429 → `role="alert"` "Çok fazla deneme yapıldı…", numara korunur, başarısız istek beklemeyi başlatmaz |
| 5 (inceleme). `RequireLogin` oturumlu kullanıcıya kısa iskelet | Kabul edildi (boş ekrandan iyi; gecikmeli gösterim B-W6/B-W9 sırasında değerlendirilebilir) |

Ek: axe testine `test.setTimeout(90_000)` (üç tarama + geliştirme sunucusunda ilk derleme 30 sn sınırını aşabiliyordu).

Doğrulama: `npx playwright test otp book phone --workers=2` → **81 geçti, 29 atlandı** (genişlik ve saf işlev testleri yalnızca desktop). `npx tsc --noEmit` temiz, `npx eslint .` (web) 0.

Değişen dosyalar: `web/lib/phone.ts` (yeni), `web/components/OtpLogin.tsx`, `web/messages/{tr,en,de,ru}.json` (`otp.unknownCountry`; `otp` 16 anahtar), `web/e2e/otp.spec.ts`, `web/e2e/phone.spec.ts` (yeni), `docs/kararlar.md` (K-41), `docs/proje_rehberi.md`, `docs/test_senaryolari.md`, `docs/degisiklik_gunlugu.md`.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{book-3-verify,book-4-otp,account-anon,data-request-anon}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{book-3-verify,book-4-otp,account-anon,data-request-anon}.png`
