# Karar Kaydı

Her karar tarih, konu ve kısa gerekçe ile tutulur. Değiştirilen kararlar silinmez, "Durum: değiştirildi" olarak işaretlenir.

| No | Konu | Karar | Durum |
|---|---|---|---|
| K-01 | Sürücü modeli | Sürücüler TÜRSAB onaylı, yetkili ve belgeleri sisteme kayıt sırasında kontrol edilen bağımsız ortaklardır. | Kesin |
| K-02 | Komisyon | Örnek: 60 € fiyattan sürücüye 45 € (%25 komisyon). Oran sistemde değiştirilebilir parametredir. | Kesin |
| K-03 | Fiyat formülü | Mesafe (km) x 1,10 € x araç tipi çarpanı, ardından minimum 30 € kontrolü. | Kesin |
| K-04 | Yuvarlama | Fiyatlar 5'in katına yuvarlanır (örnek: 167,30 → 170 €). | Kesin |
| K-05 | Taksimetre | Taksimetre kullanılmaz, fiyat rezervasyon anında hesaplanır ve önceden tahsil edilir. | Kesin |
| K-06 | Bölge | Antalya ve Muğla'nın tüm ilçeleri ve havalimanları. Şehirlerarası transfer dahil. | Kesin |
| K-07 | Rezervasyon türleri | Hem anlık eşleştirme hem planlı rezervasyon. | Kesin |
| K-08 | Gidiş-dönüş | İndirim uygulanır, yüzde veya sabit tutar olarak tanımlanabilir. | Kesin |
| K-09 | Araç kullanımı | Araçlar günlük de kiralanabilir. | Kesin (MVP dışı olabilir, bkz. mvp_plani.md) |
| K-10 | Ödeme modeli | Ön ödeme. Sürücü ödemeleri otomatik hakediş ile yapılır. | Kesin |
| K-11 | Ödeme sağlayıcı | Birincil PayTR, yedek iyzico. Müşteri para biriminde tahsilat. | Kesin, sözleşme teyidi bekliyor |
| K-12 | Havale/EFT | Kabul edilmez. | Kesin |
| K-13 | Para birimi | Avrupa ülkeleri EUR, Türkiye TRY, diğer ülkeler EUR. Kur farkı şirkete yansımaz (EUR tahsil, TRY ödeme akışı). | Kesin |
| K-14 | İptal politikası | 48 saat ve üzeri %100 iade, 24-48 saat arası %50 iade, 24 saatten az %0. | Kesin |
| K-15 | Tam iade garantisi | İlk sürüme dahil edilecek. Hukuki yapı (sigorta mevzuatı) doğrulanmadan satışa açılmayacak. | Hukuki teyit bekliyor |
| K-16 | Üyelik | Misafir rezervasyon yok. OTP ile hızlı üyelik (sadece telefon ve SMS kodu, şifre yok). | Kesin |
| K-17 | Kişisel veri | Pasaport bilgisi sistemde tutulmaz, yalnızca kurumlara iletilir. Kart verisi tutulmaz. | Kesin |
| K-18 | Uçuş verisi | Uçuş numarası, planlanan ve gerçek iniş saati. Yolculuktan 24 saat sonra silinir. | Kesin, hukuki teyit bekliyor |
| K-19 | Veri merkezi | Ana altyapı Türkiye'de. Yurt dışı servisler minimum veriyle kullanılır. | Kesin |
| K-20 | Teknoloji | Backend Python (FastAPI), PostgreSQL + PostGIS, Redis, Web Next.js, Mobil Expo (React Native). | Kesin |
| K-21 | Admin rolleri | Veritabanında rol yapısı kurulur. İlk kullanıcılar tam yetkili admin olur. | Kesin |
| K-22 | Admin güvenliği | Her admin kendi hesabıyla girer, giriş 2FA zorunlu. | Kesin |
| K-23 | Sürücü uygulaması | MVP'de olacak (mobil). | Kesin |
| K-24 | Müşteri uygulaması | MVP'de olacak (iOS/Android). | Kesin |
| K-25 | Domain | Kayıt Turhost'ta kalır. DNS Cloudflare'e taşınır (zamanı gelince). | Kesin |
| K-26 | Diller | Almanca, Rusça, İngilizce, Fransızca, İspanyolca, İtalyanca, Çince, Japonca, Türkçe, Arapça. | Kesin, MVP sırası açık (bkz. mvp_plani.md) |
| K-27 | Mevzuat | TÜRSAB, turizm taşımacılığı yetki belgesi, KVKK, GDPR, Mesafeli Sözleşmeler Yönetmeliği, e-Arşiv. | Hukuki doğrulama bekliyor |
| K-28 | Adres ve fiyat | Adres Google Places ile aranır (backend üzerinden, anahtar istemciye verilmez). Fiyat, adresin bağlı olduğu ilçeler arası mesafeyle hesaplanır, aynı ilçe içinde gerçek mesafe. Bkz. fiyatlandirma.md. | Kesin (2026-10-29) |
