---
name: Getaway Transfers
description: Antalya ve Muğla'da sabit fiyatlı, önceden ödenen VIP transfer. Müşteri web sitesi ve admin paneli.
colors:
  lacquer-black: "#0b0b0c"
  lacquer-black-raised: "#1c1c1f"
  paper: "#ffffff"
  limestone: "#f5f5f3"
  limestone-deep: "#ececea"
  harbor-canvas: "#f6f6f4"
  slate-text: "#6b6b70"
  slate-faint: "#76767b"
  hairline: "#e8e7e3"
  hairline-strong: "#d6d5d0"
  champagne-brass: "#a8875a"
  champagne-brass-ink: "#8a6a3c"
  signal-red: "#c0261d"
  signal-red-soft: "#fcebea"
  pine-green: "#18794e"
  pine-green-soft: "#e6f4ec"
  amber-ink: "#8a6100"
  amber-soft: "#fbf7ee"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 5.4vw, 5.1rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 4vw, 2.8rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 600
    letterSpacing: "0.16em"
  admin-body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  admin-heading:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    letterSpacing: "-0.03em"
rounded:
  sm: "12px"
  md: "18px"
  lg: "28px"
  admin-control: "9px"
  admin-card: "14px"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  stack: "16px"
  grid: "20px"
  card: "28px"
  admin-card: "18px"
  admin-cell: "10px 12px"
components:
  button-primary:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
  button-primary-hover:
    backgroundColor: "{colors.lacquer-black-raised}"
  button-big:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "16px 26px"
  button-secondary:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.lacquer-black}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
  button-secondary-hover:
    backgroundColor: "{colors.limestone-deep}"
  button-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.lacquer-black}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
  button-danger:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
  input:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.lacquer-black}"
    rounded: "{rounded.sm}"
    padding: "13px 14px"
  input-focus:
    backgroundColor: "{colors.paper}"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "{spacing.card}"
  badge-ok:
    backgroundColor: "{colors.pine-green-soft}"
    textColor: "{colors.pine-green}"
  admin-button:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.admin-control}"
    padding: "8px 15px"
  admin-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.admin-card}"
    padding: "{spacing.admin-card}"
---

# Design System: Getaway Transfers

Bu dosya müşteri web sitesini (`web/`) ve admin panelini (`admin/`) kapsar. Mobil uygulamalar kendi dosyasını taşır: `mobile/DESIGN.md`. **Renk tokenları üç yüzeyde ortaktır** (yukarıdaki `colors`); tipografi, şekil ve bileşenler yüzeye göre ayrılır. Ürün gerçekleri `PRODUCT.md`'dedir.

Durum (2026-11-02): frontmatter, birleştirme kararıyla hedef değerleri taşır. Web ve admin zaten bu renkleri kullanır; `slate-faint`, `champagne-brass-ink` ve yumuşak durum zeminleri tarama sırasında CSS değişkeni olarak eklenecektir.

## Overview

**Creative North Star: "Kıyı Yolu"**

Havalimanından otele uzanan Akdeniz kıyı yolu: yolcu indiği andan kapıya varana kadar tek, kesintisiz bir hat üzerindedir. Sistem bu hattı görünür kılar. Rota rayı (nokta, kesikli çizgi, kare), gerçek kıyı ve araç fotoğrafları ve yolculuğun bir sonraki adımını işaret eden hareket bu dünyanın taşıyıcılarıdır. Zemin lake siyah ve kâğıt beyazıdır; şampanya pirinci yalnızca yolun özel anlarında parlar.

Müşteri web sitesi bu yolu cesurca anlatır (Persuade): kenardan kenara fotoğraf, iri ve sıkı Inter başlıklar, belirgin biçimde yükselen kartlar, kaydırmaya bağlı hareket. Rezervasyon, ödeme ve hesap ekranlarında (Operate) yol sakinleşir: aynı malzemeler, daha az hareket, tek bir sonraki adım. Admin paneli aynı ailedendir ama bir işletme masasıdır: yoğun, hizalı, sessiz; marka yalnızca hassas ayrıntılarda yaşar.

**Key Characteristics:**
- Lake siyah ve kâğıt beyazı zıtlığı; renk değil kontrast taşır.
- Rota rayı imzası: alış noktası daire, varış kare, arada kesikli çizgi.
- Gerçek fotoğraf (kıyı yolu, Vito, V-Class, Sprinter); illüstrasyon yok.
- Belirgin yükselti: elde tutulan öğeler (rota kartı, özet, alt panel) gölgeyle öne çıkar.
- Şampanya pirinci nadirdir ve anlamlıdır.

