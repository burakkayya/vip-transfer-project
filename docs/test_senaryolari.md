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

Ana sayfa ek kontrolleri (B-W1):
- Adres alanı klavyeyle: "antalya hav" yazın, **↓** ve **Enter**; öneri seçilir ve "Fiyat … bölgesine göre hesaplanır" görünür.
- Adres seçmeden **Fiyatları göster**: düğme artık soluk değildir; basınca "Sizi nereden alacağımızı seçin." uyarısı çıkar ve imleç **Nereden** alanına gider. Aynısı `/book` sayfasındaki rota formunda da geçerlidir.
- **Tek yön / Gidiş-dönüş** seçicisinde ok tuşları seçimi değiştirir. Yolcu ve bagaj **−/+** düğmelerinin ekran okuyucu adı "Yolcu sayısını azalt" gibidir.
- İşletim sisteminde "hareketi azalt" açıkken sayfa kaydırılmadan tüm bölümler görünür; kapalıyken giriş sahnesi oynar, "Nasıl çalışır" rayı görününce çizilir, Vito görününce yola girer.

Rezervasyon sihirbazı ek kontrolleri (B-W2):
- Adım göstergesi oturumsuz kullanıcıda dört adımdır (**Araç, Bilgiler, Doğrulama, Onay**) ve telefon doğrulandıktan sonra da dört kalır; oturumla gelen kullanıcı üç adım görür. Telefonda (dar ekran) yalnızca etkin adımın adı yazılır.
- Her adımda **Geri** başlığın sağındadır; **Rotayı değiştir** sonrası **Vazgeç, araçlara dön** önceki rotaya döner.
- **Bilgiler**: ad boşken **Devam** → "Yolcunun adını ve soyadını yazın." ve imleç ad alanına gider. Uçuş numarasına `TK` yazıp **Devam** → alanın altında "Uçuş numarası geçersiz…"; düzeltince kaybolur (`TK12`, `TK1234` geçerlidir).
- **Onay**: üç kutu işaretsiz gelir; ilk ikisi işaretlenene kadar ödeme düğmesi kapalıdır ve yanında nedeni yazar. Kampanya kutusu isteğe bağlıdır. Kartın üstünde iptal kademeleri yazar (48 saat ve üzeri %100, 24-48 saat %50, 24 saatten az iade yok).
- Backend kapalıyken (veya ağ kesikken) araç adımında "Sunucuya ulaşılamadı…" ve **Tekrar dene** görünür; adres aramasında da aynı.

SMS doğrulama ek kontrolleri (B-W3; `/book` Doğrulama adımı ve oturumsuz `/account`, `/data-request`):
- Oturum denetlenirken kısa süre "Oturum denetleniyor…" görünür, boş ekran kalmaz.
- Telefon alanının başında seçili ülkenin kodu (ör. **+90**) yazar; ülke değişince değişir. Numara ülke kodu olmadan yazılır; yine de `+90 532…` yazılırsa kod ikinci kez eklenmez.
- **Kod gönder** her zaman basılabilir; çok kısa numarada alanın altında "Telefon numarasını kontrol edin." çıkar ve imleç alana döner. İstek sürerken düğme "Gönderiliyor…" yazar.
- Kod adımında "Kodu **+90 …** numarasına gönderdik." yazar ve imleç kod alanındadır. Yanlış kod (`000000`) → alanın altında "Kod hatalı veya süresi dolmuş.", imleç koda döner; numara değişmez.
- **Kodu tekrar gönder** ilk gönderimden sonra 45 saniye "… sn sonra tekrar gönderebilirsiniz" diye sayar; süre dolunca basılır ve "Yeni kodu … numarasına gönderdik." yazar, sayaç yeniden başlar.
- **Numarayı değiştir** telefon adımına döner; yazılan numara alanda kalır.
- Türkiye seçiliyken `+49 151 …` yazılırsa kod Almanya numarasına gider ve **Numarayı değiştir** sonrası ülke **Deutschland (+49)** görünür (müşteri ülkesi ve para birimi numarayla tutarlı). `(+90) 532 …`, `0090 532 …` ve `90 532 123 45 67` aynı numaraya (+90 532…) gider. Listede olmayan bir kod (`+81 …`) alan hatası verir.

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
   - Telefonda veya Android emülatöründe (Expo Go) iki ekranın üstündeki harita gerçek haritadır: alış (daire) ile varış (kare) arasındaki rota çizgisi ve sürücü işaretçisi (halka) görünür. Sürücü ekranında işaretçi sürücünün son paylaştığı konumdur. Web önizlemesi (8081/8082) stilize SVG haritayı göstermeye devam eder. Örnek görüntüler: `docs/ui-review/screenshots/after/mobile/android-map-*.png`.
