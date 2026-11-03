# Web ödeme (`/bookings/[code]/pay`, `PaymentPanel`): Impeccable geçişi (B-W4)

Tarih: 2026-11-02 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector/axe/tarayıcı kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass. Skill'in soru/karar adımları yerine görev brifi ve kontrolcü kararları kullanıldı (soru sorulmadı).
Kapsam: gelir akışında OTP'den sonra gelen ödeme ekranı. Sayfa `RequireLogin` ile sarılıdır (oturum denetlenirken B-W3'ün "Oturum denetleniyor…" durumu). Kart bilgisi sağlayıcının iFrame'inde girilir (K-17); geliştirmede sahte sağlayıcı ("Ödemeyi onayla" / "Reddet"). PayTR canlı ayarı değişmedi.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, 10 sezgisel, hepsi uygulanır) | **22/40 (%55, Acceptable)** | **36/40 (%90, Excellent)** |
| audit | **14/20 (Good)** | **18/20 (Excellent)** |
| axe (wcag2a/2aa/21a/21aa/22aa; iFrame hariç `.iframe-wrap`) | 0 (ödeme açık durum; sorunlar otomatik kural dışı: rolsüz hata ve red uyarısı) | **0** (ödeme açık ve ödeme reddi durumu) |
| detector (`impeccable detect`, `PaymentPanel.tsx`, `pay/page.tsx`) | 0 | 0 |
| lint (`PaymentPanel.tsx`, `pay/page.tsx`, `pay.spec.ts`) | 0 | **0** (web geneli 0) |

