# Product

<!-- impeccable:product-schema 1 -->

Bu kayıt müşteri web sitesi (`web/`) ve admin paneli (`admin/`) içindir. Mobil uygulamalar kendi kaydını taşır: `mobile/PRODUCT.md`. Ayrıntılı iş kuralları `docs/` altındadır (başlangıç: `docs/proje_rehberi.md`); burası onların özetidir, çelişki olursa `docs/kararlar.md` geçerlidir.

## Platform

web

## Users

- **Müşteri (web sitesi):** Antalya ve Muğla'ya (AYT, GZP, DLM, BJV) gelen, çoğunlukla Avrupa ve Rusya'dan turistler. Rezervasyonu çoğunlukla telefondan, bazen uçaktan inmeden önce ya da yorgun indikten sonra yapar. İstediği: önceden belli sabit fiyat, güven, birkaç dakikada biten rezervasyon. Dilleri tr, en, de, ru; hedef on dil (K-34).
- **Admin personeli:** Operasyon, muhasebe, destek ve tam yetkili admin rolleri (K-21). Masaüstünde yoğun veriyle çalışır: eşleştirme, rezervasyon, sürücü ve belge onayı, ödeme, hakediş, KVKK talepleri. Hızlı tarama, denetlenebilirlik ve hata yapmama önceliklidir. Panel yalnızca Türkçedir.

## Product Purpose

getawaytransfers.com, Antalya ve Muğla'da havalimanı, otel ve şehirlerarası özel şoförlü transfer satar (günlük araç kiralama K-29 ile kapsamda, henüz tasarlanmadı). Müşteri fiyatı rezervasyonda görür ve kartla önceden öder; sürücü belgeleri onaylanmış bağımsız ortaktır ve hakedişi komisyon düşülerek otomatik hesaplanır. Başarı: müşterinin ilk ziyarette fiyatı görüp güvenle ödemesi, operasyonun her işi zamanında ve denetlenebilir şekilde atayıp tamamlaması.

## Positioning

- **Sabit, önceden ödenen fiyat:** taksimetre yok; fiyat backend'de ilçeler arası mesafe ve araç tipiyle hesaplanır, rezervasyonda dondurulur, yolda değişmez (K-03, K-05, K-28).
- **Yerel uzmanlık:** yalnızca Antalya ve Muğla; tüm ilçeler ve dört havalimanı, şehirlerarası transfer dahil (K-06).
- **Belgeli, onaylı sürücü:** TÜRSAB ve turizm taşımacılığı yetki belgeli sürücüler; belgeler kayıtta yüklenir, admin onaylar, süresi dolan sürücü pasife düşer (K-01).
- **VIP konfor:** isimle karşılama, Vito, V-Class ve Sprinter filosu (minivan, VIP van, minibüs, VIP minibüs; K-35).

## Operating Context

- Rezervasyon akışı: rota (adres araması veya havalimanı/ilçe) → araç ve fiyat → yolcu bilgileri → telefon ve SMS kodu (OTP, misafir rezervasyon yok, K-16) → KVKK aydınlatma ve mesafeli satış onayı → PayTR ödeme sayfası (iFrame) → onay. Sorgulama: rezervasyon kodu ve telefon.
- Planlı işte admin sürücü atar; anlık işte yakın sürücülere teklif gider. Müşteri canlı konumu web'de 5 saniyelik yoklamayla izler.
- Admin: 2FA zorunlu girişle (K-22), rol bazlı menü; her erişim değiştirilemez denetim kaydına yazılır.

## Capabilities and Constraints

