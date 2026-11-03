# Web rezervasyon detayı ve iptal (`/bookings/[code]`, `BookingDetail`): Impeccable geçişi (B-W6)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/axe/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları **in-thread pass**. Skill'in soru/karar adımları yerine görev brifi ve kontrolcü kararları kullanıldı (soru sorulmadı).
Kapsam: gelir akışının son ekranı. Sayfa `RequireLogin` ile sarılıdır (oturum denetlenirken "Oturum denetleniyor…"). Ödeme dönüşü sözleşmesi (B-W4: `router.replace('/bookings/<kod>?paid=1')` → "Rezervasyonunuz onaylandı") korundu. İade oranı ve tutarı API'nin önizlemesinden (`GET me/bookings/<kod>/cancellation`) gelir, istemcide hesaplanmaz. Backend değişikliği yok. Yan bulgu: `BookingsHome` (Rezervasyonlarım) oturum denetlenirken `null` dönüyordu ve satır içi `maxWidth: 560` taşıyordu.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, 10 sezgisel, hepsi uygulanır) | **19/40 (%48, Poor)** | **36/40 (%90, Excellent)** |
| audit | **12/20 (Acceptable)** | **18/20 (Excellent)** |
| axe (wcag2a/2aa/21a/21aa/22aa) | 0 (sorunlar otomatik kural dışı: odak kaybı, duyurulmayan sonuç, simge-yalnız `dt`) | **0** (ödenmiş + `?paid=1` + iptal paneli açık; canlı takip "konum güncellenemiyor") |
| detector (`impeccable detect`, `BookingDetail.tsx`, `BookingNotFound.tsx`, `BookingsHome.tsx`, `[code]/page.tsx`, `[code]/not-found.tsx`) | 0 | 0 |
| lint (ekranın dosyaları + `booking-detail.spec.ts`) | 0 | **0** |