Gelir akışı eşiği %85: sonra %90.

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not (sonra) |
|---|---|---|---|---|
| 1 | Sistem durumu | 2 | 4 | "Rezervasyon bilgileri yükleniyor…", "Güvenli ödeme sayfası hazırlanıyor…" (`LoadingState`), iFrame üstünde "Ödemeniz bekleniyor. Onaylandığında bu sayfa kendiliğinden ilerler." (`role="status"`); ödenmiş rezervasyonda "Ödemeniz alındı…" duyurulup detaya geçilir |
| 2 | Gerçek dünya | 3 | 4 | Güzergâh "Antalya Havalimanı (AYT) → Kemer, Antalya", alış tarihi, kod |
| 3 | Kullanıcı kontrolü | 2 | 3 | Son durumlarda "Rezervasyonu görüntüle" / "Yeni rezervasyon"; bekleme sırasında yalnızca üst menü |
| 4 | Tutarlılık | 2 | 4 | Ortak `LoadingState`, `ErrorState`, `EmptyState`; B-W3 ile aynı `role` deseni; ham kod etiketli düğme ve satır içi stil kalktı |
| 5 | Hata önleme | 2 | 4 | Sağlayıcı sayfası açıkken "Tekrar dene" yok (yeni ödeme açıp kart formunu sıfırlamıyor); iptal edilmiş rezervasyon "ödeme beklenmiyor" yerine nedenini söyler |
| 6 | Tanıma | 2 | 4 | Tutar, kod, güzergâh, tarih aynı kartta; ne ödendiği hatırlanmak zorunda değil |
| 7 | Esneklik | 3 | 3 | Doğrusal akış; yeterli |
| 8 | Estetik ve sadelik | 3 | 3 | İki not ayrı satır ve simgeli; telefonda özet kartı sağlayıcı sayfasını ilk ekranın altına itiyor (P3) |
| 9 | Hata kurtarma | 1 | 4 | Yükleme, ağ ve ödeme başlatma hatasında `ErrorState` + "Tekrar dene"; tutar ve özet yerinde kalır; redde birincil "Tekrar dene" ve "kartı kontrol et / başka kart" yönlendirmesi |
| 10 | Yardım | 2 | 3 | Güvenlik ve süre notları ayrı; redde iletişim bağlantısı yok (P3) |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | Hatalar ve ödeme reddi `role="alert"`, bekleme `role="status"`, özet `section[aria-label]`, iFrame başlığı "Güvenli ödeme sayfası" (h1 ile aynı değil), son durumlarda `h2`; axe 0 |
| Performans | 3 | 3 | 3 sn yoklama yalnızca ödeme beklerken (değişmedi; sekme gizliyken de sürer, P3); yeni ağ çağrısı yok |
| Tema | 3 | 3 | Yalnızca tokenlar (`--muted`, `--text`, `--line`); satır içi stil kalktı; koyu mod kapsam dışı |
| Duyarlılık | 3 | 4 | 360/390/768/1024/1440 Almanca taşma ve kesilme yok (test); tutar tek satır, `tabular-nums`; ≤720 px özet tek sütun, eylem düğmeleri tam genişlik |
| Uygulama bütünlüğü | 3 | 4 | Lint 0, detector 0; mantıksal özellikler (`padding-block-start`, `border-block-start`, `margin-block-start`); tutar API'den geldiği gibi yalnızca `Intl.NumberFormat` ile biçimlenir |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Rezervasyon yüklenirken `null` (başlığın altı boş) ve ödeme sayfası hazırlanırken iFrame alanı boş, yalnızca "Tekrar dene" (Review Focus 2) | **Kapandı**: iki ayrı `LoadingState`. Test: "pay shows loading state before booking loads" (istekler `page.route` ile bekletilir) |
| P1 | Yükleme/ağ hatası rolsüz `p.alert`, yeniden deneme yok, yalnızca ham kod bağlantısı; ödeme başlatma hatası tüm paneli silip tutarı kaybediyordu (WCAG 4.1.3) | **Kapandı**: yükleme hatası `ErrorState` (`role="alert"`, "Tekrar dene" yeniden yükler; 404/403'te yeniden deneme yerine "Rezervasyonlarım"); başlatma hatası özetin altında `ErrorState`, tutar yerinde. Testler: "network error shows ErrorState with retry" (`**/bff/**` abort, `auth/` hariç), "checkout start failure keeps amount and offers retry" |
| P1 | Ödeme reddi (`?result=fail`) rolsüz `p.alert`: ekran okuyucu duyurmuyor; "Tekrar dene" ikincil ve nereye yol açtığı belirsiz | **Kapandı**: `role="alert"` + birincil (lake siyah) `.pay-retry`; metin "Kart bilgilerinizi kontrol edip tekrar deneyebilir ya da başka bir kart kullanabilirsiniz." Test: "failed payment shows alert and retry" (sahte sayfada "Reddet" → uyarı, düğme odaklanır, tıklayınca sağlayıcı sayfası geri gelir) |
| P2 | Sağlayıcı sayfası açıkken "Tekrar dene" görünür: basınca yeni ödeme açılıp kart formu sıfırlanıyor; "Ödemeniz bekleniyor..." duyurulmuyor ve iFrame'in altında | **Kapandı**: bekleme sırasında düğme yok; bekleme metni iFrame'in üstünde `role="status"`. Test: "waiting state is announced and retry is not offered…" |
| P2 | Ne ödendiği görünmüyor: kod, güzergâh, tarih yok | **Kapandı**: özet kartında kod, güzergâh (gidiş-dönüşte "Gidiş"/"Dönüş"), alış tarihi. Test: "pay summary shows booking code, route and amount as returned by the API" |
| P2 | Ödeme beklemeyen rezervasyon: kehribar "info" uyarısı (Status Means Status), düğme adı ham kod; iptal edilmiş rezervasyonda "ödeme beklenmiyor" yanıltıcı; ödenmişte yönlendirme öncesi aynı metin | **Kapandı**: iptal → `EmptyState` "Bu rezervasyon iptal edildi" + "Yeni rezervasyon" / "Rezervasyonu görüntüle"; diğerleri "Bu rezervasyon için ödeme beklenmiyor." + "Rezervasyonu görüntüle"; ödenmiş → yeşil `role="status"` "Ödemeniz alındı…" (kullanılmayan `pay.success` anahtarı). Test: "cancelled booking explains…" |
| P2 | Güvenlik notu ve 30 dakika kuralı `<br/>` ile tek soluk ipucunda, satır içi `maxWidth: 420` | **Kapandı**: iki ayrı not (kilit ve saat simgesi), süre notu ana metin renginde; satır içi stil yok |
| P3 | Tutar `tabular-nums` değil, satır kırılabilir | **Kapandı**: `.pay-amount` `nowrap` + `tabular-nums`; 360 px'te tek satır (test) |
| P3 | iFrame başlığı sayfa başlığıyla aynı ("Ödeme"); "..." üç nokta | **Kapandı**: "Güvenli ödeme sayfası"; metinlerde "…" |
| P3 | Telefonda (390 px) özet kartı sağlayıcı sayfasını ilk ekranın altına itiyor | Açık (P3): tanıma kazancı için kabul; kart bilgisi formu zaten kaydırma gerektiriyor |
| P3 | Redde yardım/iletişim bağlantısı yok; yoklama sekme gizliyken de sürer | Açık (P3) |
| P2 | Ortak iskelet parıltısı azaltılmış harekette de dönüyor (Global Constraints) | **Kapandı**: `home.css` `.skeleton` animasyonu `no-preference` altında. Test: "loading skeleton does not shimmer with reduced motion" (önce FAIL: `animationName` `shimmer`) |

### "30 dakika" kuralı (backend ile doğrulama)

- Metin: "Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir." (dört dilde aynı anlam) **değiştirilmedi**.
- Backend: `backend/app/services/jobs.py` `cancel_unpaid_bookings` durumu `odeme_bekliyor` olup `created_at < now - pending_payment_minutes` olan rezervasyonları iptal eder (`cancel_reason = "ödeme süresi doldu"`); ARQ işçisi (`app/worker.py`) her dakika çalıştırır. Süre `system_settings.pending_payment_minutes`, varsayılan **30** (`app/services/system_settings.py`); geliştirme veritabanında üzerine yazılmış satır yok. `services/payments.py` süre içermez (başarısız ödeme rezervasyonu `odeme_bekliyor` bırakır).
- Sonuç: **uyuşuyor**. Not: süre admin panelinden değiştirilebilir, metin sabittir; API süreyi döndürmediği için metni ayara bağlamak backend değişikliği ister. `docs/acik_konular.md`'ye yazıldı. Süre rezervasyonun oluşturulduğu andan sayılır; istemcide son ödeme anı hesaplanmadı (iş kuralı kopyalanmaz).

## Yapılanlar (Impeccable adımları)

- **harden**: yükleniyor (rezervasyon, ödeme sayfası), yükleme/ağ/başlatma hatası (`ErrorState`, yeniden dene), 404/403'te yeniden deneme yok, ödeme reddi, iptal/ödenmiş/diğer durumlar; uzun bölge/adres adları için `overflow-wrap: anywhere` (120 karakterlik ad ayrıca test edilmedi; adlar API'nin sabit bölge listesinden gelir); `₺4.190,00` ve `75,00 €` tek satır; mantıksal özellikler.
- **adapt**: 360, 390, 768, 1024, 1440 px Almanca (test); ≤720 px özet tek sütun, eylem düğmeleri tam genişlik; iFrame yüksekliği değişmedi (640 / 520 px).
- **clarify** (tr, en, de, ru): `waiting` ve `failed` yeniden yazıldı; yeni `loading`, `preparing`, `frameTitle`, `summary`, `route`, `outbound`, `inbound`, `viewBooking`, `cancelledTitle`, `cancelledText`. `pay` 19 anahtar, dört dilde eşit. `expiresHint` ve `text` değişmedi. Yasal metne dokunulmadı.
- **optimize**: bileşen durumlu ve yoklama yapar, `"use client"` gerekli; sayfa sunucu bileşeni kaldı. Görsel yok.
- **animate / delight**: eklenmedi (Operate; ödeme anında hareket dikkat dağıtır). Bulunan açık: ortak iskeletin parıltısı (`home.css` `.skeleton`, `shimmer` sonsuz) azaltılmış harekette de dönüyordu; artık yalnızca `prefers-reduced-motion: no-preference` altında (araç kartı iskeletleri dahil). Test: "loading skeleton does not shimmer with reduced motion".
- **polish**: özet iki sütun (tutar | kod ve güzergâh), notlar saç çizgisiyle ayrılmış alt bölümde; başarısız ödemede tek birincil eylem.