## Colors

Siyah-beyaz bir yol; tek sıcak vurgu ve yalnızca anlam taşıyan durum renkleri.

### Primary
- **Lake Siyah** (lacquer-black): metin, birincil düğme, koyu bantlar (alt bilgi, çağrı bandı, teklif kartı). Sistemin asıl rengi.
- **Yükselmiş Lake** (lacquer-black-raised): koyu düğmenin üzerine gelme hali ve koyu yüzey içindeki ikinci katman.

### Secondary
- **Şampanya Pirinci** (champagne-brass): VIP etiketi, teklif başlığı, seçili ya da "özel" an, koyu zemin üstündeki küçük vurgu. Beyaz zemin üstünde yalnızca büyük metin veya süs olarak kullanılır (3,34:1).
- **Pirinç Mürekkebi** (champagne-brass-ink): beyaz zemin üstünde küçük vurgu metni gerekiyorsa (4,99:1, AA).

### Neutral
- **Kâğıt** (paper): sayfa ve kart zemini.
- **Kireçtaşı** (limestone) ve **Derin Kireçtaşı** (limestone-deep): kireçtaşı giriş alanı zemini, ikincil düğme ve yumuşak bloklardır. Derin kireçtaşı yalnızca ikincil düğmenin ve yumuşak blokların üzerine gelme halidir; giriş alanları üzerine gelmede koyulaşmaz (yalnızca `hairline-strong` kenar belirir, bkz. Inputs).
- **Liman Tuvali** (harbor-canvas): admin sayfa zemini, mobil tuval.
- **Arduvaz Metin** (slate-text): ikincil metin ve ipuçları (beyazda 5,30:1, kireçtaşında 4,86:1).
- **Soluk Arduvaz** (slate-faint): metin olarak kullanılabilecek en açık gri (4,52:1). Daha açık gri yalnızca süs ve devre dışı çizgilerde.
- **Saç Çizgisi** (hairline) ve **Güçlü Saç Çizgisi** (hairline-strong): kart kenarı, tablo satırı, ayırıcı.

### Durum
- **Sinyal Kırmızısı** (signal-red, zemin signal-red-soft): hata, iptal, yıkıcı eylem.
- **Çam Yeşili** (pine-green, zemin pine-green-soft): onaylandı, ödendi, başarı.
- **Kehribar Mürekkebi** (amber-ink, zemin amber-soft): bekliyor, uyarı, geliştirme kodu kutusu.

### Named Rules
**The Brass Is Rare Rule.** Şampanya pirinci bir ekranın %10'unu geçmez ve yalnızca "özel" anlarda görünür (VIP, teklif, seçili durum). Birincil eylem her zaman lake siyahtır.

**The Text Floor Rule.** Metin rengi, zemininde 4,5:1'in altına düşmez. Yer tutucu metin dahil hiçbir metin `slate-faint`'ten açık olamaz. `slate-faint` yalnızca kâğıt/tuval zemininde (kireçtaşında 4,14:1 kalır).

**The Status Means Status Rule.** Kırmızı, yeşil ve kehribar yalnızca durum bildirir; süs olarak kullanılmaz.

## Typography

**Display Font:** Inter (system-ui yedekli), `next/font` ile kendi sunucumuzdan.
**Body Font:** Inter.

**Character:** Tek aile, iki ses. Başlıklarda ağır ve sıkı (700, eksi harf aralığı) kıyı tabelası gibi; gövdede sakin ve okunaklı. Web README'sinde anılan Playfair Display kodda kullanılmıyor; tek aile kuralı geçerlidir.

