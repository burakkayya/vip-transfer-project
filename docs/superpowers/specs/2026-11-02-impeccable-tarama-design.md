# Impeccable arayüz taraması: tasarım (spec)

Tarih: 2026-11-02. Durum: inceleme bekliyor. Görev tanımı: `CLAUDE_CODE_TASIMA_PROMPTU.md`. Taban ve envanter: `docs/ui-review/README.md`. Ürün ve görsel kayıtlar: `PRODUCT.md`, `DESIGN.md`, `mobile/PRODUCT.md`, `mobile/DESIGN.md`.

## 1. Amaç ve başarı ölçütü

46 ekranın tamamını (web 13, admin 23, mobil 10) Impeccable döngüsüyle taramak ve iyileştirmek. Aynı iş içinde altı yeni dil eklenecek, gerçek mobil harita bağlanacak ve eksik test altyapısı kurulacak.

Başarı ölçütleri:
- Her ekranda **P0 ve P1 bulgu sayısı sıfır**.
- Her ekranda **axe ihlali sıfır** (WCAG 2.0, 2.1 ve 2.2 A+AA etiketleri).
- **critique puanı en az uygulanabilir azamî puanın %80'i** (ör. 32/40). Gelir akışında hedef %85.
- Backend testleri, `tsc`, lint ve build yeşil. Yeni Playwright, axe ve jest testleri yeşil.
- Ana akışlar (`docs/test_senaryolari.md` 1–13) uçtan uca yeniden geçer.

## 2. Kararlar (brainstorming, 2026-11-02)

| Konu | Karar |
|---|---|
| Görsel yön | Kimlik korunur, cesurlaşır. North Star: **"Kıyı Yolu"**. |
| Sıra | Önce gelir akışı (web → mobil müşteri → sürücü → admin operasyon → kalanlar → ikinci tarama). |
| Diller | fr, es, it, zh, ja, ar eklenir (K-34). Tüm düzenler RTL'ye ve uzun metne hazırlanır. |
| Yasal çeviri | Mevcut taslaklar çevrilir. Sayfada "taslak" uyarısına ek olarak "çeviri doğrulanmadı" notu çıkar. Yeni yasal içerik yazılmaz. |
| Animasyon | Artırılır (animate, delight, overdrive) ama yalnızca **web ve müşteri mobil** için. Sürücüde yalnızca durum geri bildirimi olur, admin'e animasyon eklenmez. `prefers-reduced-motion` zorunlu. |
| Admin | Yoğun düzen + temel klavye: kompakt satır, sabit başlık, tabular rakam, görünür odak, `/` ile filtre. Kısayol sistemi yok. |
| Harita | Native'de `react-native-maps` kullanılır, web önizlemesinde SVG kalır. Backend rota çizgisi (polyline) döndürür. |
| Vurgu | Şampanya pirinci az ve anlamlı kullanılır. Beyaz zeminde küçük metinde `champagne-brass-ink`. |
| Derinlik | Belirgin yükselti; elde tutulan öğeler yüzer. |
| Bileşen hissi | Yüzeye göre: web ve müşteri mobil dokunsal; admin rafine ve yoğun; sürücü iri hedefli. |
| Renk tokenları | Üç yüzeyde tek kaynak (bkz. §4). |
| Test altyapısı | web ve admin: ESLint + Playwright + `@axe-core/playwright`. mobile: ESLint + jest-expo + `@testing-library/react-native`. |
| Repo | `.claude/skills/impeccable`, `.claude/agents` ve taşıma promptu commit'lenir. `.claude/settings.local.json` `.gitignore`'a eklenir. Ekran görüntüleri PNG olarak commit'lenir. |
| Sürücü dili | Türkçe kalır; koda gömülü metinler sözlüğe taşınır. |

Değişmez kurallar (prompt §0): iş kuralları, fiyat formülü, iptal kademeleri, komisyon, para birimi ve veritabanı şeması değişmez. Fiyat istemcide hesaplanmaz. Adres jetonu ve ilçe kilidi korunur. KVKK ekranlarında karanlık desen kullanılmaz. Kapalı özellikler (PayTR canlı tahsilat, split, tam iade garantisi) satışa açılmaz. Kanıtsız "bitti" yazılmaz.

## 3. Dört hat

İş dört hatta ilerler. A, B ve D kendi dalı ve PR'ı ile birleşir. C ayrı dal açmaz; B dalında, her yüzeyin taraması bittikten sonra ayrı commit'ler olarak yapılır. Birleştirme kararı kullanıcınındır.