- **Fiyat istemcide hesaplanmaz.** Arayüz yalnızca backend'in döndürdüğü fiyatı gösterir. Adres imzalı jetonla taşınır, ilçe istemcide değiştirilemez.
- **Para birimi:** Türkiye TRY, diğer tüm ülkeler EUR (K-13). Tüm tutarlar 5'in katıdır (K-32). TRY kuru TCMB'den otomatik gelir ve rezervasyonda dondurulur (K-33).
- **Gidiş-dönüş indirimi:** %5 (K-30).
- **İptal ve iade (K-14):** 48 saat ve üzeri %100, 24-48 saat %50, 24 saatten az %0. Politika rezervasyonda dondurulur. Arayüzdeki tüm iptal metinleri bu kademelerle birebir uyumlu olmalı.
- **Kapalı özellikler:** PayTR canlı tahsilat, sürücülere split aktarımı ve tam iade garantisi satışı (K-15) açılmaz; arayüz bunları gizler veya "yakında" der, satışa açmaz.
- **Kişisel veri:** pasaport ve kart verisi tutulmaz (K-17). Uçuş verisi yolculuk tamamlanınca silinir (K-31). Admin'de telefon, e-posta, adres ve IBAN maskelidir.
- **Yasal metinler taslaktır:** şirket unvanı, adres, TÜRSAB ve MERSİS no `web/lib/site.ts` içinde yer tutucu; hukukçu onayı bekler. Arayüz yasal içerik uydurmaz. Yeni dillerde yasal metinler taslak çeviri olarak gösterilir ve "çeviri doğrulanmadı" notu taşır.
- **Diller:** web tr, en, de, ru; fr, es, it, zh, ja, ar eklenecek (K-34). Arapça sağdan sola. Backend on dili zaten kabul eder.
- **Henüz olmayanlar:** günlük kiralama ekranları (K-29), push bildirimi, uçuş takip API'si, gerçek Google Places/Routes anahtarı (geliştirmede örnek adresler).

## Brand Commitments

- Ad: **Getaway Transfers** (getawaytransfers.com). Logo `web/components/Logo.tsx`.
- Ton: sade ve premium "VIP"; kısa, somut, abartısız. Fiyat, iptal ve ödeme metinleri net ve kural metinleriyle aynı.
- Görsel yön (2026-10-31 yenilemesi) korunur ve güçlendirilir; ayrıntısı `DESIGN.md`.

## Evidence on Hand

- Gerçek filo ve hizmet fotoğrafları: `web/public/images/*.webp`, `mobile/assets/images/*`.
- Sitedeki mevcut iddialar gerçek özelliklere dayanır: sabit fiyat, belgeli sürücü, 48 saat ücretsiz iptal, isimle karşılama, 4 havalimanı.
- **Doğrulanması gereken iddia:** "uçuş takibi / sürücünüz iniş saatinizi takip eder, gecikmede ek ücret yok". Uçuş takip API'si henüz seçilmedi (`docs/acik_konular.md`); bugün yalnızca uçuş numarası saklanıyor.
- **Henüz yok:** müşteri yorumu, puan, müşteri sayısı, basın, ortak otel logoları. Sahibi gerçek kanıtı sonra verecek; o zamana kadar uydurulmaz ve yer tutucu alan bırakılmaz.

## Product Principles

1. **Fiyat bir sözdür.** Gösterilen tutar backend'in tutarıdır, ödenen tutardır, yolda değişmez; arayüz bunu hiçbir adımda bulandırmaz.
2. **Yorgun yolcu için kısa yol.** Her adım telefonda, tek elle, zayıf bağlantıda ve kendi dilinde tamamlanabilir.
3. **Güven gerçek özelliklerden gelir.** Belgeli sürücü, sabit fiyat ve iptal kademeleri gösterilir; doğrulanmamış iddia veya kanıt eklenmez.
4. **Rıza ayrı, açık ve geri alınabilir.** KVKK aydınlatma, açık rıza ve pazarlama onayı ayrı kalır; önceden işaretli kutu ve karanlık desen yoktur.
5. **Operasyon denetlenebilir.** Admin'de her işlem izlenebilir, hassas alan maskeli, yanlış tıklamanın maliyeti düşüktür.

## Accessibility & Inclusion

- Hedef **WCAG 2.2 AA** (kontrast, klavye, odak, ekran okuyucu etiketleri, hedef boyutu).
- Uzun metin (Almanca) ve sağdan sola (Arapça) düzenler kırılmaz; mantıksal CSS özellikleri kullanılır.
- `prefers-reduced-motion` her animasyonda zorunlu.
- Düşük bağlantı: yükleniyor, hata ve yeniden deneme durumları her ağ çağrısında görünür.
- KVKK/GDPR ekranlarında reddetme seçeneği kabul kadar görünür.