### Hierarchy
- **Display** (700, clamp 2.6–5.1rem, 1.02, -0.045em): yalnızca ana sayfa giriş başlığı ve çağrı bandı.
- **Headline** (700, clamp 1.9–2.8rem, 1.1): sayfa başlıkları (Rezervasyon, Ödeme, Hesabım) ve ana sayfa bölüm başlıkları.
- **Title** (700, 1.4rem): kart ve adım başlıkları.
- **Body** (400, 16px, 1.55): akış metni; yasal metinlerde satır uzunluğu 65–75ch.
- **Label** (600, 0.74rem, 0.16em, büyük harf): küçük kategori başlıkları ve rozetler. Başlığın üstüne ayrı satır etiket (eyebrow/kicker) konmaz; başlık kendi ağırlığını taşır (ana sayfadan B-W1'de kaldırıldı).
- **Admin Body** (400, 14px, 1.5) ve **Admin Heading** (700, 1.6rem): panelin yoğun ölçeği. Tablo başlıkları 0.72rem, 600, büyük harf, 0.08em.

### Named Rules
**The One Family Rule.** Tüm yüzeylerde yalnızca Inter. Vurgu ağırlık ve ölçekle yapılır, ikinci bir yazı tipiyle değil.

**The Tabular Money Rule.** Tutarlar, saatler ve kodlar tabular rakamla (`font-variant-numeric: tabular-nums`) yazılır; tablolarda sağa hizalanır.

## Layout

- **Web kapsayıcı:** içerik 1440 px'te durur, kenar boşluğu orantılı (`gutter`, 16–56 px). Dar sayfalar 780 px.
- **Ritim:** dikey yığın 16 px, ızgara aralığı 20 px, kart iç boşluğu 28 px; sayfa üstü 40 px, altı 80 px.
- **Kırılım noktaları (mevcut):** 1180, 1080, 960, 900, 800, 720, 480 px (`max-width`). Tarama sırasında 1080 / 720 / 480 ana kırılımlarına toplanması hedeflenir.
- **Rezervasyon sihirbazı:** geniş ekranda form + yapışkan özet kartı iki sütun; telefonda özet formun altına iner.
- **Admin:** sabit sol kenar çubuğu + içerik; tablolar yatay kaydırılabilir sarmalayıcıda.
- **Yön bağımsızlığı:** yeni ve düzeltilen kurallar mantıksal özellik kullanır (`margin-inline-start`, `inset-inline-start`, `padding-inline`). Arapça (`dir="rtl"`) hedefi vardır.

## Elevation & Depth

Belirgin yükselti. Zemin düzdür, ama kullanıcının "elinde tuttuğu" her öğe (ana sayfa rota kartı, rezervasyon özeti, açılır menü, mobil alt panel) açıkça yükselir ve sayfadan ayrılır. Sıradan içerik kartları ince saç çizgisiyle durur.

### Shadow Vocabulary
- **Dinlenme** (`0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.05)`): yükseltilmiş ama ikincil kart.
- **Yüzen** (`0 2px 8px rgba(0,0,0,0.06), 0 30px 60px rgba(0,0,0,0.14)`): rota kartı, özet kartı, açılır pencere.
- Admin gölge kullanmaz; katman zemin tonuyla (liman tuvali → kâğıt) kurulur.

### Named Rules
**The Held Object Rule.** Gölge yalnızca kullanıcının etkileşimde olduğu veya elinde tuttuğu öğede bulunur. Bir ekranda en fazla iki "yüzen" öğe olur.

## Shapes

Yumuşak ama kararlı köşeler. Kontroller 12 px, kartlar 18 px, büyük bloklar ve alt bilgi 28 px. Admin daha keskindir: kontrol 9 px, kart 14 px. Rota rayı şekil dilinin imzasıdır: alış noktası dolu daire, varış dolu kare, arada kesikli çizgi. Haplar (dil seçici, rozet) tam yuvarlaktır.

## Components

Bileşen hissi yüzeye göre ayrıdır: **web dokunsal ve kendinden emin**, **admin rafine ve yoğun**.

### Buttons
- **Shape:** 12 px köşe (admin 9 px).
- **Primary:** lake siyah zemin, beyaz metin, 600 ağırlık; 12×22 px (büyük: 16×26 px). Üzerine gelince yükselmiş lake, basınca 1 px aşağı.
- **Secondary / Ghost:** kireçtaşı zemin, siyah metin; üzerine gelince derin kireçtaşı.
- **Light:** koyu zemin üstünde beyaz düğme.
- **Danger:** sinyal kırmızısı; yalnızca onay adımındaki yıkıcı eylemde.
- **Disabled:** %35 opaklık. Devre dışı nedenini metin söyler; yalnızca soluk düğmeye güvenilmez.
- **Focus:** klavye odağı görünür olmalı (`:focus-visible` iki piksellik lake siyah halka, koyu zeminde beyaz).

### Cards / Containers
- **Corner Style:** 18 px (admin 14 px).
- **Background:** kâğıt; saç çizgisi kenar.
- **Shadow Strategy:** sıradan kart çizgili; elde tutulan kart "yüzen" gölgeli ve kenarsız.
- **Internal Padding:** 28 px (admin 18 px).

### Inputs / Fields
- **Style:** kireçtaşı zemin, şeffaf 1,5 px kenar, 12 px köşe, 13×14 px iç boşluk; etiket alanın üstünde 0.82rem 600.
- **Focus:** kenar lake siyah, zemin kâğıda döner.
- **Error:** alanın altında sinyal kırmızısı metin; alan `aria-invalid` ve `aria-describedby` ile bağlanır.
- **Placeholder:** `slate-text` (kireçtaşı zeminde 4,86:1). Üzerine gelince zemin koyulaşmaz; `hairline-strong` kenar belirir.

### Chips / Badges
- **Style:** tam yuvarlak hap; durum rozetleri yumuşak zemin + koyu durum rengi. VIP rozeti lake siyah zemin, beyaz metin.

### Navigation
- **Web:** yapışkan beyaz üst bilgi; ortada bölüm bağlantıları, sağda Rezervasyonlarım, Hesabım, dil seçici ve siyah "Rezervasyon" düğmesi. Telefonda menü düğmesi açılır panel açar.
- **Admin:** sol kenar çubuğu, rol bazlı gruplanmış bağlantılar; etkin bağlantı koyu zemin.

### Rota Rayı (signature)
İki adres alanını tek bir kartta birleştiren dikey hat: üstte daire, altta kare, arada kesikli çizgi; tam iki alanın ortasından geçer. Web ana sayfası, rezervasyon özeti ve mobilde aynı biçimde kullanılır. Ana sayfanın "Nasıl çalışır" bölümü aynı rayı adımlar için kullanır (geniş ekranda yatay, telefonda dikey; ara durak içi boş halka).

### Hareket (web, Persuade)
Varsayılan çizim her zaman görünürdür; gizli başlangıç durumu yalnızca JS öğeyi işaretlediğinde ve `prefers-reduced-motion: no-preference` iken uygulanır (`Reveal`, `InView`, `home.css`). Ana sayfanın tek sahnesi CSS ile ilk boyamada oynar (~1,6 sn): görsel oturur, başlık kelime kelime yükselir, rota kartı gelir, kartın rayı daireden kareye çizilir. Destekleyici anlar: "Nasıl çalışır" rayı görününce çizilir; yandan Vito görününce yola girer ve yol çizgileri araçla birlikte akıp durur. Sonsuz döngü yok (canlı veri göstergesi hariç).

### Araç Kartı (signature)
Fotoğraf, ad, yolcu ve bagaj kapasitesi, mesafe ve süre, sağda fiyat. Fiyat gelene kadar iskelet; fiyat backend'den gelmezse "uygun değil" ve nedeni. Seçili kart lake siyah kenarlı.

### Admin Table
Yoğun satırlar (10×12 px hücre), büyük harfli küçük başlıklar, üzerine gelince açık satır zemini, son satırda çizgi yok. Tutarlar sağa hizalı ve tabular.

## Do's and Don'ts

### Do:
- **Do** birincil eylemi her ekranda tek ve lake siyah tut.
- **Do** fiyatı yalnızca backend'den geldiği haliyle, para birimi biçimiyle (`Intl.NumberFormat`) göster.
- **Do** her yükleniyor, boş ve hata durumunu görünür yap; iskelet, yükleme bekleyen fiyatın yerini korur.
- **Do** mantıksal CSS özellikleri kullan; düzen Almanca uzunluğunda ve `dir="rtl"` altında kırılmamalı.
- **Do** her animasyonu `prefers-reduced-motion` altında kapat veya anlık geçişe indir.

### Don't:
- **Don't** şampanya pirincini birincil düğme, büyük yüzey ya da beyaz zeminde küçük metin rengi olarak kullanma (küçük metinde `champagne-brass-ink`).
- **Don't** `slate-faint`'ten açık gri metin kullanma.
- **Don't** önceden işaretli onay kutusu veya reddi gizleyen rıza deseni kullanma; KVKK aydınlatma, açık rıza ve pazarlama onayı ayrı kalır.
- **Don't** doğrulanmamış güven kanıtı (yorum, puan, sayı, logo) ekleme.
- **Don't** admin'e pazarlama hareketi veya dekoratif gölge ekleme.