Gelir akışı eşiği %85: sonra **%90**.

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not (sonra) |
|---|---|---|---|---|
| 1 | Sistem durumu | 1 | 4 | Yüklenirken `LoadingState` "Rezervasyon bilgileri yükleniyor…" (önce boş); iade bilgisi alınırken düğme "İade bilgisi alınıyor…", iptal sürerken "İptal ediliyor…"; sonuç `role="status"`. Canlı takip yalnızca taze konumda "canlı"; 3 aralıktan uzun güncelleme yoksa kehribar "Konum güncellenemiyor" + son güncelleme saati (K-44) |
| 2 | Gerçek dünya | 2 | 4 | Türkçe yüzde biçimi "%100" (önce "100%"); "İade tutarı" ayrı satırda, büyük ve tabular; tarih/saat Türkiye saatiyle |
| 3 | Kullanıcı kontrolü | 2 | 4 | "Vazgeç" çerçeveli, onay düğmesiyle aynı boyut ve belirginlikte (önce soluk kireçtaşı); kapatınca odak "Rezervasyonu iptal et"e döner; bulunamadıda "Rezervasyonlarım" ve "Yeni rezervasyon" |
| 4 | Tutarlılık | 2 | 4 | Ödeme ekranıyla aynı `LoadingState`/`ErrorState`, 401 → `useSessionExpired()`, `aria-disabled` + kilit deseni; başlık hiyerarşisi `h1` → `h2` (önce `h1` → `h3`); satır içi stil yok |
| 5 | Hata önleme | 2 | 4 | Onay adımında iade tutarı + K-14 kademeleri + politika bağlantısı; çift tıklama tek iptal isteği; 409 `not_cancellable` duyurulur ve rezervasyon yeniden okunur |
| 6 | Tanıma | 2 | 4 | Bilgi satırlarında yazılı etiketler (Adres, Uçuş, Yolcu, Not, Rezervasyon tarihi; önce yalnızca simge ve "✎"); tutar "Toplam tutar" etiketli |
| 7 | Esneklik | 2 | 3 | Klavyeyle tüm akış (odak yönetimi); e-posta artık `mailto:` bağlantısı. Rezervasyon durumu kendiliğinden yenilenmiyor (P3) |
| 8 | Estetik ve sadelik | 3 | 3 | Telefonda zaman çizelgesi dikey (önce Almanca etiketler üst üste biniyordu, 0.66rem); başlık kartında rozet ve tutar tek satır. Kart sayısı aynı (4–5) |
| 9 | Hata kurtarma | 1 | 4 | Ağ hatasında `ErrorState` + "Tekrar dene" (yükleme ve iade önizlemesi), 404/403'te son hata + çıkış bağlantıları, 401'de giriş, 409'da açıklama |
| 10 | Yardım | 2 | 2 | Değişiklik notu ve politika bağlantısı var; iade süresi/yöntemi bilgisi (yasal metinde var) panelde tekrar edilmedi (P3) |
| **Toplam** | | **19/40** | **36/40** | |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | Odak yönetimi (panel başlığı, geri dönüş, sonuç), `role="status"`/`role="alert"`, `aria-current="step"`, yazılı `dt` etiketleri, yeni sekme bağlantısında ekran okuyucu notu, nabız hareket tercihine bağlı; axe 0 |
| Performans | 3 | 3 | 5 sn yoklama yalnızca izlenebilir bacakta (değişmedi; sekme gizliyken de sürer, P3); yeni ağ çağrısı yok |
| Tema | 3 | 4 | Yalnızca tokenlar; nabız ve çizelge gölgesindeki `rgba` sabitleri `color-mix(var(--ok)…)`/`var(--ink)` oldu; yeni `.btn.outline` ve `.btn.danger` üzerine gelme rengi (önceden siyaha dönüyordu) |
| Duyarlılık | 2 | 4 | 360/390/768/1024/1440 px Almanca + 120 karakter ad/adres/not + `12.345,00 ₺`: taşma ve kesilme yok (test); dar ekranda dikey çizelge, tam genişlik eylemler |
| Uygulama bütünlüğü | 2 | 3 | Unicode "✎" simgesi, satır içi stiller, yutulmuş yoklama hataları ve iptalden sonra kalan "onaylandı" kutusu kalktı. Rezervasyon durumunun kendiliğinden yenilenmemesi açık (P3) |
| **Toplam** | **12/20** | **18/20** | |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Rezervasyon yüklenirken bileşen `null` dönüyor: boş ekran (Review Focus 2) | **Kapandı**: `LoadingState` "Rezervasyon bilgileri yükleniyor…". Test "detail shows LoadingState then content" |
| P1 | Yükleme hatasında yalnızca düz metin, yeniden deneme yok; 401 ele alınmıyor; iade önizlemesi hatası kurtarmasız | **Kapandı**: ağ hatasında `ErrorState` + "Tekrar dene"; 404/403'te `BookingNotFound` (yeniden deneme yok, "Rezervasyonlarım"/"Yeni rezervasyon"); 401 → `useSessionExpired()`; önizleme hatasında `ErrorState` + "Tekrar dene". Testler "network error shows ErrorState with retry", "unknown booking from the API…", "401 while loading…", "refund preview failure shows retry" |
| P1 | Canlı takip yoklama hatalarını yutuyor; eski konum "Canlı takip" yeşil kutusunda canlıymış gibi kalıyor | **Kapandı** (K-44): 3 aralıktan (15 sn) uzun başarılı güncelleme yoksa veya sunucu konum döndürmezse kehribar "Konum güncellenemiyor", son güncelleme saati yerinde, "Son bilinen konumu haritada aç", nabız yok, "Yenile"; konum gelince canlıya döner. ETA yok. Test "live tracking turns non-live after 3 failed polls…" (`page.clock`) |
| P1 | İptal akışında odak kaybı: "Rezervasyonu iptal et" kaybolunca odak `body`'ye düşüyor; "Vazgeç" ve onay sonrası da; sonuç duyurulmuyor (WCAG 2.4.3, 4.1.3) | **Kapandı**: panel açılınca odak panel başlığına, "Vazgeç"te açan düğmeye, iptal sonrası `role="status"` sonuca; istek sürerken `disabled` yerine `aria-disabled` (odak düşmez). Testler "cancel confirm is reachable by keyboard and announces result", "keep closes the panel and returns focus…" |
| P1 | Türkçe iade metni "100% iade" (K-14 metinleriyle uyumsuz biçim) | **Kapandı**: "Şimdi iptal ederseniz iade oranı %100."; kademeler `book.cancelTiers` metniyle birebir panelde + "İptal ve iade politikası" bağlantısı. Test "cancel preview states K-14 refund for >48h" |
| P1 | "Vazgeç" soluk kireçtaşı düğme (sınır kontrastı ~1,1:1), kırmızı onay düğmesinin yanında eşit görünür değil (kontrolcü kararı) | **Kapandı**: `.btn.outline` (kâğıt zemin, lake siyah 1 px kenar ve metin), aynı yükseklik, yazı boyutu ve ağırlık; test kenarın kart zeminine ≥ 3:1 ve metnin ≥ 4,5:1 olduğunu ölçer |
| P1 | Canlı nokta nabzı `prefers-reduced-motion`'a bağlı değil (küresel kural) | **Kapandı**: nabız yalnızca `no-preference` altında. Test "live dot does not pulse with reduced motion" |
| P1 | Telefonda (390 px) Almanca zaman çizelgesi etiketleri üst üste biniyor ("zugeteiltunterwegsangekommenbegonnen"), 0.66rem (10,6 px) | **Kapandı**: 720 px altında dikey çizelge, 0.86rem; geniş ekranda `min-width: 0` + heceleme. Test "de detail has no horizontal overflow from 360 to 1440 px" |
| P2 | `?paid=1` ile gelinip iptal edilince "Rezervasyonunuz onaylandı" kutusu "İptal edildi" ile yan yana kalıyor | **Kapandı**: kutu yalnızca ödenmiş durumda ve iptalden önce. Test (klavye testi içinde) |
| P2 | Çift tıklama iki iptal isteği gönderebilir (yalnızca durum bayrağı) | **Kapandı**: `useRef` kilidi. Test "double click on confirm cancels only once" |
| P2 | 409 `not_cancellable` sessiz kalıyor, rezervasyon güncellenmiyor | **Kapandı**: `role="alert"` "Bu rezervasyon artık iptal edilemez.", panel kapanır, rezervasyon yeniden okunur, odak uyarıya. Test "not cancellable conflict…" |
| P2 | Geçersiz kod (`/tr/bookings/ZZZZZZ`) genel 404 ("Aradığınız sayfa bulunamadı") gösteriyor | **Kapandı**: segment `not-found.tsx` → "Rezervasyon bulunamadı" + "Bu koda ait rezervasyon bulunamadı." + kod biçimi ipucu + çıkışlar; durum 404 kalır. Test "not-found code shows localized error" (tr ve en) |
| P2 | Simge-yalnız `dt` (adres, oluşturulma) ve Unicode "✎" simgesi; başlık atlaması `h1` → `h3` | **Kapandı**: yazılı etiketler, "list" simgesi, bacak başlıkları `h2` |
| P2 | Satır içi stiller (`textAlign: right` mantıksal değil, `marginTop`, `margin: 0`) | **Kapandı**: CSS, `text-align: end`, mantıksal özellikler |
| P2 | `BookingsHome` oturum denetlenirken `null`; satır içi `maxWidth: 560`, `flex`, `alignSelf`, `fontSize` (yan bulgu) | **Kapandı**: `LoadingState` "Oturum denetleniyor…" (RequireLogin ile aynı), `.login-card`, `.lookup-form`, `.booking-row .price` (tabular, tek satır). Test "bookings page shows loading state while the session is checked" |
| P3 | `.btn.danger` üzerine gelince siyaha dönüyordu (genel `.btn:hover` daha özgül) | **Kapandı**: `.btn.danger:hover` kırmızının koyusu |
| P3 | E-posta düz metin; harita bağlantısı yeni sekmede açıldığını söylemiyor | **Kapandı**: `mailto:` bağlantısı; "(yeni sekmede açılır)" ekran okuyucu notu |
| P3 | Sayfa rezervasyon durumunu kendiliğinden yenilemiyor (sürücü yola çıkınca/yolculuk bitince sayfa yenilenmeli) | Açık (`acik_konular.md`): yoklama genişletmesi ayrı karar; bu geçişte konum kutusu dürüst kalır |
| P3 | Sekme başlığı rezervasyona özgü değil; yoklama sekme gizliyken de sürer | Açık (diğer ekranlarla aynı genel başlık) |
| P3 | İade süresi/yöntemi (yasal metinde "birkaç iş günü") panelde yok | Açık: yasal metinden içerik taşımak yerine politika bağlantısı verildi |

