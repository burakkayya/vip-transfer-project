# Açık Konular

Bu liste doğrulanmadan ilgili geliştirme veya satış başlatılmamalıdır.

## Ödeme

- [ ] PayTR: EUR tahsilatının EUR olarak şirket hesabına geçtiğinin yazılı teyidi.
- [ ] PayTR: alt üye işyeri veya dağıtım (split) özelliğinin açılma koşulları ve sürücülere TL aktarım modeli.
- [ ] iyzico: yedek olarak hangi para birimlerini desteklediği ve kesinti senaryosunda davranışı.
- [ ] Yurt dışı kart komisyonları ve iade komisyonları.

## Hukuki

- [ ] TÜRSAB üyeliği ile hizmetin satış modelinin doğrulanması.
- [ ] Sürücü ve araç yetki belgelerinin sisteme bağlanma şekli.
- [ ] Tam iade garantisinin sigorta mevzuatı kapsamında değerlendirilmesi.
- [ ] Cayma hakkı istisnası ile iptal kademelerinin uyumu.
- [ ] Uçuş verisinin yolculuk tamamlanınca silinmesinin (K-31) KVKK açısından teyidi ve kuruma bildirim gerekip gerekmediği.
- [ ] Pasaport bilgisinin hangi kurumlara, hangi durumda iletileceği.
- [ ] Veri saklama süreleri (bkz. yasal_ve_guvenlik.md).

## Ürün

- [ ] Araç tipleri ve çarpanları (minivan, VIP van, minibüs, VIP minibüs).

## Teknik

- [ ] Yurt dışı servislerde veri bölgesi (Sentry, e-posta).
- [ ] Uçuş takip API'sinin seçimi ve maliyeti.
- [ ] Sitedeki "uçuş takibi / sürücü iniş saatinizi takip eder" ifadesi ile kod arasındaki fark: şimdilik yalnızca uçuş numarası saklanıyor, uçuş takip API'si yok. API seçilene kadar ifade yumuşatılmalı veya API bağlanmalı. **Kullanıcı kararı bekliyor** (B-W1 metne dokunmadı): ana sayfada `home.why3Title/why3Text` (güven şeridi), `home.s1Text` (hizmet kartı), `home.faq2a` (SSS), `home.flightTag` (giriş görseli etiketi) ve `home.trust2` (havalimanları bölümü alt metni), dört dilde.
- [ ] ARQ işçisi (`arq app.worker.WorkerSettings`) 2026-11-02 taban çizgisinde çalışmıyordu. Saatlik kur güncelleme ve uçuş verisi silme gibi zamanlanmış görevler işçi çalışmadan işlemez; geliştirmede ayrıca başlatılmalı, üretimde süreç yöneticisiyle ayakta tutulmalı.
- [ ] CI kapsamı (`.github/workflows/ci.yml`, 2026-11-08): web ve admin Playwright + axe testleri ile `next build` henüz CI'da yok (çalışan backend, seed ve sunucu ister). İlk CI koşusu GitHub'da henüz görülmedi; Linux'ta `pip install` çözümü yerelde denenemedi.
- [ ] Manuel rezervasyon (K-54): sürücüye nakit ödeme (yolcunun parayı sürücüye vermesi) desteklenmiyor; gerekirse sürücü hakedişinden mahsup modeli tasarlanmalı. WhatsApp Business API ile otomatik mesaj gönderimi yok (metin elle kopyalanır). Havale/EFT ile alınan tahsilatın fatura ve muhasebe akışı (e-Arşiv) ile mutabakatı doğrulanmalı. Ödeme bağlantılı SMS metni (`booking_created_admin`) hukuk ve ileti izni (İYS) açısından kontrol edilmeli.
- [ ] Sohbet ve yeniden atama (K-50): atanmış iş başka sürücüye devredilirse yeni sürücü önceki sürücünün müşteriyle yazışmasını görür. Devirde eski yazışmanın yeni sürücüden gizlenmesi değerlendirilmeli (admin incelemesinde mesajı yazan sürücü doğru görünür, 0006).
- [ ] Google Routes maliyet tahmini ve gerekirse OSRM ile self-host kararı.

## Geliştirme sırasında ortaya çıkanlar

Kodda geçici varsayımla çözüldü. Teyit sonrası güncellenmeli.

