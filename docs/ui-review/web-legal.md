# Web yasal sayfalar (`/legal/cancellation`, `/legal/privacy`, `/legal/distance-sales`, `/legal/cookies`): Impeccable geçişi (B-W11 … B-W14)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Read** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector kanıtı B sonra). Impeccable adımları in-thread pass; soru sorulmadı, kararlar aşağıda.
Kapsam: dört sayfa tek dinamik rotadır (`web/app/[locale]/legal/[slug]/page.tsx`). Görev kuralı gereği yalnızca tipografi, okunurluk ve düzen değişti. **Metin anahtarları, metin, sıra ve yasal içerik değişmedi**; yeni mesaj anahtarı eklenmedi. Taslak notu ("Bu metin taslaktır ve hukuki onay bekliyor.") her sayfada içerikten önce görünür kalır.

## Puanlar (sayfa başına)

Read modunda uygulanamayan sezgiseller `n/a`, toplam uygulanabilir azamîye göre: 5 (hata önleme: giriş yok) ve 9 (hata kurtarma: hata durumu yok) her sayfada `n/a`; 7 (esneklik) yalnızca bölümlü uzun metinde (KVKK) puanlanır.

| Sayfa | critique önce | critique sonra | axe önce | axe sonra | detector |
|---|---|---|---|---|---|
| `/legal/cancellation` (B-W11) | 20/28 (%71) | 24/28 (%86) | 0 | 0 | 0 |
| `/legal/privacy` (B-W12) | 20/32 (%63) | 28/32 (%88) | 0 | 0 | 0 |
| `/legal/distance-sales` (B-W13) | 20/28 (%71) | 23/28 (%82) | 0 | 0 | 0 |
| `/legal/cookies` (B-W14) | 21/28 (%75) | 23/28 (%82) | 0 | 0 | 0 |

audit (dört sayfa ortak): önce 15/20, sonra 18/20 (erişilebilirlik 3→4: içindekiler `nav`, kademeler `ul`, makale başlığa bağlı; tema 3→4: yalnızca tokenlar ve mantıksal özellikler; duyarlılık 3→4: 360–1440 px Almanca taşma yok, `hyphens: auto`; performans 4→4: sunucu bileşeni, istemci JS yok; uygulama bütünlüğü 2→2: başlıksız uzun metinler, "son güncelleme" tarihi verisi yok).

### critique ayrıntısı (önce → sonra)

| # | Sezgisel | İptal | KVKK | Mesafeli satış | Çerez | Not |
|---|---|---|---|---|---|---|
| 1 | Sistem durumu | 3→3 | 3→3 | 3→3 | 3→3 | Sürüm satırı ve taslak notu var; "son güncelleme" tarihi verisi yok (uydurulmadı) |
| 2 | Gerçek dünya | 3→3 | 3→3 | 3→3 | 3→3 | Metin değişmez |
| 3 | Kullanıcı kontrolü | 3→3 | 2→4 | 3→3 | 3→3 | KVKK: bölüme atlama ve geri dönme (çapa + tarayıcı geri) |
| 4 | Tutarlılık | 3→4 | 3→4 | 3→4 | 3→4 | Dört sayfa aynı başlık bloğu, ölçü ve ritim; baskı düzeni |
| 5 | Hata önleme | n/a | n/a | n/a | n/a | Giriş yok |
| 6 | Tanıma | 2→4 | 2→4 | 2→3 | 3→3 | İptal: kademeler ayrı liste; KVKK: içindekiler; mesafeli satış: başlıksız metin (etiketler cümle içinde, metne dokunulmaz) |
| 7 | Esneklik | n/a | 1→3 | n/a | n/a | KVKK: içindekiler + çapalar; kısa sayfalarda uygulanamaz |
| 8 | Estetik ve sadelik | 3→4 | 3→4 | 3→4 | 3→4 | Başlık bloğu sıkı, gövde 70ch ve 1.65 satır aralığı, başlık üstü boşluğu altından açık |
| 9 | Hata kurtarma | n/a | n/a | n/a | n/a | Hata durumu yok |
| 10 | Yardım | 3→3 | 3→3 | 3→3 | 3→3 | İletişim e-postası metinde |
| **Toplam** | | **20→24/28** | **20→28/32** | **20→23/28** | **21→23/28** | |

KVKK toplamı: önce 20/32 (%63), sonra 28/32 (%88).

## Bulgular ve durum