## Kontrolcü kararlarının uygulanışı

- **Eskiyen konum:** "3 yoklama aralığından uzun süre başarılı güncelleme yok" = son başarılı (konum içeren) yanıttan bu yana > 15 sn. Sunucu konum döndürmezse (backend 120 sn saklar) eldeki konum hemen eskimiş sayılır. Konumun kendi `at` zamanı istemci saatiyle karşılaştırılmadı (saat farkı riski). ETA eklenmedi. K-44.
- **"Vazgeç" eşit görünürlük:** soluk metin bağlantısı değil, aynı boyutta çerçeveli düğme (`.btn.outline`); telefonda iki düğme de tam genişlik.

## Değişmezler

- Tutar ve iade API'nin değerleridir, yalnızca `Intl.NumberFormat` ile biçimlenir (`money`); istemcide hesaplama/yuvarlama yok. Yüzde de API'den (`refund_percent`).
- K-14 kademeleri panelde `book.cancelTiers` ile birebir (rezervasyon onay adımındaki aynı metin).
- Tam iade garantisi satılmıyor veya ima edilmiyor: "Tam iade garantiniz uygulanır." yalnızca API `guarantee_applied: true` döndürürse (değişmedi).
- `?paid=1` sözleşmesi korundu (B-W4 yönlendirmesi); `pay.spec.ts` dokunulmadı.
- Backend, fiyat, para birimi, şema değişmedi.