6. Sürücü: **Vardım** → **Yolcu alındı** → **Tamamlandı**. Müşteri tarafında zaman çizelgesi ilerler, sonuç **Tamamlandı**.
7. Sürücü → **Kazanç**: hakediş "Ödeme bekliyor" olarak görünür.

### 4. Anlık rezervasyon ve teklif kabulü
1. Sürücü önizleme: ana ekranda siyah **GO** düğmesine dokunun (çevrimiçi olunca radar animasyonu döner).
2. Mobil müşteri (8081) → **Ana sayfa** → bir havalimanına dokunun → **Ne zaman?** alanında **Şimdi** → **Nereye** → **Fiyatları göster** → ilk araç seçili gelir, alttaki **Minivan seç** → bilgiler → onaylar → öde.
3. Sürücü ekranında geri sayım halkalı siyah **Yeni iş teklifi** kartı görünür (8 sn içinde) → **Kabul et** → yolculuk ekranı açılır. **Karşılama tabelasını aç** yolcu adını tam ekran gösterir.
4. Teklif kartında yolcu adı ve adres gösterilmez; kabulden sonra yolculuk ekranında görünür.

### 5. İptal ve iade
1. 48 saatten uzak bir rezervasyonda **Rezervasyonu iptal et** → "%100 iade" önizlemesi → **İptali onayla**.

   Rezervasyon detayı ek kontrolleri (B-W6; `/bookings/<kod>`):
   - Açılırken önce "Oturum denetleniyor…", sonra "Rezervasyon bilgileri yükleniyor…" görünür; boş ekran kalmaz. Backend kapalıyken "Sunucuya ulaşılamadı…" ve **Tekrar dene**.
   - Başlık kartında kod, durum rozeti ve "Toplam tutar" (API'nin tutarı, tek satır). Bilgi kartında etiketler yazılı: Yolcu, Not, Rezervasyon tarihi; adres satırı "Adres".
   - **Rezervasyonu iptal et** → panel açılır ve odak panel başlığına gider. Panelde "İade tutarı" (API'nin önizlemesi, ör. ₺4.190,00), "Şimdi iptal ederseniz iade oranı %100." ve K-14 kademeleri birebir ("…48 saat veya daha önce iptalde %100, 24-48 saat kala %50 iade yapılır; 24 saatten az kala iade yapılmaz.") + "İptal ve iade politikası" bağlantısı. Ödeme alınmamış rezervasyonda "Bu rezervasyon için ödeme alınmadı, iade yapılmaz."
   - Kırmızı **İptali onayla** ile çerçeveli **Vazgeç** aynı boyuttadır. **Vazgeç** paneli kapatır, odak **Rezervasyonu iptal et**'e döner. Onaylanınca yeşil "Rezervasyon iptal edildi." duyurulur ve odak ona gider; rozet "İptal edildi" olur, `?paid=1` ile gelinmişse "Rezervasyonunuz onaylandı" kutusu kalkar. Çift tıklama tek istek gönderir.
   - Geçersiz kod (`/tr/bookings/ZZZZZZ`, durum 404) veya başkasına ait/olmayan kod: "Rezervasyon bulunamadı" + "Bu koda ait rezervasyon bulunamadı." + **Rezervasyonlarım** / **Yeni rezervasyon** (yeniden deneme yok).
   - Canlı takip (sürücü yoldayken, 5 sn yoklama): konum tazeyken yeşil kutu, nabızlı nokta, "Son güncelleme: SS:DD:ss" ve **Haritada aç**. Backend durdurulursa veya sürücü konum göndermeyi bırakırsa (konum zamanı değişmez) yaklaşık 15 sn sonra kutu kehribara döner (istek asılı kalsa da): "Konum güncellenemiyor", son güncelleme saati yerinde, bağlantı "Son bilinen konumu haritada aç", nokta nabızsız, **Yenile** düğmesi. Backend açılınca kendiliğinden yeşile döner.
   - Rezervasyonlarım (`/tr/bookings`) oturum denetlenirken boş değil, "Oturum denetleniyor…" gösterir.
   - Rezervasyonlarım kod alanı (B-W8): altında "GA ile başlayan 8 karakter; onay SMS'inizde yazar." yazar. "GA12" yazıp **Bul**'a basın (veya oturumsuzken alandan çıkın): "Rezervasyon kodu GA ile başlar ve 8 karakterdir (ör. GA7K3P9Q)." ve odak alana döner. "ga-7k3p 9q" yapıştırılınca "GA7K3P9Q" olur. Rezervasyonu olmayan hesapta "Henüz rezervasyonunuz yok." başlıklı boş durum ve **Yeni rezervasyon**; rezervasyonu olan hesapta "Rezervasyonlarınız" başlıklı liste.
   - Sayfa açılırken konum hiç alınamazsa kutu "Sürücü konumu şu an alınamıyor" değil, kehribar "Konum güncellenemiyor" + **Yenile** gösterir.
   - Rezervasyonlarım listesi alınamazsa (backend kapalı) "Henüz rezervasyonunuz yok" yerine "Sunucuya ulaşılamadı…" + **Tekrar dene**; oturum düşmüşse giriş formu "Oturumunuz sona erdi…" notuyla gelir. Liste satırında güzergâh "Antalya Havalimanı (AYT) → Kemer" biçimindedir.
   - Rezervasyon sihirbazında oturum denetimi ağ hatası verirse adım göstergesi yerine "Sunucuya ulaşılamadı…" + **Tekrar dene** çıkar; **Devam et** müşteriyi doğrulama adımına göndermez, hatayı formda gösterir. Onay adımında oturum düşerse doğrulama adımı "Oturumunuz sona erdi…" ile açılır. Onay adımındaki yasal bağlantılar ekran okuyucuda "(yeni sekmede açılır)" der; ödeme düğmesi kapalıyken nedeni düğmeye bağlıdır.
   - İptal onayında ağ hatası olursa kırmızı uyarı panelin içinde, **İptali onayla** düğmesinin hemen üstünde görünür.
2. 24 saatten yakın bir rezervasyon için admin → **Rezervasyonlar** → detay → İptal bölümünde gerekçe yazın, iade oranını boş bırakın: %0 uygulanır. Oranı 100 yazarak operasyonel iptal (tam iade) deneyin.
3. Admin → **Ödemeler ve iadeler**: iade kayıtları.

### 6. Başarısız ödeme
1. Ödeme ekranında sahte sayfada **Reddet** → "Ödeme tamamlanamadı. Kart bilgilerinizi kontrol edip…" (kırmızı uyarı; tutar ve özet yerinde kalır) → siyah **Tekrar dene** → **Ödemeyi onayla**.

Ödeme ekranı ek kontrolleri (B-W4; `/bookings/<kod>/pay`):
- Açılırken önce "Oturum denetleniyor…", sonra "Rezervasyon bilgileri yükleniyor…", ardından "Güvenli ödeme sayfası hazırlanıyor…" görünür; boş ekran kalmaz.
- Özet kartında ödenecek tutar (API'nin tutarı, tek satır), rezervasyon kodu, güzergâh ve alış tarihi; altında kilit simgesiyle kart bilgisi notu ve saat simgesiyle "Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir." yazar.
- Sahte ödeme sayfası açıkken üstünde "Ödemeniz bekleniyor. Onaylandığında bu sayfa kendiliğinden ilerler." yazar; bu sırada **Tekrar dene** düğmesi yoktur (açık ödeme sayfası sıfırlanmaz).
- Backend kapalıyken (veya ağ kesikken) sayfa "Sunucuya ulaşılamadı…" ve **Tekrar dene** gösterir; backend açılıp düğmeye basınca ödeme sayfası gelir.
- Sahte sayfada **Ödemeyi onayla** sonrası bildirim gecikirse "Ödemeniz onaylanıyor…" görünür (sayfa yoklamaya devam eder, onay gelince detaya geçer). 75 saniye içinde onay gelmezse sarı uyarı ile **Durumu yenile** ve **Ödemeye dön** çıkar; **Ödemeye dön** adresten `result`'ı kaldırıp yeni ödeme sayfası açar. Denemek için: tarayıcıda `/tr/bookings/<ödeme bekleyen kod>/pay?result=ok` açın.
- Ödeme sayfası açıkken backend durdurulursa (veya istek asılı kalırsa) birkaç saniye sonra "Otomatik güncelleme durdu…" ve **Durumu yenile** görünür; ödeme sayfası kapanmaz.
- Ödeme sayfası açıkken oturum düşerse (ör. başka sekmede çıkış yapılırsa) ödeme sayfası yerinde kalır; üstünde "Oturumunuz sona erdi. Ödemeyi tamamladıysanız durumu, yeniden giriş yaptıktan sonra görürsünüz." ve **Yeniden giriş yap** çıkar. Basıp giriş yapınca yeni ödeme sayfası açılmaz: "Önceki ödemenizin sonucu denetleniyor…" ve **Ödemeye dön** görünür; ödeme onaylanınca detaya geçilir (K-45). Ödeme sayfası açık değilken oturum düşerse SMS girişi "Oturumunuz sona erdi…" notuyla gelir.
- Hesabım (B-W9): yeni hesapta "Kampanya ve fırsat iletileri almak istiyorum." kutusu işaretsizdir. İşaretleyince "Tercihiniz kaydedildi. Kampanya iletileri açık.", kaldırınca "… kapalı." görünür; sayfa yenilenince seçim korunur. Backend kapalıyken kutuya basılırsa kutu değişmez ve onay kartında "Tercihiniz kaydedilemedi. …" çıkar. Profil yüklenirken "Hesap bilgileriniz yükleniyor…"; **Kaydet** sırasında "Kaydediliyor…", sonra "Kaydedildi.".
- Veri talebi (B-W10, `/tr/data-request`): "Talep türü" altında üç seçenek görünür ve hiçbiri seçili değildir. Seçmeden **Talebi gönder** → "Talep türünü seçin." ve odak ilk seçeneğe. Bir tür seçip gönderin: düğme "Gönderiliyor…" olur, sonra "Talebiniz alındı. Son tarih: …" ve talep "Taleplerim" listesinde "Açık" rozetiyle görünür; seçim ve not temizlenir. Talebi olmayan hesapta "Henüz bir talebiniz yok."; backend kapalıyken listede "Sunucuya ulaşılamadı…" + **Tekrar dene** (form yine kullanılabilir).
- İnternet kesikken ödeme, detay, Rezervasyonlarım, Hesabım sayfaları SMS girişi değil "Sunucuya ulaşılamadı…" ve **Tekrar dene** gösterir; bağlantı gelince **Tekrar dene** ile sayfa açılır ve odak sayfa başlığına gider. Sunucu 15 sn içinde yanıt vermezse aynı hata çıkar.
- Ödeme sayfası 45 sn içinde açılamazsa önce rezervasyon yeniden okunur: ödenmişse detaya geçilir, değilse "Ödeme sayfası zamanında açılamadı…" + **Tekrar dene**. Onay adımında rezervasyon oluşturma 45 sn içinde yanıt vermezse ödeme düğmesi kapanır ve "…oluşmuş olabilir. Yeniden göndermeden önce Rezervasyonlarım'a bakın." + **Rezervasyonlarım** bağlantısı çıkar.
- Var olmayan veya başkasına ait kodun ödeme adresi "Rezervasyon bulunamadı" + **Rezervasyonlarım** / **Yeni rezervasyon** gösterir.
- **Tekrar dene**'ye çift tıklamak tek bir ödeme sayfası açar.
- İptal edilmiş bir rezervasyonun ödeme adresi açılırsa "Bu rezervasyon iptal edildi" ile **Yeni rezervasyon** ve **Rezervasyonu görüntüle** görünür; ödenmiş rezervasyonda "Ödemeniz alındı…" yazar ve detaya geçilir.

Ödeme sonucu geçiş ekranı (B-W5; `/booking/payment-result`):
- Sahte sağlayıcıda **Ödemeyi onayla** veya **Reddet** sonrası sayfa kısa süre "Ödeme sonucu alınıyor…" (başlık "Ödeme") gösterir, sonra ödeme ekranına döner; boş sayfa görünmez.
- Adresi doğrudan açmak (`/tr/booking/payment-result?status=ok`) bekleyen rezervasyon yoksa Rezervasyonlarım'a, varsa ilgili rezervasyonun ödeme ekranına götürür.
- Yönlendirme 8 saniyeden uzun sürerse (ağı yavaşlatın) "Yönlendirme beklenenden uzun sürüyor…" notu ve "Rezervasyonlarım" bağlantısı çıkar. Dört dilde (tr, en, de, ru) denenebilir.

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
- **Lint**: `npm run lint` (`web`, `admin`, `mobile`). Taban çizgisindeki bilinen ihlaller nedeniyle sıfırdan farklı çıkış beklenir (web 3 hata/1 uyarı, admin 1/2, mobil 7/2; `docs/ui-review/lint-taban.md`); sayılar artmamalıdır.
- **Web ortak dosyalar** (`cd web && npx playwright test shared`, iki proje): üst bilgide axe ihlali yok, eşleşmeyen adres (`/tr/yok`) yerel 404 çizer (`html[lang=tr]`, `h1` "404", durum 404, üst bilgi ve "Ana sayfaya dön"), Tab ile odaklanan düğmede 2 px lake siyah halka, yer tutucunun gerçek zemine karşı WCAG kontrastı dinlenme ve üzerine gelme halinde ≥ 4,5 (ana sayfa adres alanı, rezervasyon kodu alanı), 390 px'te açık mobil menü Esc ile kapanır ve odak menü düğmesine döner, hareket azaltmada adım çizgisi dolu. Geliştirme sunucusunda kararlı sonuç için `--workers=1`.
- **Mobil birim testleri**: `cd mobile && npm test` (jest-expo + React Native Testing Library; şimdilik `ui.tsx` için 2 test).
- **Kök betik testleri**: `node --test "scripts/*.test.mjs"` (renk tokenı üreticisi, 5 test). Token kaynağı ile üretilmiş dosyaların uyumu: `node scripts/sync-tokens.mjs --check`.
- **Ekran görüntüsü ve axe betikleri**: `scripts/ui-shots` (`npm ci`, sonra `node web.js --out after` vb.; ayrıntı `scripts/ui-shots/README.md`). Geliştirme veritabanında rezervasyon ve sahte ödeme oluşturur.
