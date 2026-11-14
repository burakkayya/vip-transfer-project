---
name: Getaway Transfers Mobil
description: Müşteri ve sürücü uygulamaları (Expo / React Native), Uber tarzı harita + alt panel.
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
  champagne-soft: "#f5eee2"
  pine-green-on-dark: "#7fd3a4"
  signal-red-on-dark: "#ff6b5e"
typography:
  display:
    fontFamily: "Inter_800ExtraBold"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "38px"
    letterSpacing: "-1.2px"
  headline:
    fontFamily: "Inter_800ExtraBold"
    fontSize: "26px"
    fontWeight: 800
    letterSpacing: "-0.7px"
  title:
    fontFamily: "Inter_700Bold"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-0.3px"
  body:
    fontFamily: "Inter_400Regular"
    fontSize: "15px"
    fontWeight: 400
  hint:
    fontFamily: "Inter_400Regular"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "17px"
  label:
    fontFamily: "Inter_700Bold"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "1.6px"
  button:
    fontFamily: "Inter_700Bold"
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-0.2px"
rounded:
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "28px"
  control: "14px"
spacing:
  screen: "20px"
  card: "18px"
  gap: "12px"
components:
  button-primary:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "56px"
    padding: "0 20px"
  button-small:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    height: "48px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.lacquer-black}"
    rounded: "{rounded.control}"
    height: "56px"
  button-on-dark:
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "56px"
  input:
    backgroundColor: "{colors.limestone}"
    textColor: "{colors.lacquer-black}"
    rounded: "{rounded.control}"
    height: "54px"
    padding: "0 14px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card}"
  offer-card:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "20px"
  go-button:
    backgroundColor: "{colors.lacquer-black}"
    textColor: "{colors.paper}"
    size: "128px"
---

# Design System: Getaway Transfers Mobil

Müşteri (`com.getawaytransfers.app`) ve sürücü (`com.getawaytransfers.driver`) uygulamaları; tek kod tabanı, bileşenler `mobile/components/ui.tsx`. **Renk tokenları web ve admin ile ortaktır** (kök `DESIGN.md`); tipografi ve bileşenler mobile özgüdür. Ürün gerçekleri `mobile/PRODUCT.md`.

Durum (2026-11-02): frontmatter birleştirme kararıyla hedef renkleri taşır. `ui.tsx` şu an yakın ama farklı değerler kullanır (`#0A0A0B`, `#6E6E73`, `#B8935A`, `#D23B2F`, `#1F8A5B`, `#A86B00`, `faint #A1A1A6`); tarama ortak bileşen adımında bunları hedef değerlere çeker. Mevcut `accent #B8935A` beyazda 2,85:1, `faint` 2,57:1 olduğu için metinde AA'yı geçmez.

## Overview

**Creative North Star: "Kıyı Yolu"**

Telefonda yol bir haritadır. Üstte harita, altta elde tutulan bir panel; panel yolun o anki adımını taşır: nereye, hangi araç, sürücü nerede. Sistem web ile aynı malzemeden yapılır (lake siyah, kâğıt, tek pirinç vurgu, gerçek araç fotoğrafı) ama dokunma için ölçeklenir.

İki uygulama aynı dünyayı farklı yoğunlukta konuşur. **Müşteri** uygulaması dokunsal ve kendinden emindir: iri başlık, dolgun düğme, yumuşak hareket, haptik geri bildirim. **Sürücü** uygulaması bir pano gibidir: tek bakışta okunur, iri hedefli, güneş altında yüksek kontrastlı; teklif kartı ve karşılama tabelası onun imzasıdır.

Platform davranışı uyarlanır (`adaptive`): görünüm iki platformda aynıdır; geri hareketi, klavye, güvenli alan, sistem yazı boyutu ve haptik platforma uyar.

**Key Characteristics:**
- Harita + alt panel düzeni (`MapSheet`), panel yükselir ve sürüklenir.
- Lake siyah birincil eylem, 56 px yükseklik, başparmak alanında alt çubukta.
- Rota rayı web ile aynı: daire, kesikli çizgi, kare.
- Sürücüde iri ve az: GO düğmesi, geri sayım halkalı teklif kartı, tam ekran tabela.

## Colors

Kök `DESIGN.md` "Colors" bölümü aynen geçerlidir (aynı token adları ve kurallar). Mobile özgü notlar:

- **Lake Siyah** sürücü teklif kartının ve GO düğmesinin zeminidir; üzerindeki ikincil metin beyazın en az %72'si opaklıkta olur.
- **Şampanya Pirinci** koyu zeminde serbesttir (teklif başlığı, geri sayım halkası; 5,88:1). Beyaz zeminde üst etiket (eyebrow) gibi küçük metinde `champagne-brass-ink` kullanılır.
- **Liman Tuvali** liste ekranlarının zeminidir; kartlar üstünde kâğıt olarak durur.

### Named Rules
**The Sunlight Rule.** Sürücü uygulamasında hiçbir metin veya simge 4,5:1'in altına düşmez; birincil bilgi (tutar, adres, geri sayım) 7:1'i hedefler.

## Typography