## Yapılanlar (Impeccable adımları)

- **harden**: yükleniyor, ağ hatası + tekrar dene, 404/403, 401, iade önizlemesi hatası, 409, çift tıklama, eskiyen konum, konum yok; 120 karakterlik ad/adres/not (`overflow-wrap: anywhere`), `12.345,00 ₺` tek satır ve tabular; mantıksal özellikler (`text-align: end`, `inset-inline-*`, `inset-block-start`, `padding-inline-start`).
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca testi (taşma + kesilme + tek satır tutar); 720 px altında dikey zaman çizelgesi, başlık kartı tek sütun (rozet ve tutar bir satırda), eylemler tam genişlik.
- **clarify** (tr, en, de, ru): `bookings` 49 anahtar, dört dilde eşit. Yeni: `loading`, `notFoundTitle`, `notFoundHint`, `total`, `progress`, `address`, `note`, `createdAt`, `details`, `cancelLoading`, `refundAmount`, `cancelling`, `liveLoading`, `liveStale`, `openMapLast`, `liveRefresh`, `newTab`. Yeniden yazılan: `cancelPreview` (tutar ayrı satıra çıktı, Türkçe "%{percent}"), `changeText` (`<mail>` bağlantısı). Silinen: `cancelTitle` (panel başlığı artık "Rezervasyonu iptal et"). Yasal metne dokunulmadı.
- **optimize**: yeni istek yok; `BookingNotFound` sunucu-güvenli (404 sayfasında sunucuda çizilir); `"use client"` yalnızca etkileşimli bileşende.
- **animate / delight / overdrive**: eklenmedi (Operate; iptal ve canlı durum ekranında hareket dikkat dağıtır). Tek hareket olan canlı nokta nabzı hareket tercihine bağlandı.
- **polish**: odak halkası `alert`larda ofsetli, bağlantılar `--text` 600 + alt çizgi ofseti, rozet/tutar hizası, dikey çizelge çizgisi noktaları birleştirir.

## Değişen dosyalar

`web/components/BookingDetail.tsx`, `web/components/BookingNotFound.tsx` (yeni), `web/app/[locale]/bookings/[code]/not-found.tsx` (yeni), `web/components/BookingsHome.tsx`, `web/lib/format.ts` (`clockTime`), `web/app/globals.css` (rezervasyon detayı bölümü, `.btn.outline`, `.btn[aria-disabled]`, `.btn.danger:hover`, dar ekran çizelgesi, `.lookup-form`, `.booking-row .price`), `web/messages/{tr,en,de,ru}.json` (`bookings`), `web/e2e/booking-detail.spec.ts` (yeni), `scripts/ui-shots/web.js` (iptal düğmesi seçicisi `.booking-cancel-open`).

