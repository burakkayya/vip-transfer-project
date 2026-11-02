# Web rezervasyon sihirbazı (`/book`): Impeccable geçişi (B-W2)

Tarih: 2026-11-02 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/axe/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass. Skill'in soru/karar adımları yerine görev brifi kullanıldı (alt ajan, kullanıcıya soru yolu yok).
Kapsam: araç, bilgiler, doğrulama kabuğu ve onay adımları; boş `/book` (rota formu). `OtpLogin` iç yapısı B-W3'tedir.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, 10 sezgisel, hepsi uygulanır) | **27/40 (%68, Acceptable)** | **35/40 (%88, Good)** |
| audit | **14/20 (Acceptable)** | **18/20 (Good)** |
| axe (wcag2a/2aa/21a/21aa/22aa; araç, bilgiler, doğrulama, onay; 1440 ve 390) | Araç adımı 0; bilgiler adımında `color-contrast` (`.field > .hint`, adım giriş animasyonu `opacity:0`'dan başladığı için yarı saydam metin) | **0** (dört adım, iki proje) |
| detector (`impeccable detect`, kaynak dosyalar) | 0 | 0 |
| detector (canlı `/tr/book?from=ayt&to=kemer`, 1440 ve 390) | 3 / 2: `undersized-ui-text` (logo alt yazısı ×2), `overused-font` (Inter) | Aynı (sihirbaza ait bulgu yok; ikisi de bilinçli, B-W0/B-W1 raporları) |
| lint (`BookingWizard`, `CountrySelect`, `AddressField`, `book/page.tsx`) | 2 hata (`label-has-associated-control`), 1 uyarı (`no-img-element`) | **0** |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not (sonra) |
|---|---|---|---|---|
| 1 | Sistem durumu | 2 | 4 | Adım göstergesi `ol[aria-label]` + `aria-current="step"`, tamamlanan adım "tamamlandı" diye okunur; adım sayısı yolda değişmez; fiyat yüklenirken canlı bölge, bitince "Fiyatlar hazır."; iskelet fiyatın yerini tutar |
| 2 | Gerçek dünya | 3 | 4 | "2 · 2" yerine "2 yolcu · 2 bagaj" (çoğul kuralıyla); "48 saate kadar" yerine "Alıştan 48 saat öncesine kadar"; onayda üç iptal kademesi |
| 3 | Kullanıcı kontrolü | 3 | 4 | Her adımın başlığında aynı yerde "Geri"; rota düzenlemesinden "Vazgeç, araçlara dön" |
| 4 | Tutarlılık | 2 | 4 | Tek doğrulama dili (tarayıcı balonu yerine yerel alan hataları); özet rayı DESIGN.md imzası (daire, kesikli hat, kare); her adımda tek birincil eylem |
| 5 | Hata önleme | 3 | 4 | Onay kutuları işaretsiz, ödeme ikisi işaretlenene kadar kapalı ve nedeni yanında yazılı; uçuş no ve ad gönderimde alanında denetlenir |
| 6 | Tanıma | 3 | 3 | Özet masaüstünde yapışkan; telefonda onay adımında araç ve tarih özeti kartın altında kalıyor |
| 7 | Esneklik | 3 | 3 | Oturumlu kullanıcı doğrulamayı atlar; ana sayfadan rota taşınır; klavyeyle tüm akış |
| 8 | Estetik ve sadelik | 3 | 3 | Telefonda dar adım çubuğu yalnızca etkin adın adını yazar; uygun olmayan araç kartı okunur kalır. Devre dışı ödeme düğmesi DESIGN.md gereği %35 soluk |
| 9 | Hata kurtarma | 2 | 3 | Alan hataları sorunu ve çözümü söyler, odak alana gider; fiyat ve araç listesi ağ hatasında "Tekrar dene"; adres aramasında "Tekrar dene". Rezervasyon oluşturma hatası hâlâ genel metin |
| 10 | Yardım | 3 | 3 | İpuçları alanlara bağlı (`aria-describedby`); iptal kademeleri onayda; yasal bağlantılar değişmedi |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | axe 0 (4 adım); odak adım değişince yeni başlığa gider; alan hataları `aria-invalid` + `aria-describedby`; gerekli onaylar `aria-required`, gruplu (`fieldset` + gizli `legend`); kapasite sayıları sözcükle okunur |
| Performans | 3 | 3 | Araç görselleri `next/image` (`sizes` 110/150 px); dört fiyat isteği paralel (değişmedi); adım animasyonu yalnızca `transform`/`opacity` |
| Tema | 3 | 3 | Yeni kurallar tokenlarla; koyu mod kapsam dışı |
| Duyarlılık | 3 | 4 | 360/390/768/1024/1440 Almanca (AYT → Datça) taşma ve kesilme yok, fiyatlar tek satır (test); telefonda tam genişlik birincil düğme, özet etiketleri değerin üstünde |
| Uygulama bütünlüğü | 3 | 4 | Lint 0; iç içe `.field`, `span[aria-label]` iskelet ve ölü `.dot`/`.route-line` işaretlemesi kalktı |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Adım değişince odak kayboluyordu: tıklanan araç kartı DOM'dan kalkınca odak `body`'ye düşüyor, ekran okuyucu yeni adımı duyurmuyordu (WCAG 2.4.3) | **Kapandı**: yeni adımın `h2`'si (`tabIndex=-1`) odak alır. Test: "wizard shows step progress to screen readers" |
| P1 | Adım göstergesi yardımcı teknolojiye kapalı (`aria-current` yok, liste adsız) ve doğrulamadan sonra 4 → 3 adıma düşüyordu | **Kapandı**: aşağıdaki karar; testler "wizard shows step progress…", "verify stays in the step indicator after phone verification" |
| P1 | Uçuş numarası hatası sayfanın üstündeki genel kutudaydı (telefonda görünmez), alana bağlı değildi | **Kapandı**: `#flight-error` + `aria-invalid` + `aria-describedby`, odak alana; değiştirince hata kalkar. Test: "invalid flight number shows field-level error" |
| P1 | Fiyat isteği ağ hatasında dört kart "uygun değil" görünüyordu, yeniden deneme yoktu; araç tipleri gelmezse adım boş kalıyordu (Review Focus 2) | **Kapandı**: `ErrorState` + "Tekrar dene" (fiyatlar ve araç tipleri), yükleniyor `LoadingState`. Test: "price request failure shows error with retry" |
| P2 | Ödeme düğmesi devre dışı, nedeni yazılmıyordu (DESIGN.md: "devre dışı nedenini metin söyler") | **Kapandı**: düğmenin yanında `#pay-hint` |
| P2 | Ad alanı tarayıcı doğrulama balonuyla (tarayıcı dilinde) denetleniyordu | **Kapandı**: `noValidate`, yerel `book.nameRequired`. Test: "empty passenger name shows localized field error" |
| P2 | İptal metni belirsiz ("48 saate kadar", "bis 48 Std."), onay adımında kademeler yoktu | **Kapandı**: `freeCancel` "alıştan 48 saat öncesine kadar" (4 dil); onayda `cancelTiers` (48 saat ve üzeri %100, 24-48 saat %50, 24 saatten az %0; K-14 ile birebir) |
| P2 | Kapasite hapları yalnızca sayı ("6 6"); özette "2 · 2" | **Kapandı**: `book.seats`/`bags` çoğul ICU (en, de, ru) |
| P2 | İskelet `span[aria-label]` (yükleme sırasında `aria-prohibited-attr`) | **Kapandı**: `aria-hidden` iskelet + `role="status"` metin |
| P2 | Hata kutusu `role` taşımıyordu ve her adımda sayfanın üstündeydi | **Kapandı**: `role="alert"`, eylem düğmesinin hemen üstünde |
| P2 | Telefonda onay adımında "Geri" tek başına satırda, ödeme düğmesi alt satırda | **Kapandı**: "Geri" her adımın başlık satırında (bağlantı düğmesi, RTL'de ok aynalanır); eylem satırında yalnızca birincil düğme, telefonda tam genişlik |
| P2 | Uygun olmayan araç kartı %45 opak: neden metni okunmuyordu | **Kapandı**: kart kireçtaşı zeminde okunur, yalnızca görsel soluk ve gri |
| P2 | `CountrySelect` iç içe `.field`, ipuçları alanlara bağlı değil | **Kapandı**: `CountrySelect` isteğe bağlı `hint` prop'u (`aria-describedby`); ad, uçuş, not ipuçları bağlı |
| P2 | Özet rayı düz çizgi (DESIGN.md imzası kesikli) | **Kapandı** |
| P2 | Adres araması API hatasında yeniden deneme yok (B-W1'den devir) | **Kapandı**: `AddressField` "Tekrar dene". Test: "address search failure offers retry" |
| P2 | Özet kartında Almanca uzun etiket değeri sıkıştırıyordu ("2 / Gepäckstücke" üç satır) | **Kapandı**: özet etiketleri değerin üstünde |
| P2 | Telefonda onay adımında araç/tarih özeti formun altında kalıyor | Açık (P2; onay kartına ikinci bir özet eklemek kopya olur; sticky alt çubuk ödeme adımıyla B-W4'te değerlendirilebilir) |
| P2 | Rezervasyon oluşturma hatasında (`me/bookings`) yalnızca `price_changed` ve 401 özel; diğerleri genel metin | Açık (P2; backend hata kodları kapsamı, B-W4 ödeme ile) |
| P3 | Adım değişiminde kaydırma `smooth` hareket azaltmayı yok sayıyordu | **Kapandı** |
| P3 | Fiyatlar tabular değildi, dar ekranda satır kırılabilirdi | **Kapandı**: `.wizard .price` `nowrap` + `tabular-nums` (Review Focus 3 testi) |
| P3 | Rota düzenlemesinden geri dönüş yoktu | **Kapandı**: "Vazgeç, araçlara dön" |
| P3 | Boş `/book` yönlendirmesiz (onboard) | **Kapandı**: kısa giriş cümlesi (sabit fiyat hemen, ödeme son adım; mevcut gerçek özellikler) |
| P3 | Oturum durumu bilinmeden (ilk ~100 ms) oturumlu kullanıcı 4 adım görür, sonra 3 | Açık (bilinçli; ilk ziyaretçi çoğunlukla oturumsuz) |

### Adım göstergesi kararı (clarify)

Akışın dört durumu var (araç → bilgiler → doğrulama → onay). Seçilen: **gösterge kullanıcının gerçekten geçeceği adımları gösterir ve yolda değişmez.** Oturumsuz kullanıcı baştan dört adım görür ("Doğrulama" dahil); telefon doğrulandıktan sonra da dört adım kalır (doğrulama "tamamlandı"). Sihirbaza oturumla gelen kullanıcı doğrulamayı hiç görmediği için üç adım görür. Doğrulamayı "Bilgiler"in alt adımı yapmak reddedildi: SMS kodu ayrı bir bekleme ve ayrı bir cihaz eylemidir; yorgun yolcuya "bir adım daha var" bilgisi baştan verilmeli (PRODUCT.md ilke 2). Eski davranış, doğrulamadan hemen sonra göstergeyi 4'ten 3'e düşürüyordu (onay "3/3" görünüyordu).

## Yapılanlar (Impeccable adımları)

- **harden**: alan düzeyi doğrulama (ad, uçuş, dönüş uçuşu) ve ilk hatalı alana odak; fiyat ve araç tipi isteklerinde yükleniyor/hata/yeniden dene; adres aramasında yeniden dene; hata kutusu `role="alert"`; `₺` büyük tutar (AYT → Datça) ve `€` tek satır; mantıksal özellikler (`inset-inline-start`, RTL'de geri oku `[dir="rtl"]` ile).
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca taşma testi (araç ve bilgiler adımları); ≤480 px adım çubuğunda yalnızca etkin adın adı görünür (Rusça "Подтверждение" 4 sütunda sığmıyordu; diğer adlar ekran okuyucuda kalır); telefonda birincil düğme tam genişlik; özet etiketleri üstte.
- **clarify** (tr, en, de, ru): yeni `book.progress`, `stepDone`, `pricesReady`, `nameRequired`, `flightInvalid`, `startLead`, `cancelEdit`, `cancelTiers`, `consentsLegend`, `payHint`; `seats`/`bags` çoğul; `freeCancel` alıştan önceki 48 saat; kullanılmayan `select`, `selected`, `route` silindi. `book` 57 anahtar, dört dilde eşit. Onay metinleri (`acceptDisclosure`, `acceptDistanceSales`, `acceptMarketing`) ve yasal bağlantı hedefleri değişmedi.
- **optimize**: `<img>` → `next/image` (`sizes`); iskelet ve sonsuz parıltı yalnızca yüklenirken; gereksiz `"use client"` yok (sihirbaz durumludur).
- **onboard** (ilk rezervasyon): boş `/book`'ta tek cümlelik yönlendirme; ilk adımda "toplam" etiketi ve özetteki üç güvence (sabit fiyat, iptal, güvenli ödeme) korunur. Yeni iddia yok.
- **animate**: adım paneli yerine 0,32 sn kayarak oturur (`transform` + `opacity`, `--ease`); yalnızca `prefers-reduced-motion: no-preference` içinde (önceden her durumda 0,5 sn, `opacity:0`'dan başlıyordu ve axe kontrast ihlali üretiyordu). Test: "reduced motion: step panel is shown without animation".
- **polish**: onay kutuları `fieldset`; seçenek kartı (`Hemen al`) `div > input + label[for]`; fiyat tabular; güven listesi ikonu çok satırda üst hizalı.

## Değişen dosyalar

`web/components/BookingWizard.tsx`, `web/components/CountrySelect.tsx` (isteğe bağlı `hint`), `web/components/AddressField.tsx` (arama yeniden dene), `web/app/globals.css` (sihirbaz, `.option-card`, `.check` çevresi, `.sr-only`, özet), `web/app/home.css` (sihirbaz bloğu: adım animasyonu hareket tercihine bağlı, kapasite hapı), `web/messages/{tr,en,de,ru}.json` (`book`), `web/e2e/book.spec.ts` (yeni), `web/next.config.ts` (`devIndicators: false`, yalnızca `next dev`), `scripts/ui-shots/web.js` + `README.md` (`--only` akışı son istenen ekranda durur: onaydan sonra rezervasyon/ödeme yok). `web/app/[locale]/book/page.tsx` incelendi, değişiklik gerekmedi.

## Uygulanamadı: neden

- Brifteki kırmızı test "`TK12` → hata": `TK12` geçerli IATA biçimidir (havayolu kodu + 1-4 hane; TK1 gerçek sefer). Geçerli numarayı reddetmek yerine test gerçekten geçersiz girişlerle (`TK-12`, `TK`) yazıldı ve `TK12`'nin kabul edildiğini de doğrular.
- `OtpLogin` içindeki hata ve `autoFocus`: B-W3.
- Tam iade garantisi seçeneği: K-15 gereği gizli (yalnızca `guarantee_available` ise çizilir; backend kapalı).

## Doğrulama

- Kırmızı testler önce: `npx playwright test book --project=desktop --workers=1` → **12 başarısız, 6 geçti** (axe `color-contrast` bilgiler adımında; `form.wizard-step` yok; `fontVariantNumeric` `tabular-nums` değil; `Rezervasyon adımları` listesi yok; `.wizard-start` yok; yeniden dene düğmeleri yok; "6 yolcu" metni yok; geçenler 5 genişlik taşma testi ve Esc).
- Sonra: `npx playwright test book shared home --workers=1` → **66 geçti, 10 atlandı** (genişlik testleri yalnızca `desktop` projesinde). `book.spec.ts` 18 test (13 × 2 proje + 5 genişlik).
- `npx tsc --noEmit` temiz; `npx eslint` değişen dosyalarda 0, web genelinde 1 hata (`OtpLogin.tsx`, B-W3); `npm run build` başarılı (`/[locale]/book` 7,65 kB, ilk yük 138 kB); dev sunucu yeniden başlatıldı, 200.
- Ekran görüntüsü betiği `--only book-empty,book-1-vehicle,book-2-details,book-5-confirm,home`: 20 görüntü, yatay taşma 0, eksik 0; konsol hatası yalnızca oturumsuz `auth/me` 401 (beklenen). Akış onay adımında durdu (rezervasyon oluşturulmadı).

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-book-{empty,1-vehicle,2-details,3-verify,4-otp,5-confirm}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-book-{empty,1-vehicle,2-details,5-confirm}.png`. Ana sayfa sonrası görüntüleri (`*-home.png`, 1440 ve 390) Next geliştirme göstergesi ("N" dairesi) olmadan yeniden çekildi.
