// Admin ekran görüntüleri.
// Giriş ekranı her zaman çekilir. admin/e2e/.auth/admin.json (admin Playwright "setup" projesi) varsa
// tüm panel rotaları da çekilir; yoksa yalnızca giriş.
// Kullanım: node admin.js --out <before|after> [--only login,bookings,bookings-detail]
// Çıktı: docs/ui-review/screenshots/<out>/admin/<genişlik>-<ekran>.png
// Kimlik bilgisi bu betikte yoktur; yalnızca oturum dosyası kullanılır.
const path = require("path");
const { URLS, ADMIN_STATE, parseArgs, requireOut, makeFilter, launch, outDir, hasAdminState } = require("./lib");

const args = parseArgs();
const out = requireOut(args, "admin.js");
const filter = makeFilter(args);
const OUT = outDir(out, "admin");
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];
const ROUTES = [
  ["dashboard", "/"],
  ["bookings", "/bookings"],
  ["dispatch", "/dispatch"],
  ["drivers", "/drivers"],
  ["documents", "/documents"],
  ["vehicles", "/vehicles"],
  ["regions", "/regions"],
  ["pricing", "/pricing"],
  ["commission", "/commission"],
  ["exchange-rates", "/exchange-rates"],
  ["payments", "/payments"],
  ["payouts", "/payouts"],
  ["invoices", "/invoices"],
  ["customers", "/customers"],
  ["bookings-new", "/bookings/new"],
  ["trip-reviews", "/trip-reviews"],
  ["templates", "/templates"],
  ["data-requests", "/data-requests"],
  ["users", "/users"],
  ["audit-logs", "/audit-logs"],
  ["settings", "/settings"],
  ["account", "/account"],
];
// Liste ekranından ilk satırın ayrıntı sayfası. Dördüncü öğe listeyi hazırlar (ör. süzgeç).
const DETAILS = [
  ["bookings-detail", "/bookings", 'a[href^="/bookings/"]:not([href="/bookings/new"])'],
  // Sürücü listesi varsayılan olarak yalnızca başvuruları gösterir; "Tümü" seçilir.
  ["drivers-detail", "/drivers", 'a[href^="/drivers/"]', async (p) => {
    await p.locator("select").first().selectOption("");
    await p.waitForLoadState("networkidle").catch(() => {});
    await p.waitForTimeout(800);
  }],
];

const done = [];
const notes = [];

async function shot(page, vp, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  const file = `${vp.name}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  done.push(file);
}

(async () => {
  const browser = await launch();

  // Giriş ekranı (oturumsuz)
  if (filter.want("login")) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "tr-TR" });
      const p = await ctx.newPage();
      await p.goto(`${URLS.admin}/login`);
      await p.waitForTimeout(1200);
      await shot(p, vp, "login");
      await ctx.close();
    }
  }

  // Panel rotaları (oturumlu). Admin yenileme jetonu her kullanımda döner (rotation); bu yüzden tek bağlam
  // kullanılır, iki genişlik arasında yalnızca görünüm boyutu değişir ve dönen oturum dosyaya geri yazılır.
  const panelWanted = filter.wantAny([...ROUTES.map(([n]) => n), ...DETAILS.map(([n]) => n)]);
  if (!hasAdminState()) {
    notes.push(`Oturum dosyası yok (${ADMIN_STATE}); yalnızca giriş çekildi. Önce: cd admin && npx playwright test --project=setup`);
  } else if (panelWanted) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", storageState: ADMIN_STATE });
    const p = await ctx.newPage();
    let expired = false;
    // Sayfaya gidip yerleşmesini bekler; login'e düştüyse oturum geçersizdir.
    const open = async (url) => {
      await p.goto(url);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(1000);
      if (/^\/login/.test(new URL(p.url()).pathname)) {
        expired = true;
        return false;
      }
      return true;
    };
    try {
    for (const vp of VIEWPORTS) {
      if (expired) break;
      await p.setViewportSize({ width: vp.width, height: vp.height });
      for (const [name, route] of ROUTES) {
        if (expired || !filter.want(name)) continue;
        if (await open(URLS.admin + route)) await shot(p, vp, name);
      }
      for (const [name, listRoute, selector, prepare] of DETAILS) {
        if (expired || !filter.want(name)) continue;
        if (!(await open(URLS.admin + listRoute))) continue;
        if (prepare) await prepare(p).catch(() => {});
        const href = await p.locator(selector).first().getAttribute("href", { timeout: 5000 }).catch(() => null);
        if (!href) {
          notes.push(`${vp.name}-${name}: ${listRoute} listesinde satır yok, atlandı`);
          continue;
        }
        if (await open(URLS.admin + href)) await shot(p, vp, name);
      }
    }
    } finally {
      // Hata olsa da dönen yenileme jetonu saklanır; aksi halde oturum dosyası ölü kalır.
      if (expired) {
        notes.push("Oturum geçersiz (login'e yönlendi); panel ekranları eksik. Oturumu yenile: cd admin && npx playwright test --project=setup");
        process.exitCode = 1;
      } else {
        await ctx.storageState({ path: ADMIN_STATE }).catch(() => {});
      }
      await ctx.close().catch(() => {});
    }
  }
  await browser.close();
  console.log(JSON.stringify({ shots: done.length, files: done, notes }, null, 2));
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