## Değişen dosyalar

`web/components/PaymentPanel.tsx`, `web/app/globals.css` (ödeme bloğu, ≤720 px `.pay-summary`/`.pay-actions`), `web/app/home.css` (`.skeleton` parıltısı yalnızca hareket serbestken), `web/messages/{tr,en,de,ru}.json` (`pay`), `web/e2e/pay.spec.ts` (yeni, 10 test), `scripts/ui-shots/web.js` (ödeme reddi seçicileri: `.pay [role=alert]`, `.pay-retry`). `pay/page.tsx` değişmedi.

## Uygulanamadı: neden

- Son ödeme anını veya ayardaki süreyi göstermek: API döndürmüyor; backend değişikliği kapsam dışı (BLOCKED gerektirmiyor, metin bugün doğru).
- Redde yardım/iletişim bağlantısı: P3, iletişim kanalı (`site.ts` yer tutucu) kesinleşmeden eklenmedi.

## Doğrulama

- Kırmızı testler önce (`npx playwright test pay.spec --project=desktop --workers=2`): **9 başarısız, 0 geçti**. Nedenler: "loading" (`getByRole('status')` "Rezervasyon bilgileri yükleniyor" yok, panel `null`), "failed payment" (`.pay [role=alert]` yok), "network error" ve "checkout start failure" (`role="alert"` yok), "waiting state" (`role="status"` yok), "summary" (`.pay-summary` yok), "cancelled" ("Bu rezervasyon iptal edildi" yok), "axe" (ödeme açık durumda axe 0 geçti; ödeme reddinde `role="alert"` beklentisinde düştü), "de overflow" (sayfa taşmadı; `.pay-amount` yok).
- Hareket azaltma testi sonradan (harden sırasında) eklendi; önce FAIL (`animationName` `shimmer`, beklenen `none`), `home.css` düzeltmesinden sonra geçti.
- Sonra: `npx playwright test pay.spec --project=desktop --workers=2` → **9 geçti** (+ hareket azaltma testi). Tüm web e2e (iki proje, `--workers=2`, iskelet düzeltmesinden önce): **135 geçti, 35 atlandı**; iskelet düzeltmesinden sonra `pay book home shared` (iki proje): **88 geçti, 12 atlandı**.
- `npm run build` başarılı (dev sunucu durduruldu, build, yeniden başlatıldı, 200).
- `npx tsc --noEmit` temiz; `npx eslint .` (web) 0; `impeccable detect` 0.
- Ekran görüntüsü betiği `node web.js --out after --only pay,pay-failed` (tr, de × 1440, 390): 8 görüntü, taşma yok, kaçan yok; konsol hatası yalnızca oturumsuz `auth/me` 401 (beklenen). Ek durumlar geçici betikle (`page.route` ile bekletme/abort/iptal yanıtı): `{tr}-{1440,390}-pay-{loading,error,cancelled}.png`.