## Uygulanamadı: neden

- Rezervasyon durumunun kendiliğinden yenilenmesi: yoklama kapsamını (ve backend yükünü) değiştiren ayrı karar; P3 olarak açık.
- İade süresi/yöntemi panelde: yasal metin içeriğini ekrana taşımak yerine politika bağlantısı (yasal metin değiştirilmez kuralı).
- Rezervasyona özgü sekme başlığı: diğer ekranlarla tutarlılık için genel başlık kaldı (ayrı, yüzey çapında iş).

## Doğrulama

- Kırmızı testler önce (`npx playwright test booking-detail --project=desktop`, değişiklikten önce): **16 failed / 16**. Örnekler: "detail shows LoadingState then content" (`role="status"` "Rezervasyon bilgileri yükleniyor" yok: bileşen `null`), "cancel preview…" (panel/`.cancel-refund` yok, "100%"), "not-found code…" (genel 404, "Rezervasyon bulunamadı" başlığı yok), "live tracking…" (`.live-box` yok), "live dot does not pulse…" (`.live-box .live-dot` yok), "de detail…" (`clickUntil` 30 sn: "Buchung stornieren" paneli yok), "bookings page shows loading state…" (`getByRole('status')` "Oturum denetleniyor" yok: `BookingsHome` `null`).
- Sonra: `npx playwright test booking-detail --workers=1` (iki proje): **31 geçti, 1 atlandı** (Almanca genişlik testi yalnızca `desktop`'ta). İlk yeşil koşuda iki test düzeltildi: klavye testinde Tab sırası (başlık → politika bağlantısı → onay; bağlantı panele sonradan eklendi, test buna göre), Almanca TRY biçimi "12.345,00 TRY" (beklenen değer `Intl` ile hesaplanır). Çift tıklama testindeki tek seferlik "route.fetch: Test ended" (geliştirme modunda React StrictMode'un çift GET'i test bitişinde yolda) için `afterEach` `unrouteAll({ behavior: "ignoreErrors" })`; teşhis: yalnızca açılışta 2 GET, iptalden sonra istek yok.
- Gerileme (`--project=desktop --workers=1`): `pay.spec`, `payment-result`, `shared`: 42 testten 39 geçti; 3 başarısız ana sayfa/Rezervasyonlarım `shared` testi (yer tutucu kontrastı, Esc menü, hareket azaltma) yük altındaki geliştirme sunucusunda 5 sn içinde sayfa hazır olmadığı için düştü (ör. "Oturum denetleniyor…" 5 sn'den uzun). Sunucu sakinken `shared` tekrar: **7/7 geçti**; telefon projesinde yer tutucu testleri 2/2. `pay.spec` 19/19 (ödeme sonrası `?paid=1` ile detaya geçiş dahil), `payment-result` 16/16 (desktop).
- `npx tsc --noEmit` temiz; `npx eslint` (7 dosya) 0; `impeccable detect` (5 dosya, regex) 0; URL taraması 404/oturumlu sayfada çalışmıyor.
- `npm run build`: başarılı (dev sunucu durduruldu, build, yeniden başlatıldı, `/tr` 200).
- Görüntüler: `node scripts/ui-shots/web.js --out after --only booking-detail-paid,booking-cancel-preview,booking-not-found,bookings-anon,bookings-list` (ilk koşuda sihirbaz/ödeme adımlarında 3 zaman aşımı, ikinci koşu `missed: []`); ek durumlar geçici, commit edilmeyen bir Playwright testiyle (taklitli) çekildi. Görüntüler açılıp bakıldı: dar ekranda etiketler değerin üstünde (ilk çekimde `dl.summary` özgüllüğü yüzünden yan yana kalıyordu, düzeltildi), tam sayfa görüntülerde yapışkan üst bilginin ortada görünmesi yalnızca çekim yöntemi.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{booking-detail-paid,booking-cancel-preview,booking-not-found,bookings-anon}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{booking-detail-paid,booking-cancel-preview,booking-not-found,bookings-anon}.png`; ek durumlar (`_shots` geçici testiyle, taklitli): `{tr-390,tr-1440,de-390}-booking-{live,live-stale,loading,error,cancel-long}.png`
