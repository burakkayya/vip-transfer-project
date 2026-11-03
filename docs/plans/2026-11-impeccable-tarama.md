# Impeccable Arayüz Taraması: Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 46 ekranın tamamını Impeccable döngüsüyle iyileştirmek. Aynı iş içinde 6 dil eklenecek, gerçek mobil harita ve backend rota çizgisi bağlanacak, eksik test ve lint altyapısı kurulacak.

**Architecture:** Dört hat vardır. Hat A (`chore/ui-infra`) altyapıyı kurar. Hat B (`ui/impeccable-pass`) yüzey yüzey tarama yapar; her yüzey önce ortak dosyalarla başlar, sonra ekran ekran ilerler. Hat C dilleri ekler; ayrı dal açmaz, B dalında yüzey sonunda çalışır. Hat D (`feat/native-map`) önce backend polyline'ı TDD ile ekler, sonra native haritayı bağlar. B ve D, A'dan dallanır ve paralel ilerleyebilir.

**Tech Stack:** Next.js 15.5 + next-intl (web, admin), Expo SDK 58 + React Native 0.88 + expo-router (mobil), FastAPI + SQLAlchemy + Redis (backend), Playwright + `@axe-core/playwright`, jest-expo + `@testing-library/react-native`, ESLint 9 (flat config), pytest.

**Spec:** `docs/superpowers/specs/2026-11-02-impeccable-tarama-design.md`. Yürütücüler planı ve spec'i birlikte okur. Bağlam dosyaları: `PRODUCT.md`, `DESIGN.md`, `mobile/PRODUCT.md`, `mobile/DESIGN.md`, `docs/ui-review/README.md`.

## Global Constraints

