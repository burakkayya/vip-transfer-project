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
- [ ] FCM servis hesabı açılınca push bildirimi devreye alınacak. Şimdilik konsola yazılıyor.
- [ ] e-Arşiv entegratörü seçimi. Fatura kaydı oluşuyor ancak kesim yapılmıyor.
- [ ] Belge depolama: şimdilik yerel diskte şifreli tutuluyor, Türkiye'deki S3 uyumlu depolamaya geçilecek.
- [ ] Müşteri silme talebinde rezervasyon ve fatura kayıtlarının saklama süresi. Şimdilik kişisel alanlar siliniyor, kayıtlar saklanıyor.
- [ ] Web yasal metinleri (KVKK aydınlatma, mesafeli satış ön bilgilendirme, iptal, çerez) taslak. Şirket unvanı, adres, TÜRSAB ve MERSİS no `web/lib/site.ts` içinde yer tutucu. Hukukçu onayından sonra sayfalardaki "taslak" uyarısı kaldırılacak.
- [ ] Google Maps API anahtarı (Places API New + Routes API) açılmalı, IP ile kısıtlanmalı ve bütçe uyarısı konmalı. Anahtar gelene kadar geliştirme sahte adres listesiyle çalışır (`GETAWAY_PLACES_PROVIDER=fake`).
- [ ] Adres aramasında kullanıcının yazdığı adres metni Google'a (yurt dışı) gider. Aydınlatma metninde belirtilmeli, KVKK açısından hukukçuyla teyit edilmeli.
- [ ] İlçe bazlı fiyatta büyük ilçelerde (Alanya, Kaş, Fethiye) ilçe merkezine uzak adresler için ek mesafe kuralı gerekip gerekmediği.
- [ ] Sürücü uygulamasında push yok, teklifler yoklama ile alınıyor. Konum yalnızca yolculuk ekranı açıkken paylaşılıyor, arka plan konumu için mağaza izin gerekçesi hazırlanmalı.
- [ ] Mobil uygulama Expo SDK 58'e yükseltildi. `eas.json` eklendi (2026-10-31); mağaza yayını için EAS hesabı açılmalı (`hesap_kurulumu.md`).
- [ ] Admin paneli için üretimde ayrı alt alan adı ve Cloudflare Access veya IP kısıtı.

## Tasarım yenilemesinden kalanlar (2026-10-31)

- [x] Mobil SVG harita yerine gerçek harita (K-37, 2026-11-02): müşteri rezervasyon detayı ve sürücü yolculuk ekranı `react-native-maps` ile rota çizgisini, alış/varış işaretlerini ve sürücü işaretçisini gösterir; web önizlemesinde stilize SVG kalır. Android emülatörde (Expo Go) Senaryo 3 ile doğrulandı (`docs/ui-review/screenshots/after/mobile/android-map-customer.png`, `android-map-driver.png`).
- [ ] Android Google Maps SDK anahtarı (`GETAWAY_GOOGLE_MAPS_ANDROID_KEY`, Google Cloud'da paket adı + SHA-1 kısıtlı, `hesap_kurulumu.md` satır 2a) kendi derlememiz (EAS) için alınmalı; Expo Go'da gerekmez.
- [ ] Mobil haritanın iOS (Apple Maps) doğrulaması Mac ve iOS simülatörü gerektirir; yapılmadı.
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
- [ ] Ödeme ekranı (B-W4'ten açık): "Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir." metni backend ile **uyuşuyor** (`jobs.cancel_unpaid_bookings`, ARQ işçisi dakikada bir; süre `system_settings.pending_payment_minutes`, varsayılan 30, geliştirme veritabanında üzerine yazılmamış; oluşturulma anından sayılır). Ancak süre admin panelinden değiştirilebilir bir ayar, metin ise sabit; ayar değişirse metin yanlış olur. API süreyi veya son ödeme anını döndürmüyor (göstermek backend değişikliği ister). Ayrıca telefonda (390 px) özet kartı sağlayıcı sayfasını ilk ekranın altına itiyor (P3); başarısız ödemede yardım/iletişim bağlantısı yok (P3). Sağlayıcı sayfası açıkken oturumu dolarsa veya boş çizilirse ekranda kurtarma eylemi yok; sayfayı yenilemek (adreste `result` yokken) yeni ödeme sayfası açar (P3, B-W4 incelemesi; K-42 gereği açıkken yeniden deneme gösterilmiyor, backend açık ödemeyi yeniden kullanmadığı için düşük vurgulu ve kilitli bir "yeni ödeme sayfası" eylemi ayrıca karar ister). Backend her ödeme başlatmada yeni `Payment`/`merchant_oid` açar, açık olanı yeniden kullanmaz (istemcide kilit var; backend tarafı kapsam dışı).
- [ ] Ödeme sonucu geçiş ekranı (B-W5'ten açık, P3): sağlayıcı iFrame'inde site üst ve alt bilgisi (ortak layout) iFrame'den çıkılana kadar bir an görünüyor; backend ok/fail adresleri dilsiz (`/booking/payment-result?status=…`), dili ara katman yazılımı çerez ve tarayıcı dilinden seçiyor. İkisi de davranışı bozmuyor; ortak layout veya backend değişikliği ister.
- [ ] Web e2e geliştirme sunucusunda 4 paralel işçiyle `smoke` testi ara sıra `net::ERR_ABORTED` ile düşüyor (sayfa derlenirken); `--workers=1` ile tümü geçiyor.

## Operasyon

- [ ] İlk admin kullanıcıların listesi.
- [ ] Sürücü onboarding süreci ve belge kontrol sorumluluğu.
- [ ] Cloudflare'e DNS taşıma zamanı.