## Düzeltme turu 1 (inceleme)

| İnceleme bulgusu | Durum |
|---|---|
| 1 (Önemli). `?result=ok` ve rezervasyon hâlâ `odeme_bekliyor`: "Güvenli ödeme sayfası hazırlanıyor…" iskeleti, çıkış yok | **Kapandı**: ayrı "Ödemeniz onaylanıyor…" durumu (`LoadingState`, `role="status"`), yoklama sürer, ödeme başlatılmaz. **Sınırlı bekleme 75 sn** (`CONFIRM_WAIT_MS`; PayTR bildirimi genelde saniyeler içinde gelir, 75 sn yavaş bildirimi kapsar ama müşteriyi dakikalarca bekletmez). Süre dolunca kehribar `role="status"` uyarı: "Ödeme onayı henüz bize ulaşmadı. Kartınızdan ödeme çekildiyse yeniden ödemeyin…" + birincil **Durumu yenile** (hemen yeniden okur, bekleme baştan başlar) + **Ödemeye dön** (adresten `result` kalkar, yeni ödeme sayfası). Ek iş kuralı yok. Test: "returning with result=ok shows confirming state and offers recovery after the bounded wait" (`page.clock` ile 76 sn ileri) |
| 2 (Küçük). Sağlayıcı sayfası açıkken oturum dolarsa kurtarma yok | Açık P3 (`acik_konular.md`): sınırlı bekleme bu durumu kapsamıyor; sayfa yenilemesi yeni ödeme açar. K-42 gereği açıkken yeniden deneme yok |
| 3. `start()` için uçuştaki istek kilidi yok | **Kapandı**: `useRef` kilidi; aynı anda tek `POST payments`. Test: "retry double click starts only one payment" (iki eşzamanlı `click()`, önce 2 çağrı, sonra 1). Yeniden deneme adresteki `result`'ı da temizler |
| 4. Yoklama hataları yutuluyor | **Kapandı**: 401 (yoklama, yükleme veya başlatmada) → `RequireLogin`'in yeni `useSessionExpired()` bağlamı ile SMS girişi yeniden gösterilir (girişten sonra panel baştan yüklenir). Art arda **3** ağ/sunucu hatasında yoklama durur ve engellemeyen kehribar bildirim "Otomatik güncelleme durdu: sunucuya ulaşılamıyor." + **Durumu yenile** (başarılı okumada yoklama sürer). Testler: "poll 401 sends the user to login", "repeated poll network errors pause updates with a refresh action" |
| 5. Eksik testler | **Kapandı**: "poll turning paid shows success and redirects to the booking" (`?result=ok` → onaylanıyor → `?paid=1`), "poll turning cancelled shows the cancelled explanation", "404/403 booking shows final error with a link instead of retry", "large TRY amount fits on one line at 360px" (`route.fulfill` ile `12345.00 TRY` → `₺12.345,00`, tek satır, taşma yok) |
| 6. `kararlar.md` güncellenmedi | **Kapandı**: K-42 (açıkken yeniden deneme yok, başlatma kilidi, 75 sn onay beklemesi), K-43 (iskelet parıltısı hareket tercihine bağlı) |
| 7. `_log-only.json` gürültüsü | **Geri alındı**: dosya her `--only` çalıştırmasında son çalıştırmanın kaydıyla üzerine yazılan üretilmiş bir günlük; yalnızca geliştirme DB rezervasyon kodları değişmişti. B-W3 sonrası haline döndürüldü; taşma ölçümü (0 px) bu raporda |