| Hat | Dal | İçerik | Bağımlılık |
|---|---|---|---|
| A. Altyapı | `chore/ui-infra` | Repo düzeni, doküman çelişkileri, ortak token kaynağı, lint ve test araçları, taban testleri | Yok; ilk ve tek başına |
| B. Arayüz taraması | `ui/impeccable-pass` | Ortak bileşenler, sonra ekran ekran Impeccable döngüsü, RTL hazırlığı, metin düzeltmeleri | A |
| C. Diller | B dalı içinde, yüzey sonunda | O yüzeyin 6 dili + Arapça RTL doğrulaması | İlgili yüzeyin B taraması |
| D. Harita | `feat/native-map` | Backend polyline (TDD), `react-native-maps`, SVG yedek | A; B ile yalnızca harita bileşeni sınırında buluşur |

B ve D paralel ilerleyebilir. D yalnızca `mobile/components/MapCanvas.tsx`, yeni `MapView` bileşenleri ve backend rota dosyalarına dokunur. B ise harita bileşeninin içine dokunmaz; yalnızca onu kullanan ekranlara dokunur.

## 4. Ortak token mimarisi

- **Kaynak:** kök `DESIGN.md` frontmatter'ındaki `colors` bloğu.
- **Üreteç:** `scripts/sync-tokens.mjs` (bağımlılıksız Node betiği). Renk bloğunu okur ve şunları üretir:
  - `web/app/tokens.css` ve `admin/app/tokens.css`: `:root` CSS değişkenleri.
  - `mobile/lib/tokens.ts`: `colors` nesnesi.
- **Mevcut adlarla uyum:** Üretilen dosyalar mevcut değişken adlarını korur (`--ink`, `--muted`, `--accent` vb. → yeni token değerleri) ve yeni adları ekler (`--brass-ink`, `--faint`, `--danger-soft` vb.). Böylece mevcut CSS kırılmaz.
- **Denetim:** `node scripts/sync-tokens.mjs --check` üretilen dosyalar kaynakla eşleşmezse ve `mobile/DESIGN.md` renkleri kök ile aynı değilse hata verir. Lint betiklerine ve CI'ya bağlanır.
- **Mobil göçü:** Mobil, `ui.tsx` içindeki `colors` nesnesi yerine `lib/tokens.ts`'i kullanır. Ekranlardaki token dışı renkler (`"#fff"` dahil 69 kullanım, `#A3A3A3`, `#8A6A37`, `#2D5A43`, `#7FD3A4`, `#5C4A1C`) token'a bağlanır. Koyu zemin üstü metin için `onDark` opaklık tokenları (`0.72`, `0.6`, `0.28`) eklenir. Tekrar eden yazı boyutları `type` ölçeğine (`hint`, `caption 13`, `title 18`, `headline 26`) toplanır. Bu, `extract` adımının tek yüksek değerli işidir.
- **Extract değerlendirmesi:** Web ve admin zaten sınıf tabanlı ortak bileşenlere sahip. Yeni çıkarılacaklar yalnızca üç veya daha fazla kez aynı amaçla tekrar edenler:
  - web: `LoadingState`, `EmptyState` (`BookingDetail`, `AccountPanel` ve `PaymentPanel` yüklenirken `null` döndürüyor)
  - admin: zaten var olan `Table empty` ve `ErrorBox`'un tüm ekranlara yayılması
  - mobil: `OnDarkText` ve `type` ölçeği

## 5. Test ve doğrulama altyapısı (hat A)

- **web, admin:**
  - `eslint` + `eslint-config-next` (core-web-vitals) + `eslint-plugin-jsx-a11y` (recommended) ve `lint` betiği. Mevcut ihlaller toplu düzeltilmez ve `eslint-disable` ile susturulmaz; dosya bazında `docs/ui-review/lint-taban.md`'ye yazılır. Her ekran görevi kendi dosyalarının ihlallerini sıfırlar. Kapanışta (prompt §7) `lint` sıfır ihlalle zorunlu olur.
  - `@playwright/test` + `@axe-core/playwright` ve `test:e2e` betiği. Testler çalışan sunucuya (3000/3001) karşı koşar.
  - Ortak yardımcı `e2e/a11y.ts`: `expectNoAxeViolations(page)`, WCAG etiketleriyle.
  - Admin e2e testleri giriş gerektirir. Parola ve TOTP sırrı yalnızca ortam değişkeninden (`ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD`, `ADMIN_E2E_TOTP_SECRET`) okunur ve repoya yazılmaz. Bu değerler yoksa admin testleri atlanır ve atlandıkları raporlanır.
