# Ekrandan test senaryoları

Tüm akışlar geliştirme ortamında, VS Code içinden, gerçek SMS, ödeme veya Google anahtarı olmadan denenebilir.

## Hazırlık (bir kez)

1. Docker Desktop açık olsun.
2. VS Code: `Ctrl+Shift+P` → **Tasks: Run Task** → **Getaway: Veritabanı ve Redis (Docker)**.
3. **Getaway: Veritabanını hazırla (migration + seed + demo)**. Bölgeler, araç tipleri, fiyat kuralları, iki onaylı demo sürücü ve EUR/TRY kuru yüklenir.
4. **Getaway: Tümünü başlat**. Backend, iş kuyruğu, web, admin ve iki mobil önizleme ayrı terminallerde açılır.

Ekranları VS Code içinde açmak için: `Ctrl+Shift+P` → **Simple Browser: Show** → adresi yazın. Birden çok adres için komutu tekrarlayın; sekmeleri yan yana bölebilirsiniz (ör. solda müşteri, sağda sürücü).

| Ekran | Adres |
|---|---|
| Müşteri web sitesi | http://localhost:3000 |
| Admin paneli | http://localhost:3001 |
| Mobil müşteri (telefon çerçeveli önizleme) | http://localhost:8081 |
| Mobil sürücü (telefon çerçeveli önizleme) | http://localhost:8082 |
| API belgeleri | http://localhost:8000/docs |

### Android emülatörü

Mobil uygulamaları gerçek Android ortamında görmek için: **Getaway: Android emülatörünü aç** → **Getaway: Mobil müşteri (Android emülatör)** ve/veya **Getaway: Mobil sürücü (Android emülatör)**. Senaryolardaki 8081/8082 adımları emülatörde de aynen yapılabilir.

## Test hesapları ve kolaylıklar