| Öncelik | Sayfa | Bulgu | Durum |
|---|---|---|---|
| P1 | İptal | K-14 kademeleri diğer paragraflarla aynı görünüyor; okuyan "48 saat / 24 saat" sınırlarını taramada kaçırır | **Kapandı**: `tier1`–`tier3` tek bir `ul.legal-tiers` içinde (kireçtaşı blok, saç çizgisi ayırıcı, tabular rakam). Metin ve sıra aynı. Test: "tiers text matches K-14 exactly" |
| P1 | KVKK | Beş bölümlü metinde içindekiler ve bölüme bağlantı yok | **Kapandı**: mevcut bölüm başlıklarından kurulan `nav` (adı sayfa başlığı; üst bilgideki "Bölümler" menüsüyle aynı adı taşımaz), `#data` … `#rights` çapaları, yapışkan üst bilgi payı (`scroll-margin-block-start`). Test: "privacy has a section index with working anchors" |
| P2 | Tümü | Satır uzunluğu ölçülmemiş (780 px kapsayıcıya bağlı; 16 px'te ~70ch tesadüfen) | **Kapandı**: kapsayıcı `calc(70ch + 2 * gutter)`, gövde 1.0625rem / 1.65, öğeler `max-inline-size: 70ch`. Test: "… reading measure is 65-75ch" (dört sayfa) |
| P2 | Tümü | Baskıda üst bilgi, alt bilgi ve renkli not; yasal metin yazdırılıyor/PDF'e kaydediliyor | **Kapandı**: `@media print` üst/alt bilgi ve içindekiler gizli, taslak notu kenarlı ve görünür, başlık sonrası sayfa kırılmaz. Test: "legal page prints without site chrome" |
| P2 | Tümü | Başlık, not ve sürüm satırı ayrı ayrı yüzüyor; başlık üstü/altı boşluğu eşit | **Kapandı**: `.legal-head` 12 px yığın, gövdeye 36 px; `h2` 2.2em üst / 0.5em alt, `text-wrap: balance`, paragraf `text-wrap: pretty` |
| P3 | Mesafeli satış | Bölüm başlığı yok; "Satıcı:", "Hizmet:" gibi etiketler cümlenin içinde | Açık: metin ve anahtar yapısı değişmez (hukukçu onaylı metin bölümlenirse başlık eklenebilir) |
| P3 | Tümü | "Son güncelleme" tarihi yok, yalnızca "Sürüm 1.0" | Açık: tarih verisi yok, uydurulmadı |
| P3 | Tümü | `hyphens: auto` Almancada kısaltmayı da böler ("TÜR-SAB") | Kabul: dar ekranda taşmayı önler; yasal metin değişmez |
| P3 | İptal | Görevdeki "%0" ifadesi metinde yok; `tier3` "iade yapılmaz" diyor (anlamca %0) | Açık: metin değiştirilmez; test mesajdaki birebir metni ve "24 saatten az" + "iade yapılmaz"ı denetler |

Kararlar: içindekiler yalnızca üç ve daha fazla bölüm başlığı olan metinde çizilir (bugün yalnızca KVKK); yeni anahtar gerekmesin diye adı sayfa başlığından (`aria-labelledby`) gelir. Kademe listesinde renkli kenar şeridi kullanılmadı (craft floor yasağı); durum renkleri kullanılmadı (kademe bir durum değil).

## Yapılanlar (Impeccable adımları)

- **typeset / layout**: ölçü, gövde boyutu, satır aralığı, başlık ritmi, başlık bloğu; kademeler listesi; içindekiler.
- **harden**: uzun Almanca (360–1440 px testte taşma yok), `overflow-wrap`, `hyphens`; mantıksal özellikler (`margin-block`, `padding-block`, `border-block`, `max-inline-size`, `scroll-margin-block-start`): Arapça (C-W1) için yön sabit kodlanmadı. Boş ve hata durumu: `n/a` (statik sunucu sayfası, ağ çağrısı yok; bilinmeyen slug 404'e gider, `web-not-found.md`).
- **adapt**: 360/390/768/1024/1440 px; telefonda içindekiler satır kayar, dokunma hedefi ≥ 34 px.
- **clarify**: yapılmadı (yasal metin; görev kuralı).
- **optimize**: sunucu bileşeni, istemci JS yok, görsel yok.
- **animate/delight**: eklenmedi (Read, yasal metin).
- **polish**: baskı stili, bağlantı alt çizgi rengi ve ofseti.

## Değişen dosyalar

`web/app/[locale]/legal/[slug]/page.tsx`, `web/app/globals.css` (`.legal`, `.legal-head`, `.legal-body`, `.legal-toc`, `.legal-tiers`, `@media print`), `web/e2e/legal.spec.ts` (yeni, 20 test; iki projede 40 koşu).

## Uygulanamadı: neden

- Metin içi bağlantılar (mesafeli satıştan iptal politikasına, KVKK'dan veri talep formuna): mesaj metni değişmeden yapılamaz.
- "Son güncelleme" tarihi: veri yok.
- `ar` (sağdan sola) görüntüsü: dil C-W1'de eklenecek; düzen yalnızca mantıksal özellik kullanır.

## Doğrulama

- Kırmızı (önce, `npx playwright test legal.spec not-found.spec --project=desktop --workers=1`): **7 başarısız, 20 geçti**. Yasal sayfalarda başarısız: "tiers text matches K-14 exactly" (`toHaveCount(1)`: liste yoktu), "privacy has a section index with working anchors" (`toBeVisible`: `nav` yoktu), "legal page prints without site chrome" (`toBeHidden`: üst bilgi baskıda görünüyordu). Önce de geçenler (koruma testleri): axe ×4, taslak notu ×4, içerik değişmedi ×4, ölçü ×4 (16 px Inter'de 780 px kapsayıcı tesadüfen 70ch idi; 17 px gövdeye geçince ilk denemede 65'in altına düştü ve kapsayıcı ch'ye bağlandı), Almanca taşma.
- Sonra: `npx playwright test legal.spec not-found.spec --workers=1` (iki proje): **48 geçti, 6 atlandı** (ölçü ve taşma testleri yalnızca desktop).
- `npx tsc --noEmit` temiz; `npx eslint` (sayfa + spec) 0; `impeccable detect` `[]`.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-legal-{cancellation,privacy,distance-sales,cookies}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-legal-{cancellation,privacy,distance-sales,cookies}.png`