- **mobile:**
  - `eslint-config-expo` ve `lint`.
  - `jest-expo` + `@testing-library/react-native` ve `test`. Bileşen ve ekran testleri `__tests__/` altına yazılır.
  - Görsel doğrulama web önizlemesi (Playwright) ve Android emülatörü (`getaway_pixel7`, `getaway_driver`) üzerinden yapılır.
- **Ekran görüntüleri:** `scripts/ui-shots/` altında Playwright betikleri. Taban betikleri buraya taşınır ve "sonra" görüntüleri aynı adlarla `docs/ui-review/screenshots/after/` altına alınır.
- **Taban testleri:** hat A sonunda backend pytest, tsc, lint, build ve yeni e2e testleri worktree'de yeşil.

## 6. Ekran döngüsü (hat B)

Her ekran ayrı bir görevdir ve ayrı bir commit'tir: `ui(<yuzey>/<ekran>): impeccable pass - <özet>`.

1. `critique` + `audit` (önce puan, P0–P3 listesi), `npx impeccable detect <dosyalar>`.
2. P0/P1 düzeltmesi. Davranış değişikliği için önce kırmızı test yazılır (TDD): doğrulama, hata ve boş durumu, erişilebilirlik etiketi. Salt görsel değişiklik ekran görüntüsüyle doğrulanır.
3. `harden`: yükleniyor, boş, hata ve ağ hatası durumları; uzun Almanca metin; çok uzun ad ve adres; büyük tutar; EUR/TRY biçimi; mantıksal CSS özellikleri.
4. `adapt`: 360, 390, 768, 1024, 1440 px.
5. `clarify`: o ekranın 4 dildeki metinleri. Anahtarlar tüm dillerde eksiksiz olur. Yasal metne dokunulmaz.
6. `optimize`: görsel, LCP, istemci JS'i, liste performansı.
7. `onboard`: yalnızca ilk kullanım veya boş durumu olan ekranlarda.
8. `animate` / `delight` / `overdrive`: yalnızca web ve müşteri mobil.
9. `polish`, ardından `critique` + `audit` (sonra puan).
10. Rapor: `docs/ui-review/<yuzey>-<ekran>.md`.

Ortak dosyalar (`web/app/globals.css`, `web/app/home.css`, `admin/app/globals.css`, `admin/components/ui.tsx`, `mobile/components/ui.tsx`, mesaj dosyaları) her yüzeyin başında **tek başına ve sırayla** değiştirilir. Bu dosyalara dokunan ekran görevleri paralel çalışmaz.

## 7. Diller ve RTL (hat C)

- **web:** `messages/{fr,es,it,zh,ja,ar}.json` eklenir ve `i18n/routing.ts` `locales` listesi 10 dile çıkar. `[locale]/layout.tsx` `dir` özniteliğini dile göre ayarlar (`ar` → `rtl`). Yazı tipi alt kümeleri genişletilir. Inter Arapça ve CJK içermediği için `ar`, `zh` ve `ja`'da sistem yazı tipine düşülür ve bu durum DESIGN.md'ye işlenir. `defaultCountry` yeni dillere eşlenir.
- **Yasal sayfalar:** Yeni dillerde mevcut taslak çevrilir. `legal.translationNotice` anahtarı "Bu çeviri hukukçu tarafından doğrulanmadı" notunu taşır. Not yalnızca yeni 6 dilde görünür. Şirket yer tutucuları (`web/lib/site.ts`) aynen kalır.
- **mobil müşteri:** `lib/i18n.ts` sözlüğü 10 dile çıkar. Arapçada `I18nManager.forceRTL` kullanılır; uygulama yeniden yüklemesi gerekir ve bu durum belgelenir.
- **Sürücü:** Türkçe kalır; gömülü metinler `tr` sözlüğüne taşınır.
- **Anahtar bütünlüğü:** Bir test (web için Node, mobil için jest) tüm dillerin `tr` ile aynı anahtar kümesine sahip olduğunu doğrular.
- **Çeviri kalitesi:** Çeviriyi Claude yapar. Fiyat, iptal ve ödeme metinleri `fiyatlandirma.md` ve K-14 ile birebir uyumlu olur. Bu kurallara dair yeni bir iddia eklenmez.
- **Bildirim şablonları:** Bunlar veritabanı verisidir, kod değişikliği gerektirmez. Eksik dilde İngilizceye düşülür. Admin'den eklenmeleri `acik_konular.md`'ye yazılır.

## 8. Harita ve rota çizgisi (hat D)

**Backend** (kural 1 gereği kullanıcı onayladı, TDD ile):
- `providers/routing.py` içindeki `Route` sınıfına `polyline: str | None` (Google "encoded polyline") alanı eklenir.
  - `GoogleRouting`, alan maskesine `routes.polyline.encodedPolyline` ekler.
  - `HaversineRouting` iki noktalı düz çizgiyi kodlar.