**Font:** Inter (`@expo-google-fonts/inter`), ağırlığa göre aile seçilir (`T` bileşeni; Android'de `fontWeight` özel yazı tipiyle çalışmadığı için).

**Character:** Web ile aynı ses; telefonda daha iri ve daha ağır başlıklar (800).

### Hierarchy
- **Display** (800, 34/38, -1.2): giriş ekranı başlığı, teklif tutarı (32).
- **Headline** (800, 26, -0.7): ekran başlığı ("Nereye gidiyorsunuz?" 28).
- **Title** (700, 18, -0.3): bölüm başlığı.
- **Body** (400, 15): varsayılan metin.
- **Hint** (400, 12.5/17): ipucu ve ikincil bilgi.
- **Label** (700, 11, 1.6, büyük harf): üst etiket.
- **Button** (700, 16, -0.2).

### Named Rules
**The Dynamic Type Rule.** Metin sistem yazı boyutuyla büyür; düzen %200'de kırılmaz, kritik etiketler kesilmez (`numberOfLines` yalnızca ikincil metinde).

## Layout

- **Harita + alt panel:** harita ekranın üst %30–44'ü (teklif varken %30); panel 30 px köşeyle haritanın üstüne biner, içinde adım göstergesi ve içerik, altta sabit eylem çubuğu.
- **Liste ekranları:** tuval zemin, 20 px kenar, kartlar arası 12 px.
- **Alt sekmeler:** müşteri (Ana sayfa, Rezervasyonlarım, Profil), sürücü (Ana sayfa, Kazanç, Belgeler).
- **Güvenli alan:** üst ve alt çentik payı `react-native-safe-area-context` ile.
- **Web önizlemesi:** 390×844 telefon çerçevesi (yalnızca geliştirme).
- **Yön:** müşteri düzenleri `start`/`end` (RN mantıksal yön) ile kurulur; Arapçada `I18nManager` ile ayna.

## Elevation & Depth

Belirgin yükselti. Alt panel, teklif kartı ve açılır seçiciler "yüzen" gölgeyle haritadan ayrılır; sıradan kartlar çizgilidir, yükseltilmiş kartlar kenarsız ve gölgelidir.

### Shadow Vocabulary
- **Kart** (iOS: opaklık 0.07, yarıçap 16, y 6; Android elevation 3; web `0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)`): yükseltilmiş kart.
- **Yüzen** (iOS: opaklık 0.16, yarıçap 24, y 10; Android elevation 10; web `0 12px 40px rgba(0,0,0,0.16)`): alt panel, teklif kartı, giriş paneli.

## Shapes

Kontroller 14 px, küçük öğeler 12 px, kartlar 22 px, paneller ve teklif kartı 28–30 px. Rozet ve segment kontrolü tam yuvarlak. GO düğmesi tam daire. Rota rayı web ile aynıdır.

## Components

Müşteride **dokunsal ve kendinden emin**; sürücüde **iri ve kaba hedefli**.

### Buttons
- **Primary:** lake siyah, beyaz metin, 56 px yükseklik, 14 px köşe; basınca hafif küçülme ve haptik (`tap()`), meşgulken gösterge.
- **Small:** 42 px (sürücü uygulamasında en az 48 dp'ye çıkarılır).
- **Secondary:** kireçtaşı zemin. **Light:** koyu kart üstünde beyaz. **On Dark:** koyu kart üstünde çerçeveli beyaz yazılı. **Danger:** sinyal kırmızısı.
- **Disabled:** soluk zemin; neden metinle söylenir.

### Inputs / Fields
- Kireçtaşı zemin, 1,5 px kenar, 14 px köşe, en az 54 px; etiket üstte, ikon solda (RTL'de sağda); odakta lake siyah kenar ve beyaz zemin.
- SMS kodu: 6 kutu (`OtpInput`), dolu kutu beyaz, etkin kutu siyah kenarlı.

### Cards / Lists
- Kart 22 px köşe, 18 px iç boşluk; `ListRow` ikon baloncuğu + başlık + alt başlık + sağda ok.

### Navigation
- Alt sekme çubuğu; etkin sekme simge zemini kireçtaşı hap, etiket lake siyah. Pasif etiketler en az `slate-faint`.

### Teklif Kartı (signature, sürücü)
Lake siyah, 28 px köşe, yüzen gölge. Üstte pirinç "YENİ İŞ TEKLİFİ" etiketi, iri tutar (sürücü kazancı olduğu yazılır), sağda geri sayım halkası; rota rayı; yolcu ve bagaj hapları; "Reddet" (çerçeveli) ve "Kabul et" (beyaz) eşit genişlikte, en az 56 px. Yolcu adı ve adres kabulden önce gösterilmez.

### Karşılama Tabelası (signature, sürücü)
Tam ekran beyaz zemin, yolcu adı ekrana sığan en büyük boyutta lake siyah; dokununca kapanır. Uygulama yalnızca dikey yönde çalışır (`app.config.ts` `orientation: "portrait"`).

### GO Düğmesi (signature, sürücü)
Tam daire lake siyah, "GO" 26 px 800; çevrimiçi olunca radar halkası.

## Do's and Don'ts

### Do:
- **Do** birincil eylemi alt çubukta, başparmak alanında tut.
- **Do** sürücü uygulamasında tüm dokunma hedeflerini en az 48 dp yap.
- **Do** her Reanimated animasyonunda sistem "hareketi azalt" ayarına uy (`ReduceMotion.System`, döngülerde `useReducedMotion`).
- **Do** her eyleme `accessibilityRole` ve `accessibilityLabel` ver.
- **Do** bağlantı yokken ve konum gelmezken bunu açıkça yaz; eski veriyi canlıymış gibi gösterme.

### Don't:
- **Don't** `#A1A1A6` gibi 4,5:1'in altındaki grileri metin rengi olarak kullanma.
- **Don't** beyaz zeminde küçük metni şampanya pirinciyle yazma.
- **Don't** fiyatı istemcide hesaplama veya yuvarlama; backend tutarını göster.
- **Don't** sürücü ekranında uzun paragraf veya ikinci bir birincil eylem koyma.
- **Don't** önceden işaretli onay kutusu kullanma.