- Yanıtlar, raporlar ve dokümanlar Türkçe yazılır. Kod, commit mesajı ve teknik adlar İngilizce olabilir.
- Her değişiklikte `docs/degisiklik_gunlugu.md` tarihli satırla güncellenir. Kapsama göre ayrıca `docs/proje_rehberi.md` (durum matrisi), kök `README.md` (durum tablosu), `docs/test_senaryolari.md` (akış değiştiyse), `docs/ekranlar.md` (ekran eklendi veya çıktıysa), `docs/kararlar.md` (K-36'dan itibaren) ve `docs/acik_konular.md` güncellenir.
- Araç tipleri yalnızca `minivan`, `vip_van`, `minibus`, `vip_minibus` (K-35). Sedan geri eklenmez.
- Parola, anahtar ve TOTP sırrı repoya yazılmaz; yalnızca ortam değişkeninden okunur.
- Değiştirilmeyecekler: fiyat formülü, iptal kademeleri (48 saat ve üzeri %100, 24-48 saat %50, 24 saatten az %0), komisyon, para birimi kuralı (TR → TRY, diğerleri EUR), veritabanı şeması. Fiyat istemcide hesaplanmaz. Adres jetonu ve ilçe kilidi korunur.
- Hat D'nin eklemeli API alanı (`route_polyline`) dışında backend değişikliği gerekirse durulur ve kullanıcıya sorulur.
- Yasal metinlerin içeriği değiştirilmez ve uydurulmaz. Yalnızca yeni dillere taslak olarak çevrilir; çeviride `legal.translationNotice` notu gösterilir.
- KVKK/GDPR ekranlarında önceden işaretli kutu olmaz. Aydınlatma, açık rıza ve pazarlama onayı ayrı kalır. Reddetme seçeneği kabul kadar görünür olur.
- PayTR canlı tahsilat, split aktarım ve tam iade garantisi satışı açılmaz.
- WCAG 2.2 AA. Sürücü uygulamasında dokunma hedefleri en az 48 dp. `prefers-reduced-motion` ve sistem "hareketi azalt" ayarı her animasyonda uygulanır.
- Kabul ölçütleri her ekranda: P0 = 0, P1 = 0, axe ihlali = 0 (etiketler `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). critique puanı uygulanabilir azamî puanın en az %80'i olmalı; gelir akışında (web ana sayfa → book → OTP → pay → payment-result → bookings/[code]) en az %85.
- Animasyon artışı (`animate`, `delight`, `overdrive`) yalnızca web ve müşteri mobil içindir. Sürücü uygulamasında yalnızca durum geri bildirimi olur. Admin'e animasyon eklenmez.
- Renk tokenlarının tek kaynağı kök `DESIGN.md` frontmatter `colors` bloğudur. Elle yazılan hex yalnızca üretilmiş dosyalarda bulunur.
- Kanıtsız "bitti" yazılmaz. Her görevin sonunda komut çıktısı, test sonucu veya ekran görüntüsü gösterilir (superpowers:verification-before-completion).
- Her ekran ayrı commit olur: `ui(<yuzey>/<ekran>): impeccable pass - <özet>`.
- Merge, PR açma ve dal silme kararı kullanıcınındır. Ajan merge etmez.

## Review Focus

1. **Uzun Almanca metin ve 360 px genişlik.** Düğme, başlık ve fiyat satırları taşmamalı veya kesilmemeli. Her ekran görevinin `adapt` adımına `de` + 360 px Playwright testi eklenir (`expect(scrollWidth).toBeLessThanOrEqual(innerWidth)`).
2. **Ağ hatası ve yavaş backend.** Her ağ çağrısı bir yükleniyor durumu ve yeniden deneme içeren bir hata durumu göstermeli; boş ekran kalmamalı. Web için `page.route('**/bff/**', r => r.abort())` testi `PaymentPanel` (B-W4), `BookingDetail` (B-W6) ve `AccountPanel` (B-W9) görevlerinde eklenir. Mobil için `api` taklitli jest testi B-M3'te eklenir.
3. **TRY'de büyük tutar.** `₺12.345,00` gibi tutarlar hem araç kartında hem özet kartında tek satırda ve `tabular-nums` ile görünmeli. B-W2'de `country=TR` + uzun rota testi eklenir.
4. **`dir="rtl"` (Arapça) altında rota rayı ve oklar.** Daire ve kare doğru tarafta, oklar ayna olmalı, metin sağa hizalı olmalı. C-W1 ve C-M1'de `ar` ekran görüntüsü ve DOM denetimi (`getComputedStyle(...).direction === 'rtl'`) yapılır.
5. **Klavyeyle gezinme.** Rezervasyon ve admin tablolarında Tab sırası mantıklı, odak görünür, Esc ile açılır pencere kapanır olmalı. B-W2 (adres önerileri), B-A0 (`/` kısayolu) ve B-A3 (eşleştirme) görevlerinde `page.keyboard` testleri eklenir.

---

## Dosya yapısı (yeni ve önemli değişenler)

| Yol | Sorumluluk |
|---|---|
| `scripts/sync-tokens.mjs` | `DESIGN.md` renk bloğundan `web/app/tokens.css`, `admin/app/tokens.css` ve `mobile/lib/tokens.ts` üretir; `--check` ile denetler |
| `scripts/sync-tokens.test.mjs` | `node --test` birim testleri |
| `web/app/tokens.css`, `admin/app/tokens.css` | Üretilmiş `--color-*` CSS değişkenleri (elle düzenlenmez) |
| `mobile/lib/tokens.ts` | Üretilmiş `palette` nesnesi (elle düzenlenmez) |
| `web/eslint.config.mjs`, `admin/eslint.config.mjs`, `mobile/eslint.config.js` | ESLint flat config |
| `web/playwright.config.ts`, `admin/playwright.config.ts` | e2e yapılandırması (`baseURL` 3000 ve 3001) |
| `web/e2e/a11y.ts`, `admin/e2e/a11y.ts` | `expectNoAxeViolations(page: Page, opts?: { include?: string; exclude?: string[] }): Promise<void>` |
| `web/e2e/*.spec.ts`, `admin/e2e/*.spec.ts` | Ekran testleri |
| `admin/e2e/auth.setup.ts` | Ortam değişkeniyle giriş ve TOTP; değişken yoksa `test.skip` |
| `mobile/jest.config.js`, `mobile/jest.setup.ts`, `mobile/__tests__/` | jest-expo |
| `scripts/ui-shots/` | Önce ve sonra ekran görüntüsü betikleri ve kendi `package.json`'ı |
| `docs/ui-review/<yuzey>-<ekran>.md` | Ekran raporları |
| `docs/ui-review/lint-taban.md` | Dosya bazında mevcut lint ihlalleri |
| `backend/app/providers/polyline.py` | `encode(points: list[tuple[float, float]]) -> str`, `decode(s: str) -> list[tuple[float, float]]` |
| `backend/app/services/route_line.py` | `route_polyline(leg: BookingLeg) -> str \| None` (Redis önbellekli) |
| `mobile/lib/polyline.ts` | `decodePolyline(s: string): { latitude: number; longitude: number }[]` |
| `mobile/components/MapCanvas.native.tsx`, `MapCanvas.web.tsx` | Gerçek harita ve SVG; ortak `MapCanvasProps` (`mobile/components/mapTypes.ts`) |

---

# Hat A: Altyapı (`chore/ui-infra`, mevcut checkout)

Dal açıldı ve tasarım belgeleri commit'lendi (`abbc4e4`). Bu hattın görevleri sırayla ve tek başına yürütülür.

### Task A1: Doküman çelişkileri ve yeni kararlar

**Files:**
- Modify: `README.md` (araç tipleri satırı, "Uçuş verisi … 24 saat (K-18)" satırı, durum tablosu)
- Modify: `docs/proje_rehberi.md` (§4 tablo bütünlüğü, §5 "K-01 ... K-34" → "K-01 ... K-40", K-35–K-40 satırları)
- Modify: `docs/acik_konular.md` (araç çarpanlarına `vip_minibus 2,40`, Ürün maddesine VIP minibüs; ARQ notu; uçuş takibi iddiası maddesi; bildirim şablonlarının 6 dili; yasal çevirilerin hukukçu kontrolü)
- Modify: `mobile/README.md` ("EAS Build yapılandırması … eklenecek" → eklendi)
- Modify: `docs/hesap_kurulumu.md` (Cloudflare satırında "GoDaddy" → "Turhost", K-25)
- Modify: `web/README.md` ("Inter, Playfair Display" → "Inter")
- Modify: `docs/ekranlar.md` (Admin: 19 → 23 rota; `exchange-rates`, `account`; panelde canlı harita yok, OSM bağlantısı; web'de `account`, `booking/payment-result`, 404; "değişiklik" maddeleri → "değişiklik e-postayla"; mobil "bildirim tercihleri" → "pazarlama tercihi; push bekliyor")
- Modify: `docs/kararlar.md` (K-36 … K-40 eklenir)
- Modify: `docs/degisiklik_gunlugu.md`

**Interfaces:**
- Produces: K-36 … K-40 numaraları. Sonraki görevler bunlara atıf yapar.

- [ ] **Step 1: Kararları yaz.** `docs/kararlar.md` tablosuna şu beş satır eklenir (Durum: `Kesin (2026-11-02)`):
  - K-36: Arayüz dilleri: fr, es, it, zh, ja, ar eklenir (K-34'ün uygulaması). Yasal metinler taslak çeviri olarak, "çeviri doğrulanmadı" notuyla yayımlanır. Sürücü uygulaması Türkçe kalır.
  - K-37: Mobil harita: iOS Apple Maps, Android Google (react-native-maps). Web önizlemesinde SVG kalır. Backend `route_polyline` döndürür; şema değişmez, Redis'te 24 saat önbellek. Fiyat ilçe merkezleriyle kalır.
  - K-38: Renk tokenlarının tek kaynağı kök `DESIGN.md`. `scripts/sync-tokens.mjs` web, admin ve mobil dosyalarını üretir.
  - K-39: Görsel yön "Kıyı Yolu" (`DESIGN.md`). Kimlik korunur ve cesurlaşır. Animasyon artışı yalnızca web ve müşteri mobilde. Admin yoğun ve temel klavye desteğiyle.
  - K-40: Ön yüz test altyapısı: web ve admin için ESLint + Playwright + axe; mobil için ESLint + jest-expo + RNTL. Kabul ölçütü: P0/P1 = 0, axe = 0, critique en az %80.
- [ ] **Step 2: Çelişkileri düzelt.** Yukarıdaki "Files" listesindeki her düzeltme yapılır. Yalnızca olgular değişir, yeni iddia eklenmez.
- [ ] **Step 3: Doğrula.**
  - Run: `git grep -nE "Minivan, VIP Van, Minibüs\.|24 saat sonra silinir \(K-18\)|K-01 \.\.\. K-34|GoDaddy|Playfair"` → Expected: çıktı yok (yalnızca `degisiklik_gunlugu.md` geçmiş satırları kalabilir).
  - Run: `git grep -c "K-40" docs/kararlar.md` → Expected: `1`.
- [ ] **Step 4: Commit.** `git commit -m "docs: doküman çelişkileri düzeltildi, K-36..K-40 kararları"`

### Task A2: Tek token kaynağı (`sync-tokens`)

**Files:**
- Create: `scripts/sync-tokens.mjs`, `scripts/sync-tokens.test.mjs`
- Create (üretilmiş): `web/app/tokens.css`, `admin/app/tokens.css`, `mobile/lib/tokens.ts`
- Modify: `web/app/[locale]/layout.tsx` ve `admin/app/layout.tsx` (`import "../tokens.css"` / `import "./tokens.css"`, `globals.css`'ten önce)
- Modify: `web/app/globals.css:2-26`, `admin/app/globals.css:2-17` (`:root` anlamsal değişkenleri `var(--color-…)`'e bağlanır)

**Interfaces:**
- Produces:
  - `parseColors(markdown: string): Record<string, string>`: frontmatter'daki `colors:` bloğunu okur. Anahtarlar kebab-case, değerler küçük harf hex.
  - `renderCss(colors): string`: `:root { --color-<ad>: <hex>; … }` başında `/* GENERATED by scripts/sync-tokens.mjs — do not edit */` satırıyla.
  - `renderTs(colors): string`: `export const palette = { lacquerBlack: "#0b0b0c", … } as const;` (camelCase) ve `export type PaletteKey = keyof typeof palette;`.
  - CLI: `node scripts/sync-tokens.mjs` yazar. `node scripts/sync-tokens.mjs --check` dosyalar farklıysa veya `mobile/DESIGN.md` renkleri kökten farklıysa `exit 1` ve fark listesi.
- Web anlamsal eşleme (değerler aynı kalır): `--ink → lacquer-black`, `--ink-2 → lacquer-black-raised`, `--bg/--surface → paper`, `--soft → limestone`, `--soft-2 → limestone-deep`, `--text → lacquer-black`, `--muted → slate-text`, `--line → hairline`, `--line-strong → hairline-strong`, `--accent → champagne-brass`, `--danger → signal-red`, `--ok → pine-green`, `--warn → amber-ink`. Yeni anlamsal değişkenler: `--faint → slate-faint`, `--brass-ink → champagne-brass-ink`, `--danger-soft`, `--ok-soft`, `--warn-soft`. Admin aynı eşlemeyi kullanır, yalnızca `--bg → harbor-canvas` ve `--soft → limestone` (`#f3f3f1` → `#f5f5f3`, bilinçli birleştirme).

- [ ] **Step 1: Failing test yaz** (`scripts/sync-tokens.test.mjs`, `node:test`):
  ```js
  test("parseColors reads the colors block only", () => {
    const md = '---\nname: X\ncolors:\n  lacquer-black: "#0B0B0C"\n  paper: "#ffffff"\ntypography:\n  body:\n    fontSize: "16px"\n---\n# Body';
    assert.deepEqual(parseColors(md), { "lacquer-black": "#0b0b0c", paper: "#ffffff" });
  });
  test("renderTs camelCases keys", () => {
    assert.match(renderTs({ "champagne-brass-ink": "#8a6a3c" }), /champagneBrassInk: "#8a6a3c"/);
  });
  test("renderCss prefixes --color-", () => {
    assert.match(renderCss({ paper: "#ffffff" }), /--color-paper: #ffffff;/);
  });
  test("--check fails when mobile DESIGN.md colors differ", async () => { /* geçici dizinde iki DESIGN.md, farklı paper → exit 1 */ });
  ```
- [ ] **Step 2: Kırmızıyı gör.** Run: `node --test scripts/` → Expected: FAIL (`Cannot find module './sync-tokens.mjs'`).
- [ ] **Step 3: `scripts/sync-tokens.mjs`'i yaz.** Bağımlılık yok. Ayrıştırıcı yalnızca `colors:` satırından sonraki iki boşluk girintili `key: "value"` satırlarını okur ve ilk girintisiz satırda durur. Testlerin dosya yollarını değiştirebilmesi için kök dizin `--root <dir>` ile verilebilir.
- [ ] **Step 4: Yeşili gör.** Run: `node --test scripts/` → Expected: 4 pass.
- [ ] **Step 5: Üret ve bağla.** `node scripts/sync-tokens.mjs` çalıştırılır, ardından iki layout'a `tokens.css` import'u eklenir ve iki `globals.css` `:root`'u yukarıdaki eşlemeye bağlanır.
- [ ] **Step 6: Görsel değişmediğini doğrula.**
  - Run: `cd web && npm run build` ve `cd admin && npm run build` → Expected: rc=0.
  - Sunucular yeniden başlatılır. A6 henüz yapılmadığı için taban betikleri kullanılır: oturum geçici klasöründeki `pw/web-shots.js` ve `pw/admin-axe.js`, çıktı geçici bir klasöre. Ana sayfa, book ve admin giriş görüntüleri "önce" ile göz kontrolünde aynı olmalı. Admin'de `--soft` için 2 birimlik ton farkı beklenen tek farktır.
  - Run: `node scripts/sync-tokens.mjs --check` → Expected: `tokens in sync` ve exit 0.
- [ ] **Step 7: Commit.** `git commit -m "chore(tokens): DESIGN.md renklerinden web/admin/mobil token üreteci"`

### Task A3: Web lint + Playwright + axe

**Files:**
- Modify: `web/package.json` (devDependencies: `eslint@^9`, `eslint-config-next@15.5.x`, `@eslint/eslintrc`, `eslint-plugin-jsx-a11y`, `@playwright/test`, `@axe-core/playwright`; scripts: `"lint": "eslint ."`, `"test:e2e": "playwright test"`)
- Create: `web/eslint.config.mjs` (FlatCompat: `next/core-web-vitals`, `plugin:jsx-a11y/recommended`; `ignores: [".next", "e2e/.auth"]`)
- Create: `web/playwright.config.ts` (`baseURL: process.env.WEB_URL ?? "http://localhost:3000"`; projeler: `desktop` 1440×900, `phone` 390×844 `isMobile`; `reporter: "list"`; `webServer` yok, sunucu ayakta varsayılır)
- Create: `web/e2e/a11y.ts`, `web/e2e/smoke.spec.ts`
- Modify: `.gitignore` (`web/test-results/`, `web/playwright-report/`, `admin/test-results/`, `admin/playwright-report/`)
- Create: `docs/ui-review/lint-taban.md`

**Interfaces:**
- Produces: `expectNoAxeViolations(page: Page, opts?: { include?: string; exclude?: string[] }): Promise<void>`. AxeBuilder'ı Global Constraints'teki etiketlerle çalıştırır. İhlal varsa `id`, `impact` ve ilk hedefi listeleyen bir hata mesajıyla `expect(violations).toEqual([])` başarısız olur.

- [ ] **Step 1: Bağımlılıkları kur.** Run: `cd web && npm i -D eslint@^9 eslint-config-next@15.5.28 @eslint/eslintrc eslint-plugin-jsx-a11y @playwright/test @axe-core/playwright && npx playwright install chromium` → Expected: rc=0.
- [ ] **Step 2: Smoke testini yaz** (`web/e2e/smoke.spec.ts`):
  ```ts
  test("home renders localized hero", async ({ page }) => {
    await page.goto("/tr");
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
  ```
- [ ] **Step 3: Çalıştır.** Run: `cd web && npx playwright test smoke` → Expected: 2 passed (desktop + phone).
- [ ] **Step 4: Lint tabanını çıkar.** Run: `cd web && npx eslint . -f json -o "$TEMP/lint-web.json"; npx eslint . | tail -3` → ihlal sayısı dosya bazında (kural kimliğiyle) `docs/ui-review/lint-taban.md`'nin "web" bölümüne yazılır. Mevcut ihlaller düzeltilmez ve susturulmaz.
- [ ] **Step 5: tsc ve build.** Run: `npx tsc --noEmit && npm run build` → Expected: rc=0.
- [ ] **Step 6: Commit.** `git commit -m "chore(web): ESLint, Playwright ve axe altyapısı"`

### Task A4: Admin lint + Playwright + axe + kimlik doğrulamalı oturum

**Files:**
- Modify: `admin/package.json` (A3 ile aynı paketler + `otpauth`; aynı betikler)
- Create: `admin/eslint.config.mjs`, `admin/playwright.config.ts` (`baseURL` 3001, `setup` projesi `auth.setup.ts`, diğer projeler `storageState: "e2e/.auth/admin.json"`)
- Create: `admin/e2e/a11y.ts` (web ile aynı imza), `admin/e2e/auth.setup.ts`, `admin/e2e/smoke.spec.ts`
- Modify: `.gitignore` (`admin/e2e/.auth/`)

**Interfaces:**
- Consumes: `ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD`, `ADMIN_E2E_TOTP_SECRET` (yalnızca ortam).
- Produces: `e2e/.auth/admin.json` oturum dosyası (gitignore'da). Değişkenler yoksa `test.skip(true, "ADMIN_E2E_* tanımlı değil")`.

- [ ] **Step 1: Kur.** Run: `cd admin && npm i -D eslint@^9 eslint-config-next@15.5.28 @eslint/eslintrc eslint-plugin-jsx-a11y @playwright/test @axe-core/playwright otpauth` → rc=0.
- [ ] **Step 2: Testleri yaz.**
  - `smoke.spec.ts` "login page has no axe violations": `/login`'e gidilir, `expectNoAxeViolations(page)` çağrılır.
  - `auth.setup.ts`: e-posta ve parola girilir, TOTP kodu `new OTPAuth.TOTP({ secret }).generate()` ile üretilir, `**/` bekleme yapılır, `storageState` kaydedilir.
- [ ] **Step 3: Çalıştır.** Run: `npx playwright test smoke` → Expected: 2 passed (taban ölçümünde admin girişi 0 ihlaldi). Auth setup, değişkenler yoksa "skipped" olarak raporlanır.
- [ ] **Step 4: Lint tabanı.** `docs/ui-review/lint-taban.md`'nin "admin" bölümü doldurulur.
- [ ] **Step 5: tsc ve build.** Expected: rc=0.
- [ ] **Step 6: Commit.** `git commit -m "chore(admin): ESLint, Playwright, axe ve ortam değişkenli 2FA oturumu"`

### Task A5: Mobil lint + jest-expo + RNTL

**Files:**
- Modify: `mobile/package.json` (`npx expo install jest-expo jest @testing-library/react-native @types/jest`; `npm i -D eslint@^9 eslint-config-expo`; scripts: `"lint": "eslint ."`, `"test": "jest"`)
- Create: `mobile/eslint.config.js` (`eslint-config-expo/flat`), `mobile/jest.config.js` (`preset: "jest-expo"`, `setupFilesAfterEnv: ["./jest.setup.ts"]`), `mobile/jest.setup.ts` (`expo-haptics`, `expo-secure-store` ve `react-native-reanimated/mock` taklitleri)
- Create: `mobile/__tests__/ui.test.tsx`

- [ ] **Step 1: Failing test yaz** (`mobile/__tests__/ui.test.tsx`):
  ```tsx
  test("statusTone maps booking statuses", () => {
    expect(statusTone("onaylandi")).toBe("ok");
    expect(statusTone("iptal")).toBe("danger");
  });
  test("Button exposes button role and label", () => {
    render(<Button title="Devam" onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Devam" })).toBeTruthy();
  });
  ```
- [ ] **Step 2: Çalıştır.** Run: `cd mobile && npx jest` → Expected: 2 passed. `statusTone` dönüşleri `ui.tsx:650`'deki gerçek eşlemeye göre ayarlanır; test bir varsayımı değil mevcut davranışı sabitler.
- [ ] **Step 3: Lint tabanı.** Run: `npx eslint . | tail -3` → `lint-taban.md`'nin "mobile" bölümü doldurulur.
- [ ] **Step 4: tsc.** Run: `npx tsc --noEmit` → rc=0. Run: `npx expo install --check` → temiz.
- [ ] **Step 5: Commit.** `git commit -m "chore(mobile): ESLint ve jest-expo + RNTL altyapısı"`

### Task A6: Ekran görüntüsü betikleri repoya

**Files:**
- Create: `scripts/ui-shots/package.json` (`playwright-core`, `@axe-core/playwright`), `scripts/ui-shots/README.md`
- Create: `scripts/ui-shots/web.js`, `mobile.js`, `driver.js`, `admin.js`, `axe.js` (taban betiklerinin parametrelendirilmiş hali)
- Modify: `.gitignore` (`scripts/ui-shots/node_modules/`)

**Interfaces:**
- Produces: `node scripts/ui-shots/<yuzey>.js --out <before|after> [--only <ekran-adı>]`. Çıktı `docs/ui-review/screenshots/<out>/<yuzey>/<dil>-<genişlik>-<ekran>.png` (mobil: `<uygulama>-<dil>-<ekran>.png`). Chromium yolu `PW_CHROMIUM` ortam değişkeninden, yoksa `playwright-core`'un kendi tarayıcısından gelir. Admin betiği A4'teki `admin/e2e/.auth/admin.json` oturumunu kullanır, oturum yoksa yalnızca girişi çeker.

- [ ] **Step 1: Taşı ve parametrele.** Betikler 2026-11-02 taban betiklerinden alınır. Betik içinde sabit adres yerine `WEB_URL`, `ADMIN_URL`, `MOBILE_URL`, `DRIVER_URL` ortam değişkenleri kullanılır; varsayılanlar 3000, 3001, 8081 ve 8082 portlarıdır.
- [ ] **Step 2: Doğrula.** Run: `cd scripts/ui-shots && npm ci && node web.js --out after --only home` → Expected: 4 dosya (tr/de × 1440/390) ve exit 0.
- [ ] **Step 3: Commit.** `git commit -m "chore(ui-shots): önce/sonra ekran görüntüsü betikleri"`

### Task A7: Hat A doğrulaması ve inceleme

- [ ] **Step 1: Tam doğrulama** (superpowers:verification-before-completion). Her komutun çıktısı rapora eklenir:
  - `cd backend && .venv\Scripts\python -m pytest -q` → `78 passed`
  - `node --test scripts/` → pass
  - `node scripts/sync-tokens.mjs --check` → exit 0
  - web ve admin: `npx tsc --noEmit`, `npm run build`, `npx playwright test smoke` → yeşil
  - mobile: `npx tsc --noEmit`, `npx jest` → yeşil
  - `lint`: yalnızca tabanla aynı sayı (yeni ihlal yok)
- [ ] **Step 2: Dokümanlar.** `degisiklik_gunlugu.md`, `proje_rehberi.md` (durum matrisine "Ön yüz testleri: altyapı kuruldu"), kök `README.md` (komut satırı bölümüne `npm run lint`, `npm run test:e2e`, `npm test`), `test_senaryolari.md` "Otomatik testler" bölümü güncellenir.
- [ ] **Step 3: İnceleme.** superpowers:requesting-code-review ile dal incelenir, geri bildirim superpowers:receiving-code-review ile değerlendirilir.
- [ ] **Step 4: Kullanıcıya özet ve karar sorusu:** PR açılsın mı, B ve D bu dalın üzerinden mi dallansın?

---

# Hat B: Arayüz taraması (`ui/impeccable-pass`)

**Kurulum** (superpowers:using-git-worktrees):
- Run: `git worktree add .worktrees/ui-pass -b ui/impeccable-pass chore/ui-infra`. `.worktrees/` `.gitignore`'a eklenir.
- Worktree'de bağımlılıklar kurulur: `npm ci` (web, admin, mobile), `backend` için mevcut `.venv` kullanılır (`backend` değişmez).
- Taban testleri worktree'de yeniden çalıştırılır (A7 Step 1 listesi).
- Sunucular: Ana checkout'taki web, admin ve mobil sunucuları durdurulur. Aynı portlarda worktree'den başlatılır: web ve admin `npm run build && npm start`, mobil `npm run web -- --clear` / `npm run web:driver -- --clear`. Backend ana checkout'tan çalışmaya devam eder.

## Ortak prosedür: Ekran döngüsü

Her ekran görevi bu prosedürü izler. Görev metni yalnızca ekrana özgü olanları verir: dosyalar, bilinen bulgular, kırmızı testler.

1. **Önce ölçüm.**
   - `/impeccable critique <hedef>` ve `/impeccable audit <hedef>` (mobilde `audit.native`). Puan /N, P0–P3 listesi.
   - `npx impeccable detect <dosyalar>`
   - Görsel: `node scripts/ui-shots/<yuzey>.js --out before --only <ekran>` (taban görüntüsü varsa yeniden çekilmez).
2. **Kırmızı testler.** Görevde listelenen testler ve P0/P1 bulgularından davranışa dokunan her biri için test yazılır. Çalıştırılır, FAIL görülür.
3. **P0 ve P1 düzeltmeleri.** Gerekirse `typeset`, `layout`, `colorize`, `quieter`, `bolder` veya `distill` kullanılır. Ardından testler yeşil olmalı.
4. **`/impeccable harden`:** yükleniyor, boş, hata ve ağ hatası durumları; uzun Almanca metin; 120 karakterlik ad ve adres; `₺12.345,00` ve `1.234,00 €`; mantıksal CSS özellikleri (`inset-inline-*`, `margin-inline-*`, `padding-inline-*`, `text-align: start`).
5. **`/impeccable adapt`:** 360, 390, 768, 1024, 1440 px (mobilde 360 ve 390 + tablet). Review Focus 1'deki taşma testi eklenir.
6. **`/impeccable clarify`:** Bu ekranın `tr`, `en`, `de`, `ru` metinleri düzeltilir. Anahtarlar dört dilde eksiksiz olmalı. Yasal metne dokunulmaz.
7. **`/impeccable optimize`:** görsel boyutu ve biçimi, LCP, gereksiz `"use client"`, liste sanallaştırma.
8. **`/impeccable onboard`:** yalnızca görevde "onboard: evet" yazıyorsa.
9. **`/impeccable animate` / `delight` / `overdrive`:** yalnızca web ve müşteri mobil ekranlarında; `prefers-reduced-motion` testi zorunlu (`page.emulateMedia({ reducedMotion: "reduce" })` sonrası animasyonlu öğe nihai durumda görünür).
10. **`/impeccable polish`**, ardından `critique` ve `audit` tekrar çalıştırılır (sonra puanı).
11. **Doğrulama.**
    - `npx tsc --noEmit`, `npm run lint -- <dosyalar>` (bu ekranın dosyalarında 0 ihlal).
    - `npx playwright test <ekran>` veya `npx jest <ekran>`; web ve admin için `npm run build`.
    - Görsel: `node scripts/ui-shots/<yuzey>.js --out after --only <ekran>`.
12. **Rapor:** `docs/ui-review/<yuzey>-<ekran>.md`: önce ve sonra puanı, P0–P3 bulguları ve durumları, dosya listesi, "uygulanamadı: neden" maddeleri, önce ve sonra görüntü bağlantıları. `docs/ui-review/README.md` durum tablosuna satır eklenir.
13. **Commit:** `ui(<yuzey>/<ekran>): impeccable pass - <özet>` (rapor ve görüntüler dahil).

Kabul ölçütü (her ekran): P0 = 0, P1 = 0, axe = 0, critique en az %80 (gelir akışında %85), ekranın dosyalarında lint = 0, ilgili testler yeşil.

Paralellik kuralı: Bir yüzeyin `*0` görevi (ortak dosyalar) bitmeden o yüzeyin ekran görevleri başlamaz. Aynı ortak dosyaya (`globals.css`, `home.css`, `ui.tsx`, `messages/*.json`, `lib/i18n.ts`) dokunan ekran görevleri sırayla çalışır. `messages/*.json`'a her ekran dokunduğu için web ekranları sırayla yürütülür.

## Yüzey 1: Web gelir akışı

### Task B-W0: Web ortak dosyalar

**Files:** `web/app/globals.css`, `web/app/home.css`, `web/components/SiteHeader.tsx`, `web/components/Logo.tsx`, `web/components/Motion.tsx`. Create: `web/components/States.tsx`, `web/app/[locale]/[...rest]/page.tsx`. Test: `web/e2e/shared.spec.ts`.

**Interfaces:**
- Produces:
  - `LoadingState(props: { label: string }): JSX.Element`: `role="status"`, `aria-live="polite"`, iskelet satırları.
  - `EmptyState(props: { title: string; text?: string; action?: React.ReactNode }): JSX.Element`.
  - `ErrorState(props: { text: string; onRetry?: () => void }): JSX.Element`: `role="alert"`.
- Bilinen bulgular (taban): logo bağlantısında `label-content-name-mismatch`, eşleşmeyen adreste İngilizce ve `lang`'sız 404 (`html-has-lang`), placeholder kontrastı 2,57:1, `:focus-visible` yok, fiziksel `left`/`padding-left`.

- [ ] **Kırmızı testler** (`shared.spec.ts`):
  - `"header has no axe violations"`: `/tr/legal/privacy` üzerinde `expectNoAxeViolations(page, { include: "header" })`.
  - `"unknown path renders localized 404"`: `/tr/yok` için `html[lang=tr]`, `h1` "404" ve yanıt kodu 404.
  - `"keyboard focus is visible on primary button"`: Tab ile odaklanan düğmede `outline-style` `none` olmamalı.
  - `"placeholder meets contrast"`: `getComputedStyle(input, '::placeholder').color` değeri `--faint` olmalı.
- [ ] Ortak prosedürün 3, 4 ve 11. adımları (bu görev bir ekran değildir; critique yapılmaz). `[...rest]/page.tsx` yalnızca `notFound()` çağırır.
- [ ] Commit: `ui(web/shared): tokens, odak, mantıksal özellikler, durum bileşenleri, yerel 404`

### Task B-W1: Ana sayfa (`/`)
**Files:** `web/app/[locale]/page.tsx`, `web/app/home.css`, `web/components/{TripForm,AddressField,RegionSelect,FleetCard,Motion,SiteHeader}.tsx`, `web/messages/*.json` (`home`, `trip`, `nav`, `footer`). Test: `web/e2e/home.spec.ts`.
- Bilinen: `h1 > span` `aria-prohibited-attr`. "Uçuş takibi" iddiası doğrulanmamış; yalnızca raporlanır ve kullanıcıya sorulur.
- Kırmızı testler: `"home has no axe violations"` (tr, de; iki proje). `"address suggestions are keyboard operable"`: "antalya hav" yazılır, ArrowDown ve Enter ile seçilir, "Fiyat … bölgesine göre" ipucu görünür. `"reduced motion shows all sections"`.
- Cesurlaştırma (`bolder`, `animate`, `delight`, `overdrive`) bu ekranda serbesttir ve DESIGN.md "Kıyı Yolu" çerçevesinde kalır.
- onboard: hayır.

### Task B-W2: Rezervasyon sihirbazı (`/book`) — araç, bilgiler, onay
**Files:** `web/app/[locale]/book/page.tsx`, `web/components/{BookingWizard,CountrySelect}.tsx`, `web/app/globals.css` (yalnızca `.wizard*`, `.vehicle-card*`, `.option-card`, `.check`), `web/messages/*.json` (`book`). Test: `web/e2e/book.spec.ts`.
- Kırmızı testler:
  - `"book has no axe violations at each step"`: araç, bilgiler ve onay adımları; `/tr/book?from=ayt&to=kemer&at=<+5 gün 10:00>`.
  - `"consent boxes start unchecked and pay is disabled until both required are checked"`: üç kutu `not.toBeChecked()`, düğme `toBeDisabled()`, iki zorunlu kutu işaretlenince etkin olur; pazarlama kutusu zorunlu değildir.
  - `"invalid flight number shows field-level error"`: `TK12` → hata `aria-describedby` ile alana bağlıdır.
  - `"TRY price fits on one line"` (Review Focus 3): `country=TR` ile `.vehicle-price .price` öğesinin `getClientRects().length === 1` olmalı.
  - `"wizard shows step progress to screen readers"`: `aria-current="step"`.
- Ek: Taban görüntüsünde adım göstergesi 3 adım gösteriyor ("verify" adımı göstergede yok). Bu tutarsızlık `clarify` adımında giderilir.
- onboard: evet (ilk rezervasyon).

### Task B-W3: SMS doğrulama (OTP) — `OtpLogin`
**Files:** `web/components/{OtpLogin,RequireLogin}.tsx`, `web/messages/*.json` (`otp`, `account.loginTitle`). Test: `web/e2e/otp.spec.ts`.
- Kırmızı testler:
  - `"otp step has no axe violations"`.
  - `"wrong code shows error and keeps phone"`: `000000` → `role="alert"` görünür, telefon değişmez.
  - `"resend is rate-limited visually"`: tekrar gönder sonrası bekleme göstergesi.
  - `"phone input announces dial code"`: etiket ülke kodunu içerir.
- Not: Geliştirme kodu kutusu (`.dev-hint`) yalnızca geliştirme ortamında görünür; tasarımı `amber-soft` ile sınırlandırılır.

### Task B-W4: Ödeme (`/bookings/[code]/pay`)
**Files:** `web/app/[locale]/bookings/[code]/pay/page.tsx`, `web/components/PaymentPanel.tsx`, `web/messages/*.json` (`pay`). Test: `web/e2e/pay.spec.ts`.
- Kırmızı testler:
  - `"pay shows loading state before booking loads"`: `LoadingState` görünür; bugün `null` dönüyor.
  - `"failed payment shows alert and retry"`: sahte sayfada "Reddet" → `role="alert"` + "Tekrar dene" odağa alınabilir.
  - `"network error shows ErrorState with retry"` (Review Focus 2).
  - `"pay page has no axe violations"` (iframe hariç: `exclude: [".iframe-wrap"]`).
- Kural: "Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir" metni backend davranışıyla doğrulanır (`grep -rn "30" backend/app/services/payments.py`). Uyuşmazlık varsa metin değil rapor değişir ve kullanıcıya sorulur.

### Task B-W5: Ödeme sonucu (`/booking/payment-result`)
**Files:** `web/app/[locale]/booking/payment-result/page.tsx`, `web/components/PaymentResult.tsx`. Test: `web/e2e/payment-result.spec.ts`.
- Bulgu: Ekran `null` çiziyor; yönlendirme beklerken boş sayfa kalıyor.
- Kırmızı testler:
  - `"payment-result shows a status message while redirecting"`: `LoadingState` "Ödeme sonucu alınıyor…".
  - `"without pending booking it redirects to bookings"`.
- critique: Bu ekran bir geçiş ekranıdır. Uygulanamayan Nielsen ilkeleri `n/a` işaretlenir ve puan yeniden normalleştirilir.

### Task B-W6: Rezervasyon detayı ve iptal (`/bookings/[code]`)
**Files:** `web/app/[locale]/bookings/[code]/page.tsx`, `web/components/BookingDetail.tsx`, `web/messages/*.json` (`bookings`). Test: `web/e2e/booking-detail.spec.ts`.
- Kırmızı testler:
  - `"detail shows LoadingState then content"`.
  - `"cancel preview states K-14 refund for >48h"`: `%100` ve tutar görünür; onay düğmesi `btn danger`, "Vazgeç" eşit görünürlükte.
  - `"cancel confirm is reachable by keyboard and announces result"`: `role="status"` "Rezervasyon iptal edildi".
  - `"not-found code shows localized error"`: `/tr/bookings/ZZZZZZ`.
  - `"detail has no axe violations"` (ödenmiş + iptal önizlemesi açık).
- Canlı takip kutusu (5 sn yoklama): bağlantı kesildiğinde "son güncelleme" zamanı görünür kalır, eski konum canlıymış gibi sunulmaz.

### Task B-W7: Yüzey 1 kapanışı
- [ ] Gelir akışı uçtan uca (Senaryo 1, 5, 6): `npx playwright test book otp pay payment-result booking-detail` → yeşil.
- [ ] `docs/ui-review/README.md` tablosu, `degisiklik_gunlugu.md`, `test_senaryolari.md` (değişen akış adımları).
- [ ] superpowers:requesting-code-review. Kritik bulgu varken Yüzey 2'ye geçilmez.
- [ ] Kullanıcıya Türkçe kısa özet: ne yapıldı, nasıl doğrulandı, açık kalanlar, kararlar ("uçuş takibi" metni dahil).

## Yüzey 2: Mobil müşteri

### Task B-M0: Mobil ortak dosyalar
**Files:** `mobile/components/ui.tsx`, `mobile/components/{MapSheet,TabsLayout,AddressField,DateTimeField,DateTimeField.web}.tsx`, `mobile/lib/{i18n,format}.ts`. Test: `mobile/__tests__/ui.test.tsx`, `mobile/__tests__/format.test.ts`.

**Interfaces:**
- Consumes: `palette` (`mobile/lib/tokens.ts`, A2).
- Produces:
  - `colors` nesnesinin anahtarları aynı kalır, değerleri `palette`'ten gelir (`faint → palette.slateFaint`, `accent → palette.champagneBrass`, `accentText → palette.champagneBrassInk` yeni).
  - `onDark = { primary: "#fff", secondary: "rgba(255,255,255,0.72)", tertiary: "rgba(255,255,255,0.6)", hairline: "rgba(255,255,255,0.28)" }`.
  - `type = { caption: 13, hint: 12.5, body: 15, title: 18, headline: 26, display: 34 }`.
  - `useMotionOk(): boolean` (Reanimated `useReducedMotion` tersi).
  - `Button` `small` varyantı `minHeight: 48`.
- Bilinen: Eyebrow altın metni beyazda 2,85:1. Pasif sekme etiketi `#A1A1A6` (2,57:1). DE arayüzde tarih "03 Kas 2026" (Türkçe ay). Girişteki "Şifre yok · Kodla güvenli giriş" metni gömülü Türkçe. Döngüsel animasyonlarda (radar, araç) "hareketi azalt" desteği yok.

- [ ] **Kırmızı testler:**
  - `"Eyebrow uses AA-safe brass on light"`: `Eyebrow` stil rengi `palette.champagneBrassInk`.
  - `"formatDate uses app locale"`: `de` için `"03.11.2026"` veya `"3. Nov."` içerir, `"Kas"` içermez.
  - `"small Button is at least 48 tall"`.
  - `"tab labels use slateFaint or darker"`.
- [ ] Prosedür adımları 3, 4, 11. Ekranlardaki 69 `"#fff"` ve token dışı renkler (`#A3A3A3`, `#8A6A37`, `#2D5A43`, `#7FD3A4`, `#5C4A1C`) `palette`/`onDark`'a bağlanır. Run: `grep -rnE "\"#[0-9A-Fa-f]{3,8}\"" mobile/app mobile/components | grep -v tokens.ts` → Expected: yalnızca `MapCanvas` tema renkleri (hat D'nin alanı).
- [ ] Görsel: `node scripts/ui-shots/mobile.js --out after` ile tüm müşteri görüntüleri; renk farkları beklenir, düzen farkı beklenmez.
- [ ] Commit: `ui(mobile/shared): ortak tokenlar, tip ölçeği, onDark, hareketi azalt, 48dp`

### Task B-M1: Giriş (`login.tsx`, müşteri çeşidi)
**Files:** `mobile/app/login.tsx`, `mobile/lib/i18n.ts` (`login.*`). Test: `mobile/__tests__/login.test.tsx`.
- Kırmızı testler:
  - `"login strings are localized"`: `de` sözlüğünde "Şifre yok" geçmemeli; yeni anahtar `login.noPassword`.
  - `"otp boxes expose one labelled input"`.
  - `"dev code button has role button and label"`.
- Görsel `onboard: evet` (ilk açılış).

### Task B-M2: Rezervasyon (`(customer)/book.tsx`): ana sayfa, rota, adres arama, araç, bilgiler
**Files:** `mobile/app/(customer)/book.tsx`, `mobile/components/{AddressField,DateTimeField}.tsx`, `mobile/lib/i18n.ts` (`book.*`, `home.*`, `addr.*`). Test: `mobile/__tests__/book.test.tsx`.
- Kırmızı testler:
  - `"consents start unchecked and create is disabled until required"`.
  - `"vehicle list shows skeleton then price from API"`: API taklitli; fiyat metni API'nin `price` alanıyla birebir eşleşir, istemci hesabı yapılmaz.
  - `"guarantee toggle hidden when guarantee_available is false"`.
  - `"address modal closes on back and returns focus"`.
- onboard: evet. animate/delight: evet.

### Task B-M3: Rezervasyon detayı ve canlı takip (`booking/[code].tsx`)
**Files:** `mobile/app/booking/[code].tsx`, `mobile/lib/i18n.ts` (`bookings.*`, `status.*`, `leg.*`). Test: `mobile/__tests__/booking-detail.test.tsx`.
- Kırmızı testler:
  - `"payment waiting shows warn alert"`.
  - `"cancel preview shows K-14 tier text"`.
  - `"network error shows retry"` (Review Focus 2).
  - `"stale live location is labelled with last update time"`.
- Harita alanı hat D'ye aittir; bu görev yalnızca `MapCanvas` çağrısının prop'larını değiştirmez.

### Task B-M4: Rezervasyonlarım (`(customer)/bookings.tsx`)
**Files:** `mobile/app/(customer)/bookings.tsx`. Test: `mobile/__tests__/bookings.test.tsx`.
- Kırmızı testler: `"empty state shows title and CTA"`, `"segmented control has tab roles and selected state"`, `"long list renders with FlatList"`.
- onboard: evet (boş durum).

### Task B-M5: Profil (`(customer)/profile.tsx`)
**Files:** `mobile/app/(customer)/profile.tsx`. Test: `mobile/__tests__/profile.test.tsx`.
- Kırmızı testler:
  - `"marketing switch reflects consent and is not preselected for new user"`.
  - `"data request options are radio group"`.
  - `"legal links open web legal pages in LOCALE"`.

### Task B-M6: Yüzey 2 kapanışı
- [ ] Android emülatöründe (`getaway_pixel7`) ana akış: giriş → rezervasyon → ödeme → detay (Senaryo 4'ün müşteri adımları). Ekran görüntüsü `docs/ui-review/screenshots/after/mobile/android-*.png`.
- [ ] `npx jest`, `npx tsc --noEmit`, `npm run lint` (değişen dosyalarda 0).
- [ ] İnceleme ve kullanıcıya özet.

## Yüzey 3: Mobil sürücü

### Task B-D0: Sürücü metinleri sözlüğe
**Files:** `mobile/lib/i18n.ts` (yeni `driver.*` anahtarları yalnızca `tr` sözlüğünde; sürücü çeşidi `LOCALE` her zaman `tr`), `mobile/lib/driverLabels.ts`, `mobile/app/(driver)/*.tsx`, `mobile/app/trip/[legId].tsx`, `mobile/app/driver-register.tsx`, `mobile/app/login.tsx` (sürücü dalı). Test: `mobile/__tests__/driver-strings.test.ts`.
- Kırmızı test: `"driver screens have no hardcoded Turkish literals"`. Test, sürücü dosyalarında JSX metin düğümü olarak yazılmış Türkçe harfli dizgeleri regex ile tarar (`/>[^<{]*[çğıöşüÇĞİÖŞÜ][^<{]*</`) ve 0 bekler.
- Commit: `ui(driver/shared): sürücü metinleri sözlüğe`

### Task B-D1: Sürücü girişi ve kaydı (`login.tsx` sürücü dalı, `driver-register.tsx`)
- Kırmızı testler: `"register submit disabled until name, TÜRSAB no and IBAN valid"`, `"IBAN field announces format hint"`, `"all targets ≥ 48dp"`.
- onboard: evet (sürücü kaydı ve belge tamamlamaya yönlendirme).

### Task B-D2: Sürücü ana ekranı (`(driver)/home.tsx`): GO, çevrimiçi, teklif kartı, yaklaşan işler
- Bilinen: Teklif kartındaki tutar (`₺3.142,50`) sürücü kazancıdır ama etiketi yok. Kart pasif metinleri `rgba(255,255,255,0.65)`.
- Kırmızı testler:
  - `"offer card labels amount as driver earnings"` (`driver.offer.earning` "Kazancınız").
  - `"offer hides passenger name and address before accept"`.
  - `"accept and reject are ≥56 tall and equally reachable"`.
  - `"countdown announces remaining seconds politely"` (`accessibilityLiveRegion="polite"`, en fazla 10 sn'de bir).
  - `"radar loop stops when reduce motion is on"`.
- Animasyon artışı yok (Global Constraints).

### Task B-D3: Yolculuk (`trip/[legId].tsx`): adımlar, tabela, navigasyon, konum
- Kırmızı testler:
  - `"next step button shows single primary action"`.
  - `"sign modal shows passenger name at max size and closes on tap"`.
  - `"location denied shows explanation and settings action"`.
  - `"dev location button hidden in production"` (`__DEV__` false).
- Harita alanı hat D'ye aittir.

### Task B-D4: Belgeler (`(driver)/documents.tsx`)
- Kırmızı testler: `"expired and pending documents are distinguishable without color"` (ikon + metin), `"upload error shows retry"`, `"completion ring has accessible value"`.
- onboard: evet (belge tamamlama).

### Task B-D5: Kazanç (`(driver)/earnings.tsx`)
- Kırmızı testler: `"weekly chart has text summary"`, `"ledger amounts are TRY formatted and tabular"`, `"empty earnings state"`.

### Task B-D6: Yüzey 3 kapanışı
- [ ] Emülatör `getaway_driver`: Senaryo 3 ve 4 sürücü adımları (teklif → kabul → tabela → yolda → vardı → başladı → tamamlandı → kazanç). Ekran görüntüleri alınır.
- [ ] İnceleme ve kullanıcıya özet.

## Yüzey 4: Admin operasyon

**Ön koşul:** `ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD`, `ADMIN_E2E_TOTP_SECRET` kullanıcı tarafından ajanın kabuğunda tanımlanmış olmalı (kullanıcı kendi terminalinde `setx` ile tanımlar; değerler sohbete yazılmaz). Değişkenler yoksa durulur ve kullanıcıdan istenir.

### Task B-A0: Admin ortak dosyalar
**Files:** `admin/app/globals.css`, `admin/components/ui.tsx`, `admin/app/(panel)/layout.tsx`. Test: `admin/e2e/shared.spec.ts`.
- **Interfaces (Produces):**
  - `Table` yeni özellikler: `stickyHeader` (varsayılan `true`), sayısal sütun için `Column.align?: "end"` (tabular rakam).
  - `useSlashFocus(ref: React.RefObject<HTMLInputElement>)`: `/` tuşu, odak bir giriş alanında değilken filtre alanına odaklar.
  - `:focus-visible` halkası.
- **Kırmızı testler:**
  - `"slash focuses filter"` (Review Focus 5).
  - `"table header stays visible on scroll"`.
  - `"sidebar active link has aria-current=page"`.
  - `"panel shell has no axe violations"`.

### Task B-A1: Giriş ve 2FA (`/login`)
- Kırmızı testler: `"wrong password shows alert without revealing which field"`, `"2FA setup shows QR with text secret alternative"`, `"code input is numeric one-time-code"`.

### Task B-A2: Genel panel (`/`)
- Kırmızı testler: `"dashboard counters have labels and tabular numbers"`, `"dashboard has no axe violations"`.

### Task B-A3: Eşleştirme (`/dispatch`)
- Kırmızı testler: `"assign flow works by keyboard"` (Review Focus 5), `"empty queue shows EmptyState"`, `"assign error shows ErrorBox and keeps selection"`.

### Task B-A4: Rezervasyonlar ve detay (`/bookings`, `/bookings/[id]`)
- Kırmızı testler: `"phone and email are masked"`, `"cancel with empty rate uses policy (K-14) and shows preview"`, `"amount columns right-aligned"`.

### Task B-A5: Sürücüler ve detay (`/drivers`, `/drivers/[id]`)
- Kırmızı testler: `"IBAN masked"`, `"document view is audit-logged notice visible"`, `"approve requires validity date"`.

### Task B-A6: Belge takibi (`/documents`)
- Kırmızı testler: `"expiring and expired are distinguishable without color"`, `"empty state"`.

### Task B-A7: Yüzey 4 kapanışı
- [ ] Senaryo 3, 7 ve 10 admin adımları (Playwright) yeşil. İnceleme ve kullanıcıya özet.

## Yüzey 5: Admin geri kalanı ve web'in sabit ve yasal sayfaları

Her biri ortak prosedürle ayrı bir görevdir. Testlerin ortak çekirdeği: `"<ekran> has no axe violations"`, `"<ekran> empty state"`, `"<ekran> error state"`. Ekrana özgü testler aşağıdadır.

| Görev | Ekran | Ekrana özgü kırmızı test |
|---|---|---|
| B-A8 | `/vehicles` | `"vehicle types list exactly minivan, vip_van, minibus, vip_minibus"` |
| B-A9 | `/regions` | `"airport rows show IATA code"` |
| B-A10 | `/pricing` | `"new rule form shows round-trip discount as percent (K-30)"` |
| B-A11 | `/commission` | `"rate shown as percent, input validates 0–100"` |
| B-A12 | `/exchange-rates` | `"source TCMB labelled, manual entry marked emergency"` |
| B-A13 | `/payments` | `"refund rows link to booking"` |
| B-A14 | `/payouts` | `"CSV download warns about IBAN content"` |
| B-A15 | `/invoices` | `"e-Arşiv pending status explained"` |
| B-A16 | `/customers` | `"sensitive fields masked; delete requires confirm"` |
| B-A17 | `/templates` | `"locale column lists all 10 locales"` |
| B-A18 | `/data-requests` | `"due date shown and overdue highlighted"` |
| B-A19 | `/users` | `"roles are checkboxes with labels"` |
| B-A20 | `/audit-logs` | `"filters keyboard operable; date input aligned"` |
| B-A21 | `/settings` | `"changing a setting asks confirmation"` |
| B-A22 | `/account` | `"password change validates and announces result"` |
| B-W8 | `/bookings` (liste ve sorgulama) | `"lookup code validates format"`, `"empty list EmptyState"` |
| B-W9 | `/account` | `"marketing consent toggle not preselected; save announces"`, `"network error shows ErrorState with retry"` |
| B-W10 | `/data-request` | `"request type radio group; sent state"` |
| B-W11 | `/legal/cancellation` | `"tiers text matches K-14 exactly"`: metin %100 / %50 / %0 ve 48 / 24 saat içerir |
| B-W12 | `/legal/privacy` | `"draft notice visible"`; içerik değişmez |
| B-W13 | `/legal/distance-sales` | `"draft notice visible"` |
| B-W14 | `/legal/cookies` | `"draft notice visible"` |
| B-W15 | `not-found` | `"404 offers home and bookings links"` |

Yasal görevlerde (B-W11 … B-W14) yalnızca tipografi, okunurluk (65–75ch) ve düzen değişir. Metin anahtarlarına dokunulmaz.

### Task B-Z5: Yüzey 5 kapanışı
- [ ] İnceleme ve kullanıcıya özet.

---

# Hat C: Diller (B dalında, yüzey sonlarında)

### Task C-W1: Web 6 dil + RTL (B-W15'ten sonra)
**Files:** Create `web/messages/{fr,es,it,zh,ja,ar}.json`. Modify `web/i18n/routing.ts` (`locales` 10 dil), `web/app/[locale]/layout.tsx` (`dir={locale === "ar" ? "rtl" : "ltr"}`, Inter `subsets` + `ar/zh/ja` için sistem yazı tipi yedeği), `web/lib/site.ts` (`defaultCountry`: fr→FR, es→ES, it→IT, zh→GB, ja→GB, ar→GB; para birimi kuralı değişmez), `web/components/LocaleSwitcher.tsx`, `web/app/[locale]/legal/[slug]/page.tsx` (yeni dillerde `legal.translationNotice`), `DESIGN.md` (Typography: ar/zh/ja yazı tipi notu). Test: `web/e2e/i18n.spec.ts`, `web/scripts/check-messages.mjs`.
- **Kırmızı testler:**
  - `"all locales have identical key sets"`: `node web/scripts/check-messages.mjs` `tr.json`'u referans alır.
  - `"ar renders rtl and route rail mirrors"` (Review Focus 4).
  - `"new-locale legal page shows translation notice; tr/en/de/ru do not"`.
  - `"each locale home has no axe violations"`.
  - `"de/fr at 360px no horizontal overflow"`.
- Çeviri kuralları: fiyat, iptal ve ödeme metinleri `fiyatlandirma.md` ve K-14 ile birebir uyumlu olur; yeni iddia eklenmez. Yasal metin taslağı çevrilir; içerik eklenmez veya çıkarılmaz. `{placeholder}` ve ICU biçimleri korunur.
- Görsel: `node scripts/ui-shots/web.js --out after --locales ar,zh,ja,fr --only home,book-1-vehicle,legal-privacy`.
- Commit: `i18n(web): fr, es, it, zh, ja, ar ve RTL`

### Task C-M1: Mobil müşteri 6 dil + RTL (B-M6'dan sonra)
**Files:** `mobile/lib/i18n.ts` (6 sözlük; `Dict` tipi eksik anahtarı derleme hatası yapar), `mobile/app/_layout.tsx` (`I18nManager.allowRTL(true)`; `LOCALE === "ar"` iken `forceRTL(true)` ve uygulama yeniden yüklemesi), `mobile/lib/countries.ts`. Test: `mobile/__tests__/i18n.test.ts`.
- **Kırmızı testler:**
  - `"every customer dictionary has all tr keys"`.
  - `"ar sets RTL"` (`I18nManager.forceRTL` çağrılır).
  - `"driver variant stays tr regardless of device locale"`.
- Emülatör: cihaz dili Arapça yapılarak giriş ve rezervasyon ekranları görüntülenir.
- Commit: `i18n(mobile): müşteri uygulamasında 6 yeni dil ve RTL`

Notlar:
- **Bildirim şablonları:** Bunlar veridir; `acik_konular.md`'ye "admin'den 6 dilde şablon girilecek, girilene kadar İngilizce" maddesi eklenir.
- **Yasal metinler:** `acik_konular.md`'ye "yeni dillerdeki yasal çeviriler hukukçu kontrolü bekliyor" maddesi eklenir.

---

# Hat D: Gerçek harita ve rota çizgisi (`feat/native-map`)

**Kurulum:** `git worktree add .worktrees/native-map -b feat/native-map chore/ui-infra`. Backend testleri için Docker ayakta olmalı. Worktree'de `backend/.venv` yoktur; testler ana checkout'un venv'iyle çalıştırılır: `..\..\backend\.venv\Scripts\python -m pytest`, çalışma dizini `.worktrees/native-map/backend`.

### Task D1: Polyline kodlayıcı
**Files:** Create `backend/app/providers/polyline.py`, `backend/tests/test_polyline.py`.
**Interfaces (Produces):** `encode(points: list[tuple[float, float]], precision: int = 5) -> str`, `decode(s: str, precision: int = 5) -> list[tuple[float, float]]` (Google Encoded Polyline Algorithm).
- [ ] **Failing test:**
  ```python
  def test_encode_matches_google_reference():
      pts = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
      assert encode(pts) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
  def test_roundtrip():
      pts = [(36.8987, 30.8005), (36.6018, 30.5594)]
      assert decode(encode(pts)) == pts
  ```
- [ ] Run: `pytest tests/test_polyline.py -v` → FAIL (ModuleNotFoundError) → kod yazılır → PASS.
- [ ] Commit: `feat(backend): Google encoded polyline kodlayıcı`

### Task D2: `Route.polyline` ve sağlayıcılar
**Files:** Modify `backend/app/providers/routing.py` (`Route` sınıfına `polyline: str | None = None`; `HaversineRouting.route` `encode([origin, destination])` döndürür; `GoogleRouting` alan maskesine `routes.polyline.encodedPolyline` ekler ve `routes[0].get("polyline", {}).get("encodedPolyline")` okur). Test: `backend/tests/test_routing.py`.
- [ ] **Failing testler:**
  - `test_haversine_route_has_two_point_polyline`: `decode(r.polyline)` iki nokta verir, uçlar girdi noktalarıdır.
  - `test_google_route_parses_polyline(monkeypatch)`: `httpx.post` taklit edilir, yanıt `{"routes":[{"distanceMeters":12000,"duration":"900s","polyline":{"encodedPolyline":"abc"}}]}` → `r.polyline == "abc"`. Gönderilen `X-Goog-FieldMask` başlığı `routes.polyline.encodedPolyline` içerir.
  - `test_google_route_without_polyline_is_none`.
- [ ] Mevcut fiyat testleri değişmeden geçer: `pytest -q` → `78 passed` + yeni testler.
- [ ] Commit: `feat(backend): rota sağlayıcıları polyline döndürür`

### Task D3: Ayak rota çizgisi servisi (Redis 24 saat)
**Files:** Create `backend/app/services/route_line.py`, `backend/tests/test_route_line.py`.
**Interfaces:**
- Consumes: `get_routing()`, `Point`; `BookingLeg.pickup_lat/lng`, `dropoff_lat/lng` (yoksa bölge `latitude/longitude`).
- Produces: `route_polyline(leg: BookingLeg) -> str | None`. Anahtar `route_line:{leg.id}`, TTL `86400`. Sağlayıcı `ServiceUnavailable` atarsa `None` döner ve günlüğe yazar; istek başarısız olmaz.
- [ ] **Failing testler:**
  - `test_route_polyline_cached(monkeypatch)`: sağlayıcı sayaçlı taklittir; iki çağrıda sağlayıcı 1 kez çağrılır, Redis TTL 86400'e eşit veya küçüktür.
  - `test_route_polyline_falls_back_to_region_centers`.
  - `test_route_polyline_provider_error_returns_none`.
- [ ] Commit: `feat(backend): ayak rota çizgisi servisi (Redis önbellek)`

### Task D4: API alanları (eklemeli)
**Files:** Modify `backend/app/api/driver.py:226-262` (`TripOut.route_polyline: str | None = None`; `_trip_out` yalnızca tekil yolculuk ucunda doldurur, liste ucunda `None` bırakır), `backend/app/api/schemas.py:182-219` (`BookingLegOut.route_polyline: str | None = None`; `build(leg, with_route: bool = False)`; müşteri detay ucu `with_route=True` çağırır, liste ucu çağırmaz). Test: `backend/tests/test_api_customer.py`, `backend/tests/test_api_driver_admin.py`.
- [ ] **Failing testler:**
  - `test_customer_booking_detail_has_route_polyline`: `GET /api/v1/me/bookings/{code}` → `legs[0].route_polyline` str.
  - `test_customer_booking_list_omits_route_polyline`: alan `None`.
  - `test_driver_trip_has_route_polyline`.
- [ ] `pytest -q` → hepsi yeşil. OpenAPI'de alan görünür (`/docs`).
- [ ] Dokümanlar: `backend/README.md` API özeti, `docs/veritabani.md` ("şema değişmedi; polyline Redis'te"), `docs/kararlar.md` K-37 durum: uygulandı.
- [ ] Commit: `feat(api): rezervasyon detayı ve sürücü yolculuğunda route_polyline`

### Task D5: Mobil polyline çözücü ve tipler
**Files:** Create `mobile/lib/polyline.ts`, `mobile/__tests__/polyline.test.ts`. Modify `mobile/lib/types.ts` (`BookingLeg.route_polyline?: string | null`, `Trip.route_polyline?: string | null`), `mobile/components/mapTypes.ts`.
**Interfaces (Produces):**
- `decodePolyline(s: string): LatLng[]`; `type LatLng = { latitude: number; longitude: number }`.
- `MapCanvasProps` = mevcut prop'lar + `route?: string | null` (encoded polyline), `driver?: LatLng | null`, `accessibilitySummary?: string`.
- [ ] **Failing test:** `decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")` → `[{latitude:38.5,longitude:-120.2},{latitude:40.7,longitude:-120.95},{latitude:43.252,longitude:-126.453}]`.
- [ ] Commit: `feat(mobile): polyline çözücü ve harita tipleri`

### Task D6: Native harita bileşeni
**Files:** Run `npx expo install react-native-maps`. Rename `mobile/components/MapCanvas.tsx` → `MapCanvas.web.tsx` (SVG, `MapCanvasProps`'u kabul eder, yeni prop'ları yok sayar). Create `mobile/components/MapCanvas.native.tsx`. Modify `mobile/app.config.ts` (`android.config.googleMaps.apiKey: process.env.GETAWAY_GOOGLE_MAPS_ANDROID_KEY`, tanımsızsa alan eklenmez), `mobile/jest.setup.ts` (`react-native-maps` taklidi). Test: `mobile/__tests__/map.test.tsx`.
- Native davranış:
  - `route` varsa polyline lake siyah 4 px çizilir; alış dairesi, varış karesi (rota rayı dili) ve `driver` işaretçisi gösterilir.
  - Kamera tüm noktaları `edgePadding` ile içine alır; alt panel için `hiddenBottom` dikkate alınır.
  - `route` yoksa Antalya merkezli bölge (36.8969, 30.7133) gösterilir.
  - `accessibilityLabel={props.accessibilitySummary}`, `accessible`.
  - "Hareketi azalt" açıksa kamera animasyonsuz geçer.
- [ ] **Failing testler:**
  - `"renders Polyline with decoded coordinates"`.
  - `"exposes accessibility summary"`.
  - `"falls back to Antalya region without route"`.
- [ ] Web önizlemesinin kırılmadığını doğrula: `npm run web -- --clear` → 8081 açılır, Playwright `mobile.js --only home` → görüntü alınır.
- [ ] Commit: `feat(mobile): react-native-maps ile gerçek harita, web'de SVG`

### Task D7: Ekranlara bağlama ve emülatör doğrulaması
**Files:** `mobile/app/booking/[code].tsx` (`route={leg.route_polyline}`, `driver={location}`, `accessibilitySummary`), `mobile/app/trip/[legId].tsx` (aynı). Test: ilgili ekran testlerine `"passes route polyline to map"` eklenir.
- Hat B ile çakışma: B-M3 ve B-D3 bu dosyaların harita dışı bölümlerine dokunur. D7, B'nin ilgili görevleri birleştikten sonra rebase edilir; çakışma yalnızca `MapCanvas` satırında beklenir.
- [ ] Emülatör (`getaway_pixel7` + `getaway_driver`): Senaryo 3 (atanmış iş, yolda, konum gönder) → müşteri ve sürücü ekranında polyline ve sürücü işaretçisi görünür. Ekran görüntüleri `docs/ui-review/screenshots/after/mobile/android-map-*.png`.
- [ ] Dokümanlar: `mobile/README.md` (harita ve anahtar ortam değişkeni), `docs/hesap_kurulumu.md` (Android Maps SDK anahtarı satırı), `docs/acik_konular.md` (SVG harita maddesi kapatılır; iOS doğrulaması Mac gerektirir).
- [ ] İnceleme ve kullanıcıya özet; PR kararı kullanıcıda.

---

# Kapanış (B dalında, tüm yüzeyler ve C bittikten sonra)

### Task Z1: İkinci tam tarama
- [ ] 46 ekranın hepsinde `critique` ve `audit` yeniden çalıştırılır. Kalan P0/P1 0 olmalı; değilse ekran ve neden raporlanır.
- [ ] `docs/ui-review/README.md` tablosu son puanlarla güncellenir.

### Task Z2: Tam doğrulama
- [ ] `pytest -q`, `node --test scripts/`, `node scripts/sync-tokens.mjs --check`
- [ ] web ve admin: `tsc`, `lint` (0 ihlal, artık zorunlu), `build`, `test:e2e`
- [ ] mobile: `tsc`, `lint` (0), `jest`
- [ ] `test_senaryolari.md` 1–13 uçtan uca: web ve admin Playwright ile, mobil emülatörde. ARQ iş kuyruğu bu adımdan önce başlatılır (`arq app.worker.WorkerSettings`).

### Task Z3: CI
- [ ] Repoda GitHub Actions yok. Kullanıcıya sorulur: `.github/workflows/ui.yml` (lint, tsc, build, `npx impeccable detect`, Playwright + axe, jest, `sync-tokens --check`) eklensin mi? Onay gelmeden eklenmez.

### Task Z4: Dalı bitirme
- [ ] superpowers:finishing-a-development-branch. Merge, PR, dalı tutma veya silme seçenekleri kullanıcıya sunulur. Ajan merge etmez.
- [ ] Dokümanlar: `degisiklik_gunlugu.md`, `proje_rehberi.md` durum matrisi, kök `README.md` durum tablosu, `ekranlar.md`, `kararlar.md`, `acik_konular.md`.

---

## Yürütme sırası ve paralellik

1. A1 → A2 → A3 → A4 → A5 → A6 → A7 (sırayla)
2. A7 onayından sonra B ve D aynı anda başlayabilir:
   - **B:** W0 → W1 … W6 → W7 → M0 → M1 … M5 → M6 → D0 … D5 → D6 → A0 … A6 → A7 → A8 … A22 ve W8 … W15 (aynı ortak dosyaya dokunmayanlar paralel) → Z5 → C-W1 → C-M1 → Z1 → Z2 → Z3 → Z4
   - **D:** D1 → D2 → D3 → D4 → D5 → D6 → (B-M3 ve B-D3 birleştikten sonra) D7
3. Her yüzey kapanışında durulur ve kullanıcıdan onay alınır.