Yeni mesajlar (tr, en, de, ru): `confirming`, `confirmSlow`, `refresh`, `backToPayment`, `pollPaused`; `pay` 24 anahtar, dört dilde eşit. Yeni stil: `.pay-paused`.

Kırmızı (uygulamadan önce, `-g "result=ok|poll|double click|final error|large TRY"`, desktop): **5 başarısız, 4 geçti**. Başarısızlar: result=ok ve paid testleri (`role=status` "Ödemeniz onaylanıyor" yok), çift tıklama (`Expected: 1, Received: 2`), 401 (`#otp-phone` yok), ağ hatası (`.pay-paused` yok). Geçenler (mevcut davranışı belgeleyen kapsama testleri): iptale dönen yoklama, 404, 403, büyük TRY tutarı.

Sonra: `pay.spec --project=desktop` **19 geçti** (paid testi ilk koşuda `waitForURL` "load" beklediği için düştü; yönlendirme istemci tarafı, `toHaveURL` ile düzeltildi). `npx playwright test pay book otp --workers=2` (iki proje): **99 geçti, 13 atlandı, 0 başarısız**; `tsc` temiz, `npx eslint .` (web) 0.

Görüntü: `screenshots/after/web/tr-{1440,390}-pay-confirm-slow.png`.

Değişen dosyalar: `web/components/PaymentPanel.tsx`, `web/components/RequireLogin.tsx` (`useSessionExpired` bağlamı, davranış aynı), `web/app/globals.css` (`.pay-paused`), `web/messages/{tr,en,de,ru}.json`, `web/e2e/pay.spec.ts` (20 test), `docs/kararlar.md` (K-42, K-43), `docs/proje_rehberi.md`, `docs/acik_konular.md`, `docs/test_senaryolari.md`, `docs/degisiklik_gunlugu.md`, `docs/ui-review/README.md`, `_log-only.json` (geri alındı).

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{pay,pay-failed}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{pay,pay-failed}.png`, `screenshots/after/web/tr-{1440,390}-pay-{loading,error,cancelled}.png`
