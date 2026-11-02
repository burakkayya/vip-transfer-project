# Karar Kaydı

Her karar tarih, konu ve kısa gerekçe ile tutulur. Değiştirilen kararlar silinmez, "Durum: değiştirildi" olarak işaretlenir.

| No | Konu | Karar | Durum |
|---|---|---|---|
| K-01 | Sürücü modeli | Sürücüler TÜRSAB onaylı, yetkili ve belgeleri sisteme kayıt sırasında kontrol edilen bağımsız ortaklardır. | Kesin |
| K-02 | Komisyon | Örnek: 60 € fiyattan sürücüye 45 € (%25 komisyon). Oran sistemde değiştirilebilir parametredir. | Kesin |
| K-03 | Fiyat formülü | Mesafe (km) x 1,10 € x araç tipi çarpanı, ardından minimum 30 € kontrolü. | Kesin |
| K-04 | Yuvarlama | Fiyatlar 5'in katına yuvarlanır (örnek: 167,30 → 170 €). TRY dahil tüm para birimleri için geçerli (K-32). | Kesin |
| K-05 | Taksimetre | Taksimetre kullanılmaz, fiyat rezervasyon anında hesaplanır ve önceden tahsil edilir. | Kesin |
| K-06 | Bölge | Antalya ve Muğla'nın tüm ilçeleri ve havalimanları. Şehirlerarası transfer dahil. | Kesin |
| K-07 | Rezervasyon türleri | Hem anlık eşleştirme hem planlı rezervasyon. | Kesin |
| K-08 | Gidiş-dönüş | İndirim uygulanır, yüzde veya sabit tutar olarak tanımlanabilir. Değer K-30 ile %5. | Kesin |
| K-09 | Araç kullanımı | Araçlar günlük de kiralanabilir. MVP'ye dahil (K-29). | Kesin |
| K-10 | Ödeme modeli | Ön ödeme. Sürücü ödemeleri otomatik hakediş ile yapılır. | Kesin |
| K-11 | Ödeme sağlayıcı | Birincil PayTR, yedek iyzico. Müşteri para biriminde tahsilat. | Kesin, sözleşme teyidi bekliyor |
| K-12 | Havale/EFT | Kabul edilmez. | Kesin |
| K-13 | Para birimi | Avrupa ülkeleri EUR, Türkiye TRY, diğer ülkeler EUR. Kur farkı şirkete yansımaz (EUR tahsil, TRY ödeme akışı). | Kesin |
| K-14 | İptal politikası | 48 saat ve üzeri %100 iade, 24-48 saat arası %50 iade, 24 saatten az %0. | Kesin |
| K-15 | Tam iade garantisi | İlk sürüme dahil edilecek. Hukuki yapı (sigorta mevzuatı) doğrulanmadan satışa açılmayacak. | Hukuki teyit bekliyor |
| K-16 | Üyelik | Misafir rezervasyon yok. OTP ile hızlı üyelik (sadece telefon ve SMS kodu, şifre yok). | Kesin |
| K-17 | Kişisel veri | Pasaport bilgisi sistemde tutulmaz, yalnızca kurumlara iletilir. Kart verisi tutulmaz. | Kesin |
| K-18 | Uçuş verisi | Uçuş numarası, planlanan ve gerçek iniş saati. Saklama süresi K-31 ile değişti: yolculuk tamamlanınca silinir. | Değiştirildi (K-31) |
| K-19 | Veri merkezi | Ana altyapı Türkiye'de. Yurt dışı servisler minimum veriyle kullanılır. | Kesin |
| K-20 | Teknoloji | Backend Python (FastAPI), PostgreSQL + PostGIS, Redis, Web Next.js, Mobil Expo (React Native). | Kesin |
| K-21 | Admin rolleri | Veritabanında rol yapısı kurulur. İlk kullanıcılar tam yetkili admin olur. | Kesin |
| K-22 | Admin güvenliği | Her admin kendi hesabıyla girer, giriş 2FA zorunlu. | Kesin |
| K-23 | Sürücü uygulaması | MVP'de olacak (mobil). | Kesin |
| K-24 | Müşteri uygulaması | MVP'de olacak (iOS/Android). | Kesin |
| K-25 | Domain | Kayıt Turhost'ta kalır. DNS Cloudflare'e taşınır (zamanı gelince). | Kesin |
| K-26 | Diller | Almanca, Rusça, İngilizce, Fransızca, İspanyolca, İtalyanca, Çince, Japonca, Türkçe, Arapça. MVP'de on dilin hepsi (K-34). | Kesin |
| K-27 | Mevzuat | TÜRSAB, turizm taşımacılığı yetki belgesi, KVKK, GDPR, Mesafeli Sözleşmeler Yönetmeliği, e-Arşiv. | Hukuki doğrulama bekliyor |
| K-28 | Adres ve fiyat | Adres Google Places ile aranır (backend üzerinden, anahtar istemciye verilmez). Fiyat, adresin bağlı olduğu ilçeler arası mesafeyle hesaplanır, aynı ilçe içinde gerçek mesafe. Bkz. fiyatlandirma.md. | Kesin (2026-10-29) |
| K-29 | Günlük araç kiralama | MVP'de olacak. Şoförlü günlük kiralama ürünü: müşteri gün sayısı ve araç tipi seçer, fiyat günlük ücretle hesaplanır. Tasarım ve fiyat modeli henüz yazılmadı. | Kesin (2026-10-31), geliştirme bekliyor |
| K-30 | Gidiş-dönüş indirimi | %5 (yüzde tipi). Toplam fiyat üzerinden düşülür, sonra 5'in katına yuvarlanır. Geliştirme veritabanına seed ile işlendi. | Kesin (2026-10-31), uygulandı |
| K-31 | Uçuş verisi saklama | Yolculuk gerçekleştiyse ve ilgili kurumlara bildirim gerekiyorsa bildirim yapıldıktan sonra saklamaya gerek yok. Kodda: yolculuk tamamlanınca `purge_at = şimdi`, saatlik görev siler. Kuruma bildirim akışı henüz yok; zorunluluk doğrulanırsa silme bildirim kaydına bağlanacak. K-18'in 24 saatlik süresinin yerini alır. | Kesin (2026-10-31), uygulandı |
| K-32 | Yuvarlama (tüm para birimleri) | EUR, TRY ve diğer tüm para birimleri 5'in katına yukarı yuvarlanır. `try_rounding_step` varsayılanı 10'dan 5'e indi. | Kesin (2026-10-31), uygulandı |
| K-33 | Kur kaynağı | Kur elle girilmez. EUR/TRY kuru TCMB günlük kurundan (`ForexSelling`) otomatik alınır, saatlik görev değişince yeni kayıt açar. Kaynağa ulaşılamazsa son kur kalır. Kur rezervasyonda dondurulur. | Kesin (2026-10-31), uygulandı |
| K-34 | MVP dilleri | MVP'de on dilin tamamı (K-26): tr, en, de, ru, fr, es, it, zh, ja, ar. Arapça sağdan sola yazım gerektirir. Şu an web ve mobilde yalnızca tr, en, de, ru var. | Kesin (2026-10-31), geliştirme bekliyor |
| K-35 | VIP Minibüs ayrı araç tipi | Siyah, VIP donanımlı Sprinter `vip_minibus` kodlu dördüncü araç tipi (14 yolcu, 14 bagaj). Fiyat çarpanı 2,40 yer tutucu (minibüs 2,00); admin panelinden değiştirilir. Araç tipleri: minivan, vip_van, minibus, vip_minibus. | Kesin (2026-10-31), uygulandı |
| K-36 | Arayüz dilleri | fr, es, it, zh, ja, ar eklenir (K-34'ün uygulaması). Yasal metinler taslak çeviri olarak, "çeviri doğrulanmadı" notuyla (`legal.translationNotice`) yayımlanır. Sürücü uygulaması Türkçe kalır. | Kesin (2026-11-02), geliştirme bekliyor |
| K-37 | Mobil harita | iOS'ta Apple Maps, Android'de Google (`react-native-maps`). Web önizlemesinde SVG kalır. Backend `route_polyline` döndürür; veritabanı şeması değişmez, Redis'te 24 saat önbelleğe alınır. Fiyat ilçe merkezleriyle hesaplanmaya devam eder. | Kesin (2026-11-02), uygulandı: backend `route_polyline` (Redis 24 saat), mobil `MapCanvas.tsx` native / `MapCanvas.web.tsx` SVG, müşteri rezervasyon detayı ve sürücü yolculuk ekranına bağlandı (D7); Android emülatörde doğrulandı, iOS doğrulaması Mac gerektirir |
| K-38 | Renk tokenları | Tek kaynak kök `DESIGN.md`. `scripts/sync-tokens.mjs` web, admin ve mobil dosyalarını üretir. | Kesin (2026-11-02), geliştirme bekliyor |
| K-39 | Görsel yön | "Kıyı Yolu" (`DESIGN.md`). Kimlik korunur ve cesurlaşır. Animasyon artışı yalnızca web ve müşteri mobilde olur. Admin yoğun ve temel klavye desteğiyle kalır. | Kesin (2026-11-02), geliştirme bekliyor |
| K-40 | Ön yüz test altyapısı | Web ve admin için ESLint + Playwright + axe; mobil için ESLint + jest-expo + RNTL. Kabul ölçütü: P0 ve P1 = 0, axe = 0, critique puanı en az %80. | Kesin (2026-11-02); altyapı kuruldu: web, admin ve mobil (Hat A). Ekran bazlı testler arayüz taramasında yazılacak |
| K-41 | SMS kodu tekrar gönderme beklemesi | Web ve mobilde her başarılı kod isteğinden (ilk gönderim dahil) sonra "Kodu tekrar gönder" 45 sn kapalı kalır ve kalan süreyi metinle söyler. Yalnızca görsel frendir; iş kuralı değildir. Asıl sınır backend'dedir (telefon başına saatte 5 kod, 429 `too_many_requests`); başarısız istek beklemeyi yeniden başlatmaz. Kalan süre saklanan bitiş anından hesaplanır. Gerekçe: art arda basışla saatlik sınırın dolup müşterinin rezervasyon akışından kilitlenmesini önlemek; mobil girişle (`RESEND_SECONDS`) aynı değer. | Kesin (2026-11-02), uygulandı: web `OtpLogin` (B-W3), mobil `login.tsx` |