- [ ] TCMB satış kuru (`ForexSelling`) yerine alış kuru veya efektif kur mu kullanılacak, kura marj eklenecek mi. Şimdilik satış kuru, marj yok (K-33). Admin panelindeki elle kur girişi acil durum yedeği olarak duruyor; kullanım dışı bırakılabilir.
- [ ] Sürücü hakedişinde EUR→TRY kuru: iş tamamlandığı andaki kur mu, ödeme günündeki kur mu? Şimdilik tamamlanma anındaki kur kullanılıyor.
- [ ] Zorunlu belge listesi: sürücü için sürücü belgesi, SRC ve adli sicil; araç için ruhsat, sigorta, muayene ve turizm taşımacılığı yetki belgesi. Liste `system_settings` üzerinden değiştirilebilir, hukukçuyla teyit edilmeli.
- [ ] Gazipaşa-Alanya Havalimanı (GZP), K-06 kapsamında aktif olarak eklendi. is_modeli.md'de yalnızca üç havalimanı geçiyor.
- [ ] Araç tipleri ve çarpanları yer tutucu: minivan 1,30, VIP van 1,60, minibüs 2,00, VIP minibüs 2,40. Sedan hizmetten kaldırıldı (2026-10-29), eski kayıtlar için pasif tutuluyor.
- [ ] PayTR imza formülleri test mağazasında doğrulanmalı (iFrame token, bildirim hash'i, iade).
- [ ] iyzico yedek sağlayıcısı henüz kodlanmadı. Para birimi desteği teyit edilince eklenecek.
- [ ] Netgsm API'si güncel belgeyle doğrulanmalı, uluslararası SMS yetkisi kontrol edilmeli.
- [x] FCM push gönderimi (K-56, 2026-11-09): Android uygulama kapalıyken bildirim. Kalan: iOS için APNs anahtarı (Apple Developer hesabı), canlı sunucuda servis hesabı dosyası ve `GETAWAY_PUSH_PROVIDER=fcm`, `push_token` için (tablo, jeton) benzersiz kısmi indeks (migration; şu an uygulama düzeyinde tek hesap), çevrimdışı çıkışta jeton hesapta kalabilir (bir sonraki girişte başka hesap bağlarsa düzelir), push gönderim kuyruğu süreç içi iş parçacığıdır (sunucu yeniden başlarken bekleyen birkaç gönderim kaybolabilir; uygulama içi akış etkilenmez).
- [ ] e-Arşiv entegratörü seçimi. Fatura kaydı oluşuyor ancak kesim yapılmıyor.
- [ ] Belge depolama: şimdilik yerel diskte şifreli tutuluyor, Türkiye'deki S3 uyumlu depolamaya geçilecek.
- [ ] Müşteri silme talebinde rezervasyon ve fatura kayıtlarının saklama süresi. Şimdilik kişisel alanlar siliniyor, kayıtlar saklanıyor.
- [ ] Web yasal metinleri (KVKK aydınlatma, mesafeli satış ön bilgilendirme, iptal, çerez) taslak. Şirket unvanı, adres, TÜRSAB ve MERSİS no `web/lib/site.ts` içinde yer tutucu. Hukukçu onayından sonra sayfalardaki "taslak" uyarısı kaldırılacak.
- [ ] Google Maps API anahtarı (Places API New + Routes API) açılmalı, IP ile kısıtlanmalı ve bütçe uyarısı konmalı. 2026-11-10'dan beri anahtar yokken OpenStreetMap kullanılır (K-58): adres araması Photon, karayolu rotası ve mesafe OSRM (herkese açık sunucular, adil kullanım sınırlı). Canlıya çıkmadan Google anahtarları veya kendi barındırdığımız Photon/OSRM kurulmalı; OSRM'e ulaşılamazsa fiyat kuş uçuşu x 1,30 yedeğiyle hesaplanır (o anki teklif biraz farklı çıkabilir).
- [ ] Adres aramasında kullanıcının yazdığı adres metni Google'a veya (anahtar yokken, K-58) OpenStreetMap Photon'a, rota için koordinatlar OSRM'e, Android haritası anahtarsızken harita karoları için OpenStreetMap'e (yurt dışı) gider. Aydınlatma metninde (`yasal_ve_guvenlik.md`) bu servisler belirtilmeli, KVKK açısından hukukçuyla teyit edilmeli.
- [x] ~~İlçe bazlı fiyatta büyük ilçelerde ilçe merkezine uzak adresler için ek mesafe kuralı~~ (2026-11-10, K-58: fiyat artık gerçek noktalar arası mesafeyle hesaplanıyor).
- [ ] Canlı etkinlik (K-59): uygulama tamamen kapalıyken (sürücüde yolculuk dışında, müşteride uygulama hiç açılmadan) durum güncellenmez; iOS'ta APNs ile Canlı Etkinlik uzaktan güncellemesi (`enablePushNotifications`, Apple Developer hesabı ve APNs anahtarı), Android'de FCM veri mesajıyla bildirimi güncelleme yazılmalı. Müşteri tarafında etkinlik rezervasyon ekranı açıldığında başlar; ödemeden sonra uygulama oraya yönlendirdiği için pratikte hep başlar.
- [ ] Admin iade (K-57): elle tahsilat (havale/nakit) iadesi beklemede kalır ve muhasebe kapatır (mevcut K-54 akışı). Ödenmiş hakediş iptal edilemez; sürücüden geri alma (mahsup) akışı yok, karar bekliyor.
- [ ] Sürücü uygulamasında push yok, teklifler yoklama ile alınıyor. Konum yalnızca yolculuk ekranı açıkken paylaşılıyor, arka plan konumu için mağaza izin gerekçesi hazırlanmalı.
- [ ] Mobil uygulama Expo SDK 58'e yükseltildi. `eas.json` eklendi (2026-10-31); mağaza yayını için EAS hesabı açılmalı (`hesap_kurulumu.md`).
- [ ] Admin paneli için üretimde ayrı alt alan adı ve Cloudflare Access veya IP kısıtı.

## Tasarım yenilemesinden kalanlar (2026-10-31)

- [x] Mobil SVG harita yerine gerçek harita (K-37, 2026-11-02): müşteri rezervasyon detayı ve sürücü yolculuk ekranı `react-native-maps` ile rota çizgisini, alış/varış işaretlerini ve sürücü işaretçisini gösterir; web önizlemesinde stilize SVG kalır. Android emülatörde (Expo Go) Senaryo 3 ile doğrulandı (`docs/ui-review/screenshots/after/mobile/android-map-customer.png`, `android-map-driver.png`).
- [ ] Android Google Maps SDK anahtarı (`GETAWAY_GOOGLE_MAPS_ANDROID_KEY`, Google Cloud'da paket adı + SHA-1 kısıtlı, `hesap_kurulumu.md` satır 2a) kendi derlememiz (EAS) için alınmalı; Expo Go'da gerekmez. Anahtar yokken (2026-11-10) manifeste yer tutucu konur (yoksa SDK çöker) ve zemin OpenStreetMap'ten gelir; OSM karo sunucusu yoğun kullanıma uygun değil, yalnız geliştirme/CI içindir.
- [ ] Mobil haritanın iOS (Apple Maps) doğrulaması Mac ve iOS simülatörü gerektirir; yapılmadı. 2026-11-09: ekranlar Safari motoru ve iPhone 15 profiliyle (`node mobile.js --out after --ios`) tarandı, iOS'a özgü bozulma görülmedi; yerel iOS uygulaması için GitHub Actions iOS simülatör iş akışı eklendi (bkz. `docs/test_senaryolari.md` "iOS testi"); 2026-11-10: derleme (~22-35 dk) ve simülatörde açılış çalışıyor; Keychain (yerel imza) ve giriş ekranında klavyenin "Devam"ı kapatması düzeltildi. 2026-11-10 (16. çalıştırma): beş Maestro akışının tamamı iPhone 17 Pro simülatöründe geçti (sürücü girişi ve çevrimiçi, müşteri anlık rezervasyon ve sahte ödeme, sürücünün iş havuzundan teklifi kabulü, karşılama tabelası, yola çıkış, müşterinin canlı takibi, kazanç ve belgeler); Apple Maps karoları yükleniyor. Yolda bulunan uygulama hataları düzeltildi (giriş klavyesi, Keychain, sekme ikonları, erişilebilirlik etiketleri). Depo herkese açık olduğu için Actions dakikası sınırsız. Kalan: APNs push, arka plan konumu ve gerçek cihaz (Apple Developer hesabı); sahte ödeme dokunuşları iPhone 17 Pro ölçüsüne bağlı.
- [x] Müşteri çeşidine konum izni sızması çözüldü (2026-11-02): Expo prebuild kurulu `react-native-maps` ve `expo-location` yerleşik eklentileriyle müşteri uygulamasına da konum izni ve İngilizce iOS açıklamaları ekliyordu. `app.config.ts` müşteri çeşidinde `android.blockedPermissions` (FINE/COARSE, manifestte `tools:node="remove"`) ve yerel `withoutLocationUsage` eklentisi (iOS `NSLocation*` anahtarlarını siler); `npx expo config --type introspect` ile doğrulandı.
- [ ] Sürücü çeşidinde `expo-location` eklentisi `NSLocationAlwaysUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` ve `NSLocationTemporaryUsageDescriptionDictionary` için İngilizce varsayılan metin ekliyor (yalnız `WhenInUse` Türkçe). Sürücü arka plan konumu kullanmıyor; mağaza derlemesinden önce bu anahtarlar kaldırılmalı veya Türkçeleştirilmeli.
- [x] Siyah minibüs ayrı araç tipi oldu: VIP Minibüs (K-35). Fiyat çarpanı 2,40 yer tutucu; gerçek fiyat admin panelinden girilmeli.
- [ ] Sürücü belgelerinde `vip_minibus` araç tipiyle araç eklenip onaylanmalı; şu an bu tipte sürücü yok, bu tip rezervasyonlar admin eşleştirmesi bekler.
- [ ] Yandan Vito görseli (`vito_transparent.png`) 525 px; büyük ekranda keskinlik için yüksek çözünürlüklü şeffaf sürüm gerekli.
- [ ] Mobil web önizlemesinde açılır pencereler (adres arama, liste seçici) telefon çerçevesinin dışına tam ekran açılıyor; yalnızca önizleme sorunu, gerçek cihazda tam ekran zaten doğru.
- [ ] Bu bilgisayarda Metro dosya değişikliklerini izlemiyor (8081/8082 eski paketi sunuyordu). Önizleme sunucuları değişiklikten sonra `--clear` ile yeniden başlatılmalı; Watchman kurulumu çözebilir. Web ve admin `next start` ile çalıştığı için değişiklikten sonra `npm run build` gerekir.

## Kararı verilmiş, geliştirmesi bekleyen (2026-10-31)

- [ ] Günlük araç kiralama (K-29): ürün tanımı (şoförlü mü şoförsüz mü, günlük km sınırı, teslim noktası, fiyat modeli, depozito), veritabanı, API, web, mobil ve admin ekranları.
- [ ] On dil (K-34, uygulaması K-36): web, mobil ve bildirim şablonları için fr, es, it, zh, ja, ar çevirileri. Arapça için sağdan sola yerleşim. Bildirim şablonları 6 yeni dilde de hazırlanmalı (admin şablon ekranında dil başına kayıt). Yasal metinlerin çevirisi taslak olarak "çeviri doğrulanmadı" notuyla yayımlanır; yayından önce hukukçu kontrolünden geçmeli.
- [ ] Uçuş verisinin kuruma bildirimi: zorunluysa bildirim akışı ve kaydı yazılacak, silme bu kayda bağlanacak (K-31).

## Ön yüz test altyapısı (K-40, 2026-11-02)

- [ ] Lint taban borcu: web 0 (B-W0 `Motion.tsx` iki, B-W1 ana sayfa bir uyarıyı, B-W2 `BookingWizard.tsx` iki hata ve bir uyarıyı, B-W3 `OtpLogin.tsx` `no-autofocus` hatasını giderdi), admin 3 (1/2), mobil 9 (7/2) ihlal (`docs/ui-review/lint-taban.md`). Ekran görevleri ilgili dosyaya dokundukça giderilir; plan kapanışında lint sıfır ihlalle zorunlu olur, o zamana kadar `npm run lint` sıfırdan farklı çıkar ve web/admin `next.config.ts` içinde `eslint.ignoreDuringBuilds: true` durur.
- [ ] Yerel e2e admin hesabı: admin Playwright testleri geliştirme veritabanında ayrı bir admin hesabıyla çalışır; e-posta, parola ve TOTP sırrı yalnızca git'e girmeyen `admin/.env.e2e.local` dosyasındadır (repoya yazılmaz). Geliştirme veritabanında eski, pasif iki e2e personel kaydı kalmıştır; temizlenip temizlenmeyeceği kararlaştırılacak. Üretimde bu hesap açılmaz.

## Arayüz taraması (2026-11-02)

- [ ] Logo alt yazısı "TRANSFERS" 9,28 px (`.brand-sub` 0.58rem); Impeccable detector `undersized-ui-text` olarak işaretliyor. Logotip olduğu için (bağlantının adı `aria-label`) değiştirilmedi; büyütmek kimlik kararıdır.
- [ ] Üretim derlemesinde `notFound()` çağıran dinamik rotalar (`/tr/yok`, `/tr/bookings/XX`) sunucuda `__next_error__` kabuğu döndürür, 404 içeriği istemcide çizilir (durum kodu 404, tarayıcıda `html[lang]` ve başlık doğru). JavaScript'siz istemci yalnızca kabuğu görür; Next 15 davranışı, B-W0'dan önce de vardı.
- [ ] Rezervasyon sihirbazı (B-W2'den açık P2): telefonda onay adımında araç ve tarih özeti formun altında kalıyor (ödeme ekranı B-W4'ten beri kod, güzergâh ve tarihi tutarla birlikte gösteriyor; onay adımındaki konu açık); rezervasyon oluşturma hatalarından yalnızca `price_changed` ve oturum düşmesi (401) özel ele alınıyor, diğerleri genel "Bir hata oluştu" metni.
- [ ] SMS doğrulama (B-W3'ten açık): çok fazla kod istendiğinde (429) mesaj ne zaman tekrar denenebileceğini söylemiyor; backend kalan süreyi veya `Retry-After` döndürmüyor (P2, backend kararı). Kodun geçerlilik süresi (API `expires_in`, 5 dk) ve "SMS gelmedi" yardımı arayüzde yok (P3). Tekrar gönder beklemesi (45 sn) yalnızca görseldir; asıl sınır backend'in saatlik 5 kod sınırıdır.
- [ ] Ödeme ekranı (B-W4'ten açık): "Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir." metni backend ile **uyuşuyor** (`jobs.cancel_unpaid_bookings`, ARQ işçisi dakikada bir; süre `system_settings.pending_payment_minutes`, varsayılan 30, geliştirme veritabanında üzerine yazılmamış; oluşturulma anından sayılır). Ancak süre admin panelinden değiştirilebilir bir ayar, metin ise sabit; ayar değişirse metin yanlış olur. API süreyi veya son ödeme anını döndürmüyor (göstermek backend değişikliği ister). Ayrıca telefonda (390 px) özet kartı sağlayıcı sayfasını ilk ekranın altına itiyor (P3); başarısız ödemede yardım/iletişim bağlantısı yok (P3). Sağlayıcı sayfası açıkken oturum dolarsa artık not ve **Yeniden giriş yap** çıkar, yeniden girişte yeni ödeme açılmaz (K-45, yüzey 1 incelemesi); sağlayıcı sayfası boş çizilirse ekranda kurtarma eylemi hâlâ yok (P3, B-W4 incelemesi; K-42 gereği açıkken yeniden deneme gösterilmiyor, backend açık ödemeyi yeniden kullanmadığı için düşük vurgulu ve kilitli bir "yeni ödeme sayfası" eylemi ayrıca karar ister). **Çözüldü (2026-11-03, K-46):** backend artık açık ödemeyi (25 dk içinde, `beklemede`) yeniden kullanır; aynı rezervasyon için ikinci ödeme sayfası açılmaz.
- [ ] Ödeme sonucu geçiş ekranı (B-W5'ten açık, P3): sağlayıcı iFrame'inde site üst ve alt bilgisi (ortak layout) iFrame'den çıkılana kadar bir an görünüyor; backend ok/fail adresleri dilsiz (`/booking/payment-result?status=…`), dili ara katman yazılımı çerez ve tarayıcı dilinden seçiyor. İkisi de davranışı bozmuyor; ortak layout veya backend değişikliği ister.
- [ ] Rezervasyon detayı (B-W6'dan açık, P3): sayfa rezervasyon durumunu kendiliğinden yenilemiyor (yalnızca sürücü konumu 5 sn'de bir yoklanıyor); sürücü yola çıkınca veya yolculuk bitince durum ve canlı takip kutusu sayfa yenilenene kadar eski kalır. Canlı takip kutusu tüm izlenebilir bacaklarda tek bir konumla beslenir; API'nin döndürdüğü `leg_id` kullanılmıyor (B-W6'dan önce de böyleydi; aynı anda iki bacağın izlenmesi pratikte olmadığı için P3, düzeltme turu 1 incelemesi bulgu 8). Eskime artık duvar saatiyle ve değişmeyen `at` ile ölçülüyor (K-44, düzeltme turu 1). Tarayıcı sekmesinin başlığı rezervasyona özgü değil (diğer ekranlarla aynı genel başlık). Tam iade garantisi metni (`bookings.cancelGuarantee`) yalnızca API `guarantee_applied: true` döndürürse görünür; garanti satışı kapalı olduğu için yeni rezervasyonlarda çıkmaz.
- [ ] Web e2e testleri geliştirme veritabanında kayıt bırakır: her ödeme, detay ve sihirbaz testi kurgusal bir numarayla (ABD 555-01XX, Birleşik Krallık 07700 900xxx; `web/e2e/session.ts`) müşteri hesabı, ödeme bekleyen rezervasyon ve `Payment` kaydı açar; temizlik yok (backend'de silme ucu yok). Bekleyen rezervasyonlar ARQ işçisi çalışıyorsa 30 dk sonra iptal edilir. Geliştirme veritabanı ara ara sıfırlanabilir; üretime karşı e2e çalıştırılmaz (SMS gönderen testler yerel olmayan hedefte atlanır).
- [ ] Rezervasyonlarım (B-W8'den açık, P3): liste sayfalanmıyor ve sanallaştırılmıyor (API `me/bookings` tüm kayıtları döndürüyor; müşteri başına kayıt sayısı küçük). Kod alanı oturumsuzken isteğe bağlıdır; hatalı kod girişi engellemez, girişten sonra alanda hatasıyla kalır.
- [x] Hesabım (B-W9'dan açık, P3, düzeltme turu 1'de kapandı): e-posta artık istemcide denetlenir ve alan hatası sitenin dilinde gösterilir (backend'in genel `validation_error` metnine düşülmez).
- [ ] Yasal sayfalar (B-W11–14'ten açık, P3): mesafeli satış metninde bölüm başlığı yok (etiketler cümle içinde); "son güncelleme" tarihi verisi yok (yalnızca sürüm); metin içi bağlantı (mesafeli satış → iptal politikası, KVKK → veri talep formu) mesaj metni değişmeden eklenemez; iptal metninde `tier3` "%0" değil "iade yapılmaz" der (anlamca K-14 ile aynı). Hepsi hukukçu onaylı metinle birlikte ele alınır.
- [ ] 404 (B-W15, P3): sekme başlığı React 19 `<title>` ile; `head`'de düzenin başlığı da ikinci sırada kalır (`not-found.tsx` `metadata` Next 15.5'te uygulanmıyor).
- [ ] Veri talebi (B-W10'dan açık, P3): talep türü seçeneklerinde hakların kısa açıklaması yok (yasal metin uydurulmaz; hukukçu onaylı açıklama gelirse eklenebilir); gönderilmiş talep ekrandan geri çekilemez (backend ucu yok; silme talebi bu yüzden gönderilmeden önce satır içi onay ister, düzeltme turu 1). `AccountPanel` ve `DataRequestPanel` durum bileşenleri (yüzey 1 incelemesinden kalan) B-W9/B-W10'da kapandı. `useSessionExpired()` `RequireLogin` dışında üretimde etkisizdir (geliştirmede uyarır).
- [ ] Web e2e geliştirme sunucusunda 4 paralel işçiyle `smoke` testi ara sıra `net::ERR_ABORTED` ile düşüyor (sayfa derlenirken); `--workers=1` ile tümü geçiyor.

## Operasyon

- [ ] İlk admin kullanıcıların listesi.
- [ ] Sürücü onboarding süreci ve belge kontrol sorumluluğu.
- [ ] Cloudflare'e DNS taşıma zamanı.

- ~~`backend/requirements.txt`: `redis==8.1.0` ile `arq==0.28.0` (`redis<6` ister) çakışır~~ (2026-11-09: redis `5.3.1`'e sabitlendi, temiz `pip install -r` çalışıyor, CI'daki `--no-deps` geçici çözümü kaldırıldı).
- Sürücüye gösterilen tutarın para birimi (2026-11-09): iş havuzu ve iş ayrıntısı sürücü payını rezervasyonun para biriminde gösteriyor (yabancı müşteride €, Türkiye'de ₺), Kazanç ekranı ise "Hakedişler TL olarak IBAN'ınıza ödenir" diyor. Sürücüye her yerde TL (o günün kuruyla tahmini) mi gösterileceği karar bekliyor.
- Yerel test verisi (2026-11-09): iki demo sürücüde eski testlerden kalan açık yolculuk var; sürücüler meşgul göründüğü için anlık teklif akışı (senaryo 4) denenemiyor. `seed-demo` sonrası temiz veriyle tekrar denenmeli.
- Mobil harita (2026-11-08): anahtarlar yerelde tanımlı; native Google Haritalar emülatör/cihazda ve EAS derlemesinde görsel olarak doğrulanmalı. Android anahtarında uygulama kısıtı (paket + SHA-1) mağaza öncesi eklenmeli.
- Mobil harita anahtarları (2026-11-08): Android için `GETAWAY_GOOGLE_MAPS_ANDROID_KEY` (Maps SDK for Android, paket adı + SHA-1 kısıtlı), iOS için isteğe bağlı `GETAWAY_GOOGLE_MAPS_IOS_KEY` (Maps SDK for iOS, bundle ID kısıtlı; yoksa Apple Maps) ayrı anahtar olarak alınmalı. Expo Go ve web önizlemede gerekmez; yalnızca EAS/prebuild derlemesinde. Web önizlemesi gerçek harita için web sitesinin tarayıcı anahtarını `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` olarak kullanır; canlı tarayıcı anahtarının referrer listesine localhost:8081/8082 eklenmemeli (yalnız geliştirme anahtarı). iOS'ta Google Haritalar derlemede doğrulanmadı.
- Web harita tarayıcı anahtarı (2026-11-08): yerelde geçici olarak backend sunucu anahtarı `web/.env.local`'da (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`) kullanılıyor; bu tarayıcıya açık olduğundan ayrı, **HTTP referrer** kısıtlı (localhost:3000, getawaytransfers.com) ve yalnız **Maps JavaScript API** açık bir anahtarla değiştirilmeli. Sunucu anahtarına IP kısıtı konunca web haritası eski anahtarla çalışmaz.
- `.vscode/tasks.json` Android görevleri SDK'yı `%LOCALAPPDATA%AndroidSdk` altında arıyor; kullanıcı yolunda Türkçe karakter olan makinede SDK `C:Android` altında. Görevlerin `ANDROID_HOME` / `ANDROID_AVD_HOME` ortam değişkenini okuması değerlendirilmeli.
- Uygulama kapalıyken bildirim (2026-11-08, K-51/K-52): Firebase projesi ve `google-services.json` (Android) ile APNs anahtarı (iOS, Apple Developer hesabı) gerekir; backend FCM HTTP v1 gönderici 2026-11-09'da eklendi (K-56), Android tamam; iOS APNs bekliyor. Eskiden bildirimler uygulama açıkken veya arka planda canlıyken (sürücüde yolculuk boyunca) yerel bildirim olarak gelir.
- Mağaza: sürücü uygulamasının arka plan konum izni için Google Play "konum izni beyanı" ve kısa video, App Store için izin gerekçesi hazırlanmalı (K-52). Aydınlatma metnine sohbet (K-50) ve arka plan konumu eklenmeli; hukukçu onayı.
- iOS: arka plan konumu, uygulama kapalıyken bildirim (APNs) ve Google Haritalar iOS derlemesinde doğrulanmadı (Apple Developer hesabı gerekir). Simülatörde ön plan akışları ve Apple Maps 2026-11-10'da doğrulandı.
- ~~Admin panelinde müşteri–sürücü sohbetini görüntüleme ve müşterinin erken bitirdiği yolculukların listesi henüz yok~~ (2026-11-08, K-55 ile eklendi).
- ~~Müşteri web sitesinde sohbet, kalan süre ve yolculuğu bitirme yok~~ (2026-11-08, K-55 ile eklendi). Web'de bildirim yok: sayfa açık değilken mesaj ve yaklaşma bildirimi yalnızca SMS/mobil uygulamada (web push ayrı iş). Müşteri haritasında sürücünün alışa giden rotası çizilmiyor, yalnızca sürücü işareti ve kalan süre görünüyor.