| Rol | Giriş |
|---|---|
| Müşteri | Herhangi bir telefon numarası. SMS kodu ekranda sarı kutuda görünür (yalnızca geliştirme), tıklayınca alana dolar. |
| Demo sürücü 1 | +90 530 000 00 01, Mehmet Demir, Minivan (Vito), 07GA001 |
| Demo sürücü 2 | +90 530 000 00 02, Ayşe Kaya, VIP Van (V-Class), 48GA002 |
| Admin | ebkaya.0637@gmail.com. Parola repoya yazılmaz, sohbette iletilen geçici parola kullanılır (2026-10-31'de sıfırlandı, 2FA yeniden kuruldu). İlk girişte doğrulama uygulamasıyla (Google/Microsoft Authenticator) QR okutulur, sonra **Parolamı değiştir**. |

- **Adres araması:** Google anahtarı yokken örnek yerler kullanılır: Antalya Havalimanı, Kaleiçi, Lara, Rixos Downtown, Belek, Side, Kleopatra Plajı (Alanya), Kemer Marina, Kaş, Kalkan, Bodrum Marina, Turgutreis, Ölüdeniz, Fethiye, Göcek, Marmaris, Dalyan, Taksim (hizmet dışı).
- **Ödeme:** iFrame içinde sahte ödeme sayfası açılır, **Ödemeyi onayla** veya **Reddet** seçilir.
- **Konum:** Sürücü önizlemesinde GPS yoksa yolculuk ekranında **Geliştirme: konum gönder** düğmesi alış noktası çevresinde konum yollar.

## Senaryolar

### 1. Adresle rezervasyon ve ödeme (web)
1. http://localhost:3000 → **Nereden**: "antalya hav" yazın, **Antalya Havalimanı (AYT)** seçin.
2. **Nereye**: "belek" yazın, **Belek Turizm Merkezi** seçin. Alanın altında "Fiyat Serik bölgesine göre hesaplanır" görünür.
3. Tarihi en az 2 saat sonraya ayarlayın → **Fiyatları göster**.
4. Araç seçin → yolcu adı, isteğe bağlı uçuş no (TK1234) → **Devam**.
5. Telefon girin → sarı kutudaki koda tıklayın → **Doğrula**.
6. İki onay kutusunu işaretleyin → **Rezervasyonu oluştur ve öde** → sahte sayfada **Ödemeyi onayla**.
7. Beklenen: "Rezervasyonunuz onaylandı", durum **Onaylandı**.

### 2. İlçe bazlı fiyat kontrolü
1. Senaryo 1'in ilk adımını **Kalkan** ve ardından **Kaş Merkez** ile tekrarlayın. İkisi de Kaş ilçesinde olduğu için fiyat aynıdır.
2. **Kaleiçi → Lara** (ikisi de Muratpaşa): aynı ilçe içinde gerçek mesafe kullanılır, minimum fiyat çıkar.
3. **Taksim**: "Bu adres hizmet alanımızın dışında" hatası.

### 3. Planlı işte manuel atama ve yolculuk (admin + sürücü + müşteri)
1. Admin → **Eşleştirme**: Senaryo 1'deki iş listede → **Sürücü seç** → Mehmet Demir → **Ata**.
2. Müşteri web → **Rezervasyonlarım** → rezervasyon: sürücü adı, araç ve plaka görünür.
3. Sürücü önizleme (8082) → demo sürücü 1 ile giriş → **Yaklaşan işler** → işe dokunun.
4. **Yola çıktım** → **Geliştirme: konum gönder** (birkaç kez).
5. Müşteri web veya mobil (8081) rezervasyon detayı: "Canlı takip" kutusu ve konum bağlantısı görünür (web 5 sn, mobil WebSocket).
6. Sürücü: **Vardım** → **Yolcu alındı** → **Tamamlandı**. Müşteri tarafında zaman çizelgesi ilerler, sonuç **Tamamlandı**.
7. Sürücü → **Kazanç**: hakediş "Ödeme bekliyor" olarak görünür.

### 4. Anlık rezervasyon ve teklif kabulü
1. Sürücü önizleme: ana ekranda siyah **GO** düğmesine dokunun (çevrimiçi olunca radar animasyonu döner).
2. Mobil müşteri (8081) → **Ana sayfa** → bir havalimanına dokunun → **Ne zaman?** alanında **Şimdi** → **Nereye** → **Fiyatları göster** → ilk araç seçili gelir, alttaki **Minivan seç** → bilgiler → onaylar → öde.
3. Sürücü ekranında geri sayım halkalı siyah **Yeni iş teklifi** kartı görünür (8 sn içinde) → **Kabul et** → yolculuk ekranı açılır. **Karşılama tabelasını aç** yolcu adını tam ekran gösterir.
4. Teklif kartında yolcu adı ve adres gösterilmez; kabulden sonra yolculuk ekranında görünür.

### 5. İptal ve iade
1. 48 saatten uzak bir rezervasyonda **Rezervasyonu iptal et** → "%100 iade" önizlemesi → **İptali onayla**.
2. 24 saatten yakın bir rezervasyon için admin → **Rezervasyonlar** → detay → İptal bölümünde gerekçe yazın, iade oranını boş bırakın: %0 uygulanır. Oranı 100 yazarak operasyonel iptal (tam iade) deneyin.
3. Admin → **Ödemeler ve iadeler**: iade kayıtları.

### 6. Başarısız ödeme
1. Ödeme ekranında sahte sayfada **Reddet** → "Ödeme tamamlanamadı" → **Tekrar dene** → **Ödemeyi onayla**.

### 7. Yeni sürücü başvurusu ve belge onayı
1. Sürücü önizleme → çıkış → yeni bir numarayla giriş → **Sürücü kaydı** formu.
2. **Belgeler** sekmesi: sürücü belgeleri için PDF/JPEG yükleyin, **Araç ekle** ile araç ekleyip araç belgelerini yükleyin.
3. Admin → **Sürücüler** (Başvuru) → sürücü → belgeleri **Görüntüle**, geçerlilik tarihiyle **Onayla** → sürücüyü **Onayla**, aracı **Aktif** yapın.
4. Sürücü ana ekranında durum **Onaylı** olur, çevrimiçi anahtarı görünür.
5. Admin → **Belge takibi**: süresi yaklaşan belgeler burada listelenir.

### 8. Hakediş ve banka dosyası
1. Senaryo 3 tamamlandıktan sonra admin → **Sürücü hakedişleri** → **Ödeme kayıtlarını oluştur**.
2. **Banka dosyası (CSV)** indirin → kayıtta dekont no yazıp **Ödendi**.
3. Sürücü → **Kazanç**: kayıt **Ödendi** olur.

### 9. KVKK veri talebi
1. Müşteri web → **Hesabım** → **Veri talep formu** → "Verilerimin silinmesi" → gönder.
2. Admin → **KVKK veri talepleri** → **İşleme al** → **Tamamla**. Silme için admin → **Müşteriler** → **Verileri sil** (aktif rezervasyonu olmayan müşteride).

### 10. Roller ve 2FA
1. Admin → **Kullanıcılar ve roller** → yalnızca "Muhasebe" rolüyle kullanıcı oluşturun.
2. Gizli pencerede http://localhost:3001 → yeni kullanıcıyla giriş, QR kurulumu → menüde yalnızca finans ekranları görünür.
3. Admin → **Denetim kayıtları**: giriş, oluşturma ve belge görüntüleme kayıtları.

### 11. Fiyat kuralı sürümleme
1. Bir rezervasyonun tutarını not edin.
2. Admin → **Fiyatlandırma** → Minivan için km fiyatı 1,30 olan yeni kural ekleyin.
3. Web'de aynı rotada yeni fiyat yükselir; eski rezervasyonun tutarı değişmez.
4. Gidiş-dönüş indirimi varsayılan olarak %5'tir (K-30). Web'de gidiş-dönüş seçip toplamın iki tek yönün toplamından %5 az (5'in katına yuvarlı) olduğunu kontrol edin. Admin → Fiyatlandırma'dan değiştirilebilir.

### 12. Para birimi
1. Web'de bilgiler adımında ülkeyi **Türkiye** seçin: fiyatlar TL olur (admin → Döviz kuru; kur TCMB'den saatlik otomatik gelir, K-33). Diğer ülkelerde EUR. Tüm fiyatlar 5'in katıdır (K-32).

### 13. Dil
1. Web üst menüden dili değiştirin (şu an TR, EN, DE, RU; hedef on dil, K-34). Mobil müşteri uygulaması cihaz (tarayıcı) diline göre açılır.

## Otomatik testler

- **Getaway: Backend testleri**: iş kuralları, API, adres ve ilçe çözümleme, ödeme, eşleştirme ve WebSocket.
- **Getaway: Tip denetimi (web, admin, mobil)**.
- **Web ve admin Playwright + axe** (`web`: `npm run test:e2e` 3000'de; `admin`: `npm run test:e2e` 3001'de çalışan sunucuya karşı). Admin testleri için yerelde ayrı bir e2e admin hesabı kullanılır; e-posta, parola ve TOTP sırrı yalnızca git'e girmeyen `admin/.env.e2e.local` dosyasındadır (`ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD`, `ADMIN_E2E_TOTP_SECRET`; sır ilk girişte otomatik yazılır). Değerler yoksa oturum isteyen testler atlanır.
