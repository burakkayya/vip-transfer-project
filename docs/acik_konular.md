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

- [ ] Araç tipleri ve çarpanları (minivan, VIP van, minibüs).

## Teknik

- [ ] Yurt dışı servislerde veri bölgesi (Sentry, e-posta).
- [ ] Uçuş takip API'sinin seçimi ve maliyeti.
- [ ] Google Routes maliyet tahmini ve gerekirse OSRM ile self-host kararı.

## Geliştirme sırasında ortaya çıkanlar

Kodda geçici varsayımla çözüldü. Teyit sonrası güncellenmeli.

- [ ] TCMB satış kuru (`ForexSelling`) yerine alış kuru veya efektif kur mu kullanılacak, kura marj eklenecek mi. Şimdilik satış kuru, marj yok (K-33). Admin panelindeki elle kur girişi acil durum yedeği olarak duruyor; kullanım dışı bırakılabilir.
- [ ] Sürücü hakedişinde EUR→TRY kuru: iş tamamlandığı andaki kur mu, ödeme günündeki kur mu? Şimdilik tamamlanma anındaki kur kullanılıyor.
- [ ] Zorunlu belge listesi: sürücü için sürücü belgesi, SRC ve adli sicil; araç için ruhsat, sigorta, muayene ve turizm taşımacılığı yetki belgesi. Liste `system_settings` üzerinden değiştirilebilir, hukukçuyla teyit edilmeli.
- [ ] Gazipaşa-Alanya Havalimanı (GZP), K-06 kapsamında aktif olarak eklendi. is_modeli.md'de yalnızca üç havalimanı geçiyor.
- [ ] Araç tipleri ve çarpanları yer tutucu: minivan 1,30, VIP van 1,60, minibüs 2,00. Sedan hizmetten kaldırıldı (2026-10-29), eski kayıtlar için pasif tutuluyor.
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

- [ ] Mobil haritalar stilize SVG; gerçek harita için `react-native-maps` (iOS Apple Maps, Android Google Maps anahtarı) bağlanmalı. Rota çizgisi için Routes API polyline gerekir.
- [ ] Siyah minibüs ayrı araç tipi mi (ör. VIP Minibüs, ayrı fiyat)? Şu an minibüs kartında renk seçeneği olarak gösteriliyor, fiyat aynı. CLAUDE.md'deki araç tipi listesi değişecekse karar gerekir.
- [ ] Yandan Vito görseli (`vito_transparent.png`) 525 px; büyük ekranda keskinlik için yüksek çözünürlüklü şeffaf sürüm gerekli.
- [ ] Mobil web önizlemesinde açılır pencereler (adres arama, liste seçici) telefon çerçevesinin dışına tam ekran açılıyor; yalnızca önizleme sorunu, gerçek cihazda tam ekran zaten doğru.
- [ ] Bu bilgisayarda Metro dosya değişikliklerini izlemiyor (8081/8082 eski paketi sunuyordu). Önizleme sunucuları değişiklikten sonra `--clear` ile yeniden başlatılmalı; Watchman kurulumu çözebilir.

## Kararı verilmiş, geliştirmesi bekleyen (2026-10-31)

- [ ] Günlük araç kiralama (K-29): ürün tanımı (şoförlü mü şoförsüz mü, günlük km sınırı, teslim noktası, fiyat modeli, depozito), veritabanı, API, web, mobil ve admin ekranları.
- [ ] On dil (K-34): web, mobil ve bildirim şablonları için fr, es, it, zh, ja, ar çevirileri. Arapça için sağdan sola yerleşim. Yasal metinlerin çevirisi hukukçu kontrolünden geçmeli.
- [ ] Uçuş verisinin kuruma bildirimi: zorunluysa bildirim akışı ve kaydı yazılacak, silme bu kayda bağlanacak (K-31).

## Operasyon

- [ ] İlk admin kullanıcıların listesi.
- [ ] Sürücü onboarding süreci ve belge kontrol sorumluluğu.
- [ ] Cloudflare'e DNS taşıma zamanı.
