# Ekranlar

## Müşteri web sitesi (çok dilli)

1. Ana sayfa ve hizmet anlatımı
2. Fiyat hesaplama: rota, araç tipi, tek yön veya gidiş-dönüş, anlık fiyat
3. Rezervasyon: rota ve tarih, uçuş bilgisi (opsiyonel), yolcu ve bagaj, garanti seçimi
4. Telefon ile OTP doğrulama (hızlı üyelik)
5. KVKK aydınlatma ve onay ekranı, mesafeli satış ön bilgilendirme
6. Ödeme (PayTR, yedek iyzico)
7. Rezervasyon onayı ve özet
8. Rezervasyon sorgulama (kod ve telefon ile giriş)
9. Rezervasyon detayı ve iptal. Rezervasyon değişikliği ekranı yok: değişiklik e-postayla (info@getawaytransfers.com, rezervasyon koduyla) istenir.
10. Sabit sayfalar: iptal ve iade politikası, KVKK aydınlatma, mesafeli satış, çerez, veri talep formu
11. Hesabım (`/account`): profil ve pazarlama onayı
12. Ödeme sonucu (`/booking/payment-result`): ödeme penceresinden çıkaran görünmez yönlendirme
13. 404 sayfası

## Müşteri mobil uygulaması (iOS ve Android)

1. Giriş: telefon ile OTP
2. Rezervasyonlarım ve detaylar
3. Yeni rezervasyon (web ile aynı akış)
4. Aktif yolculukta sürücü canlı takibi
5. Rezervasyon iptali. Değişiklik e-postayla istenir (ekran yok)
6. Profil, pazarlama tercihi (push bildirim tercihi FCM bekliyor), veri talebi

## Sürücü mobil uygulaması

1. Kayıt ve belge yükleme
2. Onay bekleme ve belge durumu
3. Ana ekran: çevrimiçi ve çevrimdışı geçişi, yaklaşan işler
4. İş teklifi kabul veya red
5. Yolculuk akışı: yola çıktım, vardım, yolcu alındı, tamamlandı
6. Navigasyon bağlantısı ve yolcu karşılama bilgisi
7. Kazanç özeti ve hakediş geçmişi
8. Belge takibi ve süre uyarıları
9. Canlı konum paylaşımı (aktif yolculukta)

## Admin paneli (web)

Toplam 23 rota (ekran). Aşağıdaki liste işlevsel gruplamadır.

1. Giriş ve 2FA
2. Genel panel: durum sayaçları ve OpenStreetMap bağlantısı (canlı harita yok)
3. Rezervasyonlar: liste, detay, durum değişikliği, manuel atama
4. Eşleştirme: bekleyen işler ve uygun sürücüler
5. Sürücüler: başvuru kuyruğu, onay ve red, belge inceleme, askıya alma
6. Araçlar ve araç tipleri
7. Belge takibi: süresi yaklaşanlar ve dolanlar
8. Bölgeler: ilçe ve havalimanı yönetimi
9. Fiyatlandırma: fiyat kuralları, gidiş-dönüş indirimi, iptal politikaları
10. Komisyon kuralları
11. Ödemeler ve iadeler
12. Sürücü hakedişleri ve ödeme dosyaları
13. Faturalar
14. Müşteriler (hassas alanlar maskeli)
15. Bildirim şablonları
16. KVKK veri talepleri
17. Kullanıcılar ve roller
18. Denetim kayıtları (filtrelenebilir)
19. Sistem ayarları
20. Kurlar (`/exchange-rates`): TCMB kuru ve elle giriş
21. Hesabım (`/account`): parola değiştirme
22. Rezervasyon detayı (`/bookings/[id]`)
23. Sürücü detayı (`/drivers/[id]`)