- **API:** Sürücü yolculuk yanıtına (`TripOut`) ve müşteri rezervasyon detayındaki ayak bilgisine isteğe bağlı `route_polyline` alanı eklenir. Bu değişiklik **eklemelidir**; mevcut istemcileri bozmaz.
- **Saklama:** Veritabanı şeması değişmez. Polyline, ayağın gerçek alış ve bırakış koordinatları için istek anında hesaplanır ve Redis'te ayak kimliğiyle 24 saat önbelleğe alınır. Fiyat hesabı ilçe merkezleri arasındaki mesafeyle kaldığı için polyline fiyatı etkilemez.
- **Testler:** sahte sağlayıcının polyline'ı, `TripOut` ve müşteri detayında alanın varlığı, Redis önbellek isabeti, Google yanıtının ayrıştırılması.

**Mobil:**
- `react-native-maps` eklenir (`npx expo install`). iOS'ta Apple Maps, Android'de Google kullanılır.
- Android anahtarı `app.config.ts` içinde `process.env.GETAWAY_GOOGLE_MAPS_ANDROID_KEY` ile okunur ve repoya yazılmaz. Anahtar yoksa Expo Go'nun gömülü anahtarıyla geliştirme yapılır; mağaza derlemesi anahtar bekler (`hesap_kurulumu.md`).
- `MapCanvas.tsx` aynı arayüzle iki uygulamaya ayrılır: `MapCanvas.native.tsx` gerçek harita, `MapCanvas.web.tsx` mevcut SVG.
- Gösterilenler: polyline, alış dairesi, varış karesi (rota rayı dili) ve sürücü konumu.
- Erişilebilirlik: Harita ekran okuyucuya metin özeti verir ("Sürücü alış noktasına 3 km").
- Doğrulama Android emülatöründe ve jest ile (harita modülü taklit edilerek) yapılır.

## 9. Raporlama ve dokümanlar

- Her ekran için `docs/ui-review/<yuzey>-<ekran>.md`: önce ve sonra puanı, P0–P3 bulguları ve durumları, değişen dosyalar, uygulanamayanlar ve nedenleri, önce ve sonra görüntüleri.
- `docs/ui-review/README.md`: tüm ekranların durum tablosu.
- `CLAUDE.md` gereği her değişiklikte güncellenecekler: `degisiklik_gunlugu.md`, `proje_rehberi.md` (durum matrisi), kök `README.md`, gerekirse `test_senaryolari.md` ve `ekranlar.md`. Yeni kararlar K-36'dan itibaren `kararlar.md`'ye yazılır. Bu brainstorming'in kalıcı kararları ilk docs commit'inde K-36 ve sonrası olarak işlenir: dil kapsamı, yasal çeviri, harita ve polyline, token kaynağı.
- Her yüzey sonunda Türkçe kısa özet verilir. `requesting-code-review` ile inceleme istenir; kritik bulgu varken sonraki yüzeye geçilmez.

## 10. Kapsam dışı

- Günlük araç kiralama (K-29) ekranları.
- Push bildirimi (FCM).
- Uçuş takip API'si. Sitedeki "uçuş takibi" iddiası `clarify` adımında yalnızca raporlanır; metni değiştirme kararı kullanıcıya sorulur.
- Gerçek yorum ve puan kanıtları (sahibi sonra verecek).
- PayTR, iyzico ve e-Arşiv entegrasyonları.

## 11. Riskler

| Risk | Önlem |
|---|---|
| Kapsam büyük (46 ekran + 6 dil + harita) | Hatlar ayrı PR olur; her yüzey sonunda durup onay alınır. |
| Çeviri kalitesi, özellikle yasal metin | "Çeviri doğrulanmadı" notu kullanılır, `acik_konular.md`'ye hukukçu kontrolü maddesi yazılır. |
| `react-native-maps` web'i kırar | `.native.tsx` / `.web.tsx` ayrımı yapılır, web önizlemesi e2e ile denetlenir. |
| Metro dosya değişikliklerini izlemiyor (bilinen) | Önizleme sunucuları değişiklik sonrası `--clear` ile yeniden başlatılır. |
| Admin ekran görüntüleri 2FA ister | Admin yüzeyine gelince kullanıcıdan oturum açması veya ortam değişkenleri istenir. |
| ARQ iş kuyruğu çalışmıyor | Arayüzü etkilemez. Ana akış testinden önce başlatılır ve raporda belirtilir. |
