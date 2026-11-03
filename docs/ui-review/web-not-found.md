# Web bulunamadı (404, `app/[locale]/not-found.tsx`): Impeccable geçişi (B-W15)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Operate** (kaybolan ziyaretçiyi yola döndürmek) · North Star: "Kıyı Yolu"
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor). Impeccable adımları in-thread pass; soru sorulmadı.
Kapsam: B-W0'da kurulan yerel 404 (`[...rest]` → `notFound()`, `html[lang]`). İki giriş yolu: eşleşmeyen adres (`/tr/bu-sayfa-yok`) ve `notFound()` çağıran rota (`/tr/legal/olmayan`). Rezervasyon koduna özgü bulunamadı ekranı (`BookingNotFound`) B-W6'nındır.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen; 5 hata önleme `n/a`: giriş yok) | **22/36 (%61)** | **30/36 (%83)** |
| audit | 16/20 | 18/20 |
| axe (iki giriş yolu) | 0 | **0** |
| detector (`not-found.tsx`) | 0 | 0 |
| lint | 0 | 0 |

| # | Sezgisel | Önce | Sonra | Not |
|---|---|---|---|---|
| 1 | Sistem durumu | 2 | 4 | Sekme başlığı ana sayfanınkiydi ("Getaway Transfers \| Antalya ve Muğla VIP Transfer"); şimdi "404 \| Getaway Transfers" |
| 2 | Gerçek dünya | 3 | 3 | "Aradığınız sayfa bulunamadı. Adres değişmiş ya da kaldırılmış olabilir." |
| 3 | Kullanıcı kontrolü | 2 | 4 | Rezervasyonuna ulaşmak isteyen için yol yoktu; şimdi **Rezervasyonlarım** |
| 4 | Tutarlılık | 3 | 3 | Site düzeni, tek birincil (lake siyah) eylem |
| 5 | Hata önleme | n/a | n/a | Giriş yok |
| 6 | Tanıma | 3 | 4 | Üç olası hedef görünür |
| 7 | Esneklik | 2 | 3 | Üst bilgi menüsü + üç eylem |
| 8 | Estetik | 3 | 3 | Değişmedi; 360 px'te düğmeler satır kayar |
| 9 | Hata kurtarma | 2 | 3 | Ana sayfa, rezervasyonlar, yeni rezervasyon |
| 10 | Yardım | 2 | 3 | Alt bilgide iletişim; sayfada ayrıca yardım metni yok (yeni metin eklenmedi) |
| **Toplam** | | **22/36** | **30/36** | |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Kaybolan ziyaretçinin en olası hedefi (SMS/e-postadaki eski bağlantıyla gelen müşterinin rezervasyonu) 404'te yoktu | **Kapandı**: **Ana sayfaya dön** (birincil), **Rezervasyonlarım**, **Rezervasyon →**. Test: "404 offers home and bookings links" (iki giriş yolu) |
| P2 | Sekme ve geçmişte 404 ana sayfa başlığını taşıyordu | **Kapandı**: "404 \| Getaway Transfers". `not-found.tsx`'ten `metadata` dışa aktarımı Next 15.5'te uygulanmadı (denendi, başlık değişmedi); React 19 `<title>` başa taşınır ve `document.title` 404 olur. `head`'de düzenin `<title>`'ı da kalır (ikinci sırada). Test: "404 has its own document title" |
| P2 | Üretimde sunucu `__next_error__` kabuğu döndürür, 404 içeriği istemcide çizilir | Açık (B-W0'dan, `acik_konular.md`): Next 15 davranışı; bu görevde değişmedi |
| P3 | `h1` yalnızca "404"; ekran okuyucuda açıklama başlık dışında | Kabul: açıklama hemen sonraki paragraf; `shared.spec.ts` `h1` "404" sözleşmesini korur |

## Yapılanlar

- **harden**: iki giriş yolu (`[...rest]` ve `notFound()`) testte; boş/hata durumu `n/a` (statik ekran, ağ çağrısı yok).
- **adapt**: 360–1440 px Almanca taşma yok (test); 360 px'te ikincil düğmeler ikinci satıra kayar.
- **clarify**: yeni metin yok; mevcut `errors.back_home`, `nav.bookings`, `nav.book` kullanıldı (4 dil).
- **optimize / animate**: gerek yok.

## Değişen dosyalar

`web/app/[locale]/not-found.tsx`, `web/e2e/not-found.spec.ts` (yeni, 7 test).

## Doğrulama

- Kırmızı (önce, desktop): "404 offers home and bookings links" ×2 (`Rezervasyonlarım` bağlantısı yok) ve "404 has its own document title" ×2 (alınan: "Getaway Transfers \| Antalya ve Muğla VIP Transfer") başarısız; axe ×2 ve taşma geçti.
- Sonra: `npx playwright test not-found.spec shared.spec --workers=1` iki projede 27 geçti, 1 atlandı.
- `tsc`, `eslint` temiz; detector `[]`.

## Görüntüler

- Önce: `screenshots/before/` yerel 404 öncesi Next'in varsayılan sayfasıdır (B-W0 öncesi); B-W0 sonrası durum `screenshots/after/web/*-not-found.png`'nin önceki sürümündedir (git geçmişi).
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{not-found,not-found-in-locale}.png`
