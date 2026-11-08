# Product

<!-- impeccable:product-schema 1 -->

Bu kayıt mobil uygulamalar içindir (`mobile/`, Expo SDK 58, tek kod tabanından iki uygulama). Ortak ürün gerçekleri kök `PRODUCT.md` ve `docs/` altındadır; çelişki olursa `docs/kararlar.md` geçerlidir.

## Platform

adaptive

İki platformda aynı marka dili (Uber tarzı siyah-beyaz, Inter); davranışlar platforma uyar: geri hareketi, klavye, güvenli alan, dokunma hedefleri, sistem yazı boyutu, haptik.

## Users

- **Müşteri (`com.getawaytransfers.app`):** Antalya ve Muğla'ya gelen, çoğunlukla Avrupa ve Rusya'dan turistler. Uygulamayı havalimanında, yorgun ve çoğu zaman yavaş bağlantıyla açar: rezervasyon yapar, sürücüsünü canlı izler, gerekirse iptal eder. Arayüz cihaz diline göre açılır (tr, en, de, ru; hedef on dil, K-34).
- **Sürücü (`com.getawaytransfers.driver`):** belgeleri onaylı bağımsız ortak (K-01). Uygulamayı araç içinde, telefon tutucuda, tek elle, kısa dikkat süresiyle ve güneş altında kullanır: çevrimiçi olur, teklifi kabul eder, yolculuk adımlarını işaretler, yolcuyu tabelayla karşılar, kazancını ve belgelerini izler. Arayüz Türkçedir.

## Product Purpose

Müşteri tarafında web ile aynı sabit fiyatlı, önceden ödenen rezervasyonu cebe taşımak ve yolculuk günü sürücüyü görünür kılmak. Sürücü tarafında işi kaçırmadan, güvenli ve az dikkatle almak ve tamamlamak. Başarı: müşteri sürücüsünü bulur; sürücü teklifi süresinde kabul eder, adımları doğru işaretler, hakedişini görür.

## Positioning

Kök `PRODUCT.md` ile aynı: sabit ve önceden ödenen fiyat, yalnızca Antalya ve Muğla, belgeli onaylı sürücü, VIP konfor. Sürücü için ek olarak: teklifte kazanç ve rota açıkça görünür, yolcu kişisel bilgisi yalnızca kabulden sonra açılır.

## Operating Context

- **Müşteri:** telefon ve SMS kodu ile giriş (şifre yok, K-16) → "Nereye?" → rota, zaman (Planla / Şimdi), gidiş-dönüş, yolcu ve bagaj → araç ve fiyat → yolcu bilgileri ve onaylar → ödeme sayfası uygulama içi tarayıcıda → rezervasyon detayı, sürücü kartı, WebSocket ile canlı takip, iptal önizlemesi.
- **Sürücü:** kayıt ve belge yükleme → admin onayı → iş havuzu (planlı işler her zaman, anlık işler GO ile çevrimiçiyken; K-47) → kabul öncesi iş ayrıntısı (kırpılmış rota haritası, kazanç; yolcu adı ve adres gösterilmez) → kabul/red → yolculuk ekranı: yola çıktım, vardım, yolcu alındı, yolculuğu bitir (varışa 500 m içinde, K-49); aşamaya göre alış/varışa uygulama içi rota ve telefonun harita uygulamasında yol tarifi; yolcuyla mesajlaşma; tam ekran karşılama tabelası; konum yalnızca aktif yolculukta, arka planda da paylaşılır (K-52) → kazanç ve hakediş geçmişi, belge takibi.
- Bildirimler (K-51): backend olayları uygulama içi akışa yazar, uygulama akışı yoklayıp yerel bildirim gösterir. Uygulama tamamen kapalıyken bildirim için FCM/APNs bekleniyor. Müşteri sürücünün kalan süresini görür, sürücüye yazar ve yolcu araçtayken yolculuğu bitirebilir (K-48, K-50).
- Geliştirmede web önizlemesi (8081 müşteri, 8082 sürücü) telefon çerçevesiyle çizilir; Android emülatörleri `getaway_pixel7` ve `getaway_driver`.

## Capabilities and Constraints

- Kök `PRODUCT.md` "Capabilities and Constraints" bölümündeki fiyat, para birimi, iptal, kapalı özellik ve kişisel veri kuralları aynen geçerlidir.
- Jetonlar cihazın güvenli deposunda; Google anahtarı uygulamada yok, adres araması backend üzerinden.
- Harita: gerçek harita (iOS Apple Maps, Android Google Maps) eklenecek; anahtar gelene kadar ve web önizlemesinde stilize SVG harita kalır. Rota çizgisi backend'den gelecek.
- Sürücü uygulaması yalnızca Türkçedir; metinler sözlükte tutulur ki ileride dil eklenebilsin.
- Arka plan konumu (sürücü, K-52) geliştirme derlemesinde çalışır; mağaza izin beyanı ve push (FCM/APNs) henüz yok.

## Brand Commitments

- Ad: **Getaway Transfers**; sürücü uygulamasında "Getaway Sürücü".
- Ton: müşteride sade ve premium; sürücüde kısa, emir kipinde, tek bakışta okunur.
- Görsel yön (2026-10-31 yenilemesi, Uber tarzı) korunur ve güçlendirilir; ayrıntısı `DESIGN.md`.

## Evidence on Hand

- Gerçek araç ve sürücü fotoğrafları: `mobile/assets/images/*`.
- Müşteri yorumu, puan veya sayı yoktur; uydurulmaz. Uçuş takibi iddiası kök `PRODUCT.md`'deki gibi doğrulanmayı bekler.

## Product Principles

1. **Sürücü için tek bakış, tek dokunuş.** Birincil eylem büyük, yüksek kontrastlı ve başparmak alanındadır; metin azdır.
2. **Müşteri sürücüsünü kaybetmez.** Yolculuk günü durum, sürücü ve konum ilk bakışta görünür; bağlantı koparsa bu açıkça söylenir.
3. **Fiyat bir sözdür.** Gösterilen tutar backend'in tutarıdır; istemcide hesaplanmaz.
4. **Kişisel veri en az.** Sürücü yalnızca karşılama için gereken bilgiyi görür; konum yalnızca aktif yolculukta paylaşılır.

## Accessibility & Inclusion

- Hedef **WCAG 2.2 AA**; sürücü uygulamasında dokunma hedefleri en az **48 dp**, güneş altında okunur kontrast.
- Sistem yazı boyutu büyütüldüğünde düzen kırılmaz; ekran okuyucu etiketleri (accessibilityLabel/Role) tüm eylemlerde.
- `prefers-reduced-motion` / sistem "hareketi azalt" ayarı her animasyonda uygulanır.
- Uzun metin (Almanca) ve sağdan sola (Arapça) müşteri düzenlerinde kırılmaz.
