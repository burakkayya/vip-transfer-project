# Web ana sayfa (`/`): Impeccable geçişi (B-W1)

Tarih: 2026-11-02 · Dal: `ui/impeccable-pass` · Mod: **Persuade** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen; 7 "Esneklik" n/a: tanıtım yüzeyi) | **25/36 (%69, Acceptable)** | **31/36 (%86, Good)** |
| audit | **13/20 (Acceptable)** | **17/20 (Good)** |
| axe (wcag2a/2aa/21a/21aa/22aa; tr, de; 1440 ve 390, sayfa sonuna kadar kaydırılarak) | 2 ihlal: `aria-prohibited-attr` (`h1 > span`), `color-contrast` (`#services .eyebrow`, pirinç 3,3:1) | **0** |
| detector (`impeccable detect http://localhost:3000/tr`) | 14 bulgu | 4 (logo 9,28 px ×2, Inter, kesikli çizgi; hepsi bilinçli, aşağıda) |
| LCP (geliştirme sunucusu, 3 ölçüm, ilki derleme) | 1440: 1,85–1,96 sn; 390: 1,42–1,80 sn | 1440: 1,26–1,38 sn; 390: 1,39–1,55 sn (LCP öğesi her iki durumda giriş görseli) |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not (sonra) |
|---|---|---|---|---|
| 1 | Sistem durumu | 2 | 3 | Etkin öneri `aria-activedescendant` ile bildirilir; eksik adres gönderimde söylenir. Adres araması API hatasında yeniden dene düğmesi yok |
| 2 | Gerçek dünya | 3 | 3 | Rota rayı ve IATA kodları; doğrulanmamış "uçuş takibi" iddiası kullanıcı kararı bekliyor |
| 3 | Kullanıcı kontrolü | 3 | 3 | Değiştir, temizle, Esc, ok tuşları |
| 4 | Tutarlılık | 3 | 4 | Üst etiketler (eyebrow) ve beyazda küçük pirinç metin kalktı; tek hareket sistemi |
| 5 | Hata önleme | 3 | 4 | Gönderim düğmesi soluk bırakılmaz; eksik alan adıyla söylenir ve odak oraya gider |
| 6 | Tanıma | 3 | 4 | −/+ düğmeleri adlı ("Yolcu sayısını azalt"), radyo grubu adlı |
| 7 | Esneklik | n/a | n/a | Tanıtım yüzeyi |
| 8 | Estetik ve sadelik | 3 | 4 | Kart ızgarası yerine koyu güven şeridi; "Nasıl çalışır" rota rayı; Vito artık görünür |
| 9 | Hata kurtarma | 2 | 3 | Eksik alan hatası sorunu ve çözümü söyler; arama API hatasında yeniden deneme yok |
| 10 | Yardım | 3 | 3 | SSS; iptal cevabı artık üç kademeyi de söyler |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | axe 0; combobox, radyo grubu, adlı sayaçlar; hareket azaltma ve JS'siz çizimde tüm bölümler görünür |
| Performans | 3 | 3 | Giriş sahnesi saf CSS (hidrasyon beklemez); hizmet kartları ve Vito `next/image`; düzen özelliği animasyonu (`padding`) kalktı; sonsuz Vito sallanması kalktı. Lenis + motion paketi duruyor |
| Tema | 3 | 3 | Tokenlar; fotoğraf örtülerinde rgba değerleri (bilinçli). Koyu mod yok (kapsam dışı) |
| Duyarlılık | 3 | 4 | 360/390/768/1024/1440 Almanca taşma yok (test); dar formda tür seçici iki eşit yarı (container query) |
| Uygulama bütünlüğü | 2 | 3 | Kicker ×6, nabız atan nokta, giriş çipi kalktı; logo alt yazısı (B-W0 kimlik kararı) ve uçuş iddiası açık |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | `h1 > span[aria-label]` (`aria-prohibited-attr`, axe serious) | **Kapandı**: başlık sunucuda düz kelime `span`'leriyle çizilir, `aria-label` yok |
| P1 | Bölüm üst etiketleri beyaz/kireçtaşı zeminde pirinç 0.74rem (3,1–3,3:1, WCAG 1.4.3); `Reveal` gizlediği için axe yalnızca kaydırınca yakalıyordu | **Kapandı**: üst etiketler kaldırıldı (craft floor yasağı, detector `kicker-above-heading` ×6) |
| P1 | `Reveal`/`WordsIn` sunucuda `opacity:0`: JS geç/yoksa veya hareket azaltılmışsa başlık, rota kartı ve bölümler boş; rota kartı (birincil eylem) hidrasyonu bekliyordu | **Kapandı**: giriş sahnesi saf CSS; `Reveal`/`InView` varsayılanı görünür, gizli başlangıç yalnızca JS + `prefers-reduced-motion: no-preference`. Testler: "reduced motion shows all sections", "server render shows all sections" (JS kapalı) |
| P1 | Adres önerilerinde etkin seçenek ekran okuyucuya bildirilmiyor (`aria-activedescendant` yok); kapalı listede ↓ ikinci öğeye atlıyordu | **Kapandı**: seçenek kimlikleri, `aria-activedescendant`, kapalıyken ↓ listeyi açar ve ilk öğede kalır. Test: "address suggestions are keyboard operable" |
| P2 | "Fiyatları göster" adres seçilene kadar soluk, nedeni söylenmiyor (DESIGN.md: devre dışı nedenini metin söyler) | **Kapandı**: düğme her zaman lake siyah; eksik alan `aria-invalid` + `role="alert"` mesajı + odak. `/book` sayfasındaki rota formu da aynı davranışı aldı |
| P2 | Sayaç düğmelerinin adı "-" ve "+"; radyo grubunun adı yok, ok tuşu desteği yok | **Kapandı**: `trip.paxLess/paxMore/lugLess/lugMore`, `trip.tripType`, gezici `tabIndex` + ok tuşları |
| P2 | Grup bandında Vito kaydırma ilerlemesine bağlıydı: sayfa başında ve tam sayfa görüntüde görünmüyordu, sonsuz 0,6 sn sallanma | **Kapandı**: görünür alana girince bir kez yola girer, yol çizgileri araçla akıp durur, varışta tek süspansiyon oturması; sonsuz döngü yok |
| P2 | Nabız atan yeşil nokta + giriş çipi (detector `pulsing-dot` error, `hero-eyebrow-chip`); durum rengi süs olarak | **Kapandı**: çip kaldırıldı (bilgisi giriş metninde ve sayılarda var), `#4ade80` kalktı |
| P2 | Güven bölümü dört eş kart (ikon + başlık + metin), "Nasıl çalışır" 01/02/03 kartları: kategori kalıbı | **Kapandı**: güven şeridi girişin koyu zemininde çizgilerle ayrılmış dört söz; "Nasıl çalışır" rota rayı (daire → halka → kare, kesikli hat) |
| P2 | SSS iptal cevabı 24 saatten az %0 kademesini söylemiyordu (K-14 ile eksik) | **Kapandı**: dört dilde üç kademe |
| P2 | Havalimanı satırı üzerine gelmede `padding` animasyonu (düzen özelliği); oklar RTL'de ters | **Kapandı**: `transform` + `--dir` |
| P2 | Logo alt yazısı "TRANSFERS" 9,28 px | **Açık** (B-W0'dan; kimlik kararı, `acik_konular.md`) |
| P2 | "Uçuş takibi" iddiası doğrulanmamış (`why3*`, `s1Text`, `faq2a`, `flightTag`, `trust2`) | **Açık: kullanıcı kararı bekliyor** (metin değiştirilmedi) |
| P2 | Adres araması API hatasında yeniden dene düğmesi yok | **Açık**: B-W2 (rezervasyon, adres önerileri) kapsamında |
| P3 | Giriş sayıları sunucuda son değerle çizilir, hidrasyonda 0'dan sayar (kısa sıçrama) | Açık (bilinçli; hareket azaltmada sayım yok) |
| P3 | Giriş görseli etiketi ile güven şeridindeki uçuş maddesi aynı iddiayı tekrarlar | Açık (uçuş kararıyla birlikte) |

Detector'da kalanlar: `undersized-ui-text` ×2 (logo, yukarıda), `overused-font` (Inter: DESIGN.md One Family Rule, marka sabiti; yanlış pozitif), `repeating-stripes-gradient` (rota rayının kesikli hattı ve yol çizgisi; Kıyı Yolu imzası, bilinçli). Alt bilgideki tek kelimelik son satır (`straggler`) `text-wrap: pretty` ile kapandı.

## Yapılanlar (Impeccable adımları)

- **harden**: eksik adres doğrulaması ve hata ilişkilendirmesi (`aria-invalid`, `aria-describedby`, `role="alert"`); mantıksal özellikler ve `--dir` ile yön bağımsız hover/sürüş; Almanca 360 px tür seçici. Ana sayfada ağ çağrısı yalnızca sunucuda (`getRegions`, `getVehicleTypes`; boşsa bölümler gizlenir) ve adres aramasında (mevcut "Aranıyor…", hata metni).
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca taşma testi; telefonda "Nasıl çalışır" rayı dikey; tek sütunda Vito kapasite hapını örtmüyor; güven şeridi 4 → 2 → 1 sütun.
- **clarify** (tr, en, de, ru): yeni `trip` anahtarları `tripType`, `paxLess`, `paxMore`, `lugLess`, `lugMore`, `fromRequired`, `toRequired`; `home.faq4a` üç kademe; kullanılmayan `home` anahtarları silindi (`*Eyebrow` ×6, `heroBadge`, `whyTitle`, `trust1`, `trust3`, `fleetText`, `routesTitle`). `nav` ve `footer` dört dilde eksiksiz (9 ve 12 anahtar), değişiklik gerekmedi. Uçuş metinlerine dokunulmadı.
- **optimize**: giriş sahnesi CSS (LCP geliştirme ölçümünde 1440'ta ~%30, 390'da ~%10 daha erken); hizmet görselleri ve Vito `next/image` (`sizes` ile); `WordsIn`'deki büyük metin `blur` filtresi kalktı; `DriveIn`'in kaydırmaya bağlı yay (spring) hesabı ve sonsuz animasyon kalktı; `Reveal` artık motion yerine IntersectionObserver + CSS geçişi. Ana sayfa rotası 16,6 kB / 186 kB ilk yük.
- **animate / delight / overdrive** (tek fikir: rota çizgisi): giriş sahnesi (görsel oturur → başlık kelime kelime → metin → sayılar → rota kartı → kartın rayı daireden kareye çizilir, ~1,6 sn); "Nasıl çalışır" rayı görününce duraktan durağa çizilir, duraklar belirir; Vito yola girer, yol çizgileri akıp araçla durur, süspansiyon bir kez oturur. Hepsi `prefers-reduced-motion: no-preference` içinde; azaltılmışsa son durumda.
- **bolder**: üst etiketsiz, daha sıkı (−0,04em) bölüm başlıkları; giriş bölümünün koyu zemini güven şeridiyle aşağı uzar; pirinç yalnızca güven ikonları, grup bandı tikleri ve ışıltıda (%10 altı).
- **polish**: SSS satır içi stilleri sınıfa; `text-wrap: balance/pretty`; tabular rakamlar (sayılar, IATA); grup bandı tik hizası.

## Değişen dosyalar

`web/app/[locale]/page.tsx`, `web/app/home.css`, `web/app/globals.css` (alt bilgi `text-wrap`), `web/components/Motion.tsx` (`Reveal`, yeni `InView`, `HeroMedia` CSS yakınlaşma; `WordsIn`, `DriveIn`, `StepBar` kaldırıldı), `web/components/TripForm.tsx`, `web/components/AddressField.tsx`, `web/messages/{tr,en,de,ru}.json`, `web/e2e/home.spec.ts` (yeni), `web/e2e/shared.spec.ts` (hareket azaltma testi rota rayına taşındı), `DESIGN.md` (Neutral ifadesi, Label, Rota Rayı, Hareket). `FleetCard.tsx`, `RegionSelect.tsx`, `SiteHeader.tsx` incelendi, değişiklik gerekmedi (`RegionSelect` ana sayfada kullanılmıyor).

## Uygulanamadı: neden

- Uçuş takibi metinleri: kullanıcı kararı (PRODUCT.md "doğrulanması gereken iddia").
- Logo alt yazısı boyutu: kimlik kararı (B-W0'dan açık).
- Adres araması yeniden deneme: bileşen B-W2'nin ana konusu.
- Müşteri yorumu, puan, sayı: PRODUCT.md Evidence "henüz yok"; eklenmedi.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-home.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-home.png`, ek genişlikler `screenshots/after/web/de-{360,768,1024}-home.png`
