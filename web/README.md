# Web (müşteri sitesi)

Next.js 15 (App Router) + TypeScript + next-intl. Kapsam: `docs/ekranlar.md`, "Müşteri web sitesi".

## Çalıştırma

```
cd web
npm install
copy .env.example .env.local      # GETAWAY_API_URL: backend adresi
npm run dev                       # http://localhost:3000
npm run typecheck
npm run build && npm start
```

Backend (`backend/README.md`) ayakta olmalı. Geliştirmede ödeme sahte sağlayıcıyla yapılır: iFrame'deki "Ödemeyi onayla" düğmesi.
SMS kodu backend konsoluna yazılır.

## Diller

MVP dört dil: `tr`, `en`, `de`, `ru` (`i18n/routing.ts`, `messages/*.json`). Yeni dil için bir mesaj dosyası eklenip `locales` listesine yazılır.
Adresler her zaman dil önekiyle açılır (`/de/book`). Öneksiz adres tarayıcı diline göre yönlendirilir.

## Ekranlar

| Ekran | Yol |
|---|---|
| 1-2 Ana sayfa, adres arama ve fiyat | `/` |
| 3-5 Rezervasyon: araç, bilgiler, SMS doğrulama, KVKK ve mesafeli satış onayı | `/book` |
| 6 Ödeme (PayTR iFrame) | `/bookings/{kod}/pay`, PayTR dönüşü `/booking/payment-result` |
| 7, 9 Onay, detay, iptal, canlı takip | `/bookings/{kod}` |
| 8 Rezervasyon sorgulama | `/bookings` |
| 10 Sabit sayfalar | `/legal/cancellation`, `/legal/privacy`, `/legal/distance-sales`, `/legal/cookies`, `/data-request` |
| Profil, pazarlama onayı | `/account` |

## Adres ve fiyat

`components/AddressField.tsx`: havalimanı ve ilçeler yerel listeden anında, otel ve adresler backend üzerinden Google Places ile aranır.
Seçilen adresin ilçesi fiyatı belirler (K-28, docs/fiyatlandirma.md). Ana sayfadaki rota, adres jetonlarıyla `sessionStorage` üzerinden rezervasyon sayfasına taşınır.
Paylaşılabilir linkler bölge koduyla çalışır: `/tr/book?from=ayt&to=kemer`.

## Tasarım

Değişkenler ve bileşen stilleri `app/globals.css` içindedir. Yazı tipleri (Inter, Playfair Display) `next/font` ile derlemede indirilip kendi sunucumuzdan verilir. İkonlar satır içi SVG'dir (`components/Icon.tsx`).

## Güvenlik

- Tarayıcı backend'e doğrudan bağlanmaz. Tüm çağrılar `app/bff/[...path]/route.ts` vekilinden geçer.
- Erişim ve yenileme jetonları `httpOnly`, `SameSite=Lax` çerezlerde tutulur, JavaScript'e açılmaz. Erişim jetonu dolunca vekil yeniler.
- Vekil yalnızca müşteri uçlarını iletir (admin ve sürücü uçları kapalı). Durum değiştiren isteklerde `Origin` kontrol edilir.
- İstemci IP'si backend'e `cf-connecting-ip` başlığıyla iletilir. Üretimde backend yalnızca web sunucusundan ve Cloudflare'den erişilebilir olmalı, aksi halde bu başlık taklit edilebilir.
- CSP: yalnızca kendi kaynaklar, iFrame için PayTR. Kart bilgisi sitede hiç girilmez.
- Canlı sürücü konumu web'de 5 saniyede bir yoklanır. WebSocket mobil uygulamada kullanılır, çünkü web'de jeton tarayıcıya verilmez.

## Bekleyenler

- `lib/site.ts`: şirket unvanı, adres, TÜRSAB ve MERSİS no.
- Yasal metinler taslaktır, hukukçu onayı gerekir. Sayfalarda "taslak" uyarısı görünür, onaydan sonra kaldırılır.
- Google Maps anahtarı backend'e tanımlanana kadar adres araması örnek yerlerle çalışır (docs/test_senaryolari.md).
