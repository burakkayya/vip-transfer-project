// axe (WCAG 2.2 AA) ölçümü: web, admin girişi ve (oturum varsa) admin panel rotaları.
// Kullanım: node axe.js --out <before|after> [--only <ad>[,<ad>...]] [--locales tr,de] [--pages web:/tr/book,admin:/bookings]
//   --pages verilirse varsayılan liste yerine yalnızca bu sayfalar ölçülür (web:<yol> | admin:<yol>).
// Çıktı: docs/ui-review/screenshots/<out>/_axe.json
const path = require("path");
const fs = require("fs");
const { AxeBuilder } = require("@axe-core/playwright");
const { URLS, ADMIN_STATE, AXE_TAGS, parseArgs, requireOut, makeFilter, launch, REPO, hasAdminState } = require("./lib");

const args = parseArgs();
const out = requireOut(args, "axe.js", " [--locales tr,de] [--pages web:/tr/book,admin:/bookings]");
const filter = makeFilter(args);
const LOCALES = (typeof args.locales === "string" ? args.locales : "tr,de").split(",").map((s) => s.trim()).filter(Boolean);

const WEB_PAGES = [
  ["home", (l) => `/${l}`],
  ["book", (l) => `/${l}/book?from=ayt&to=kemer`],
  ["bookings", (l) => `/${l}/bookings`],
  ["account", (l) => `/${l}/account`],
  ["data-request", (l) => `/${l}/data-request`],
  ["legal-privacy", (l) => `/${l}/legal/privacy`],
  ["not-found", (l) => `/${l}/yok`],
];
const ADMIN_PAGES = [
  ["dashboard", "/"], ["bookings", "/bookings"], ["dispatch", "/dispatch"], ["drivers", "/drivers"],
  ["documents", "/documents"], ["vehicles", "/vehicles"], ["regions", "/regions"], ["pricing", "/pricing"],
  ["commission", "/commission"], ["exchange-rates", "/exchange-rates"], ["payments", "/payments"],
  ["payouts", "/payouts"], ["invoices", "/invoices"], ["customers", "/customers"], ["templates", "/templates"],
  ["data-requests", "/data-requests"], ["users", "/users"], ["audit-logs", "/audit-logs"],
  ["settings", "/settings"], ["account", "/account"],
];

/** Ölçülecek sayfalar: {surface, name, url, auth}. */
function buildPages() {
  if (typeof args.pages === "string") {
    return args.pages.split(",").map((s) => s.trim()).filter(Boolean).map((spec) => {
      const i = spec.indexOf(":");
      const surface = spec.slice(0, i);
      const route = spec.slice(i + 1);
      if (!(surface in URLS) || !route.startsWith("/")) {
        console.error(`Geçersiz --pages girdisi: ${spec} (web:/yol veya admin:/yol)`);
        process.exit(2);
      }
      return { surface, name: spec, url: URLS[surface] + route, auth: surface === "admin" && route !== "/login" };
    });
  }
  const pages = [];
  for (const l of LOCALES) for (const [n, f] of WEB_PAGES) pages.push({ surface: "web", name: `${l}-${n}`, url: URLS.web + f(l), auth: false });
  pages.push({ surface: "admin", name: "login", url: `${URLS.admin}/login`, auth: false });
  if (hasAdminState()) for (const [n, r] of ADMIN_PAGES) pages.push({ surface: "admin", name: n, url: URLS.admin + r, auth: true });
  return pages.filter((p) => filter.want(p.name) || filter.want(p.name.replace(/^[a-z]{2}-/, "")));
}

(async () => {
  const pages = buildPages();
  const needAuth = pages.some((p) => p.auth);
  if (needAuth && !hasAdminState()) {
    console.error(`Admin sayfaları için oturum dosyası yok: ${ADMIN_STATE}`);
    process.exit(1);
  }
  const browser = await launch();
  const results = [];
  // Admin yenileme jetonu her kullanımda döner: oturumlu tek bağlam, iki genişlik arasında görünüm boyutu değişir,
  // dönen oturum sonunda dosyaya geri yazılır.
  const anon = await browser.newContext();
  const authed = needAuth ? await browser.newContext({ storageState: ADMIN_STATE }) : null;
  let expired = false;
  try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const pg of pages) {
      const ctx = pg.auth ? authed : anon;
      const p = await ctx.newPage();
      await p.setViewportSize({ width: w, height: h });
      await p.goto(pg.url);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(1500);
      const redirected = pg.auth && /^\/login/.test(new URL(p.url()).pathname);
      if (redirected) expired = true;
      const r = await new AxeBuilder({ page: p }).withTags(AXE_TAGS).analyze();
      results.push({
        surface: pg.surface,
        name: pg.name,
        url: pg.url,
        width: w,
        ...(redirected ? { warning: "oturum geçersiz, login ölçüldü" } : {}),
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" ") })),
      });
      await p.close();
    }
  }
  } finally {
    // Hata olsa da dönen yenileme jetonu saklanır; aksi halde oturum dosyası ölü kalır.
    if (authed) {
      if (expired) {
        console.error("UYARI: admin oturumu geçersiz; panel ölçümleri login sayfasını ölçtü. Yenile: cd admin && npx playwright test --project=setup");
        process.exitCode = 1;
      } else {
        await authed.storageState({ path: ADMIN_STATE }).catch(() => {});
      }
      await authed.close().catch(() => {});
    }
    await anon.close().catch(() => {});
  }
  await browser.close();
  const dir = path.join(REPO, "docs", "ui-review", "screenshots", out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_axe.json"), JSON.stringify(results, null, 2));
  for (const r of results) {
    console.log(`${r.width} ${r.surface}:${r.name} -> ${r.violations.length} kural` + (r.violations.length ? ": " + r.violations.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(", ") : ""));
  }
  const total = results.reduce((n, r) => n + r.violations.length, 0);
  console.log(`Toplam ${results.length} ölçüm, ${total} ihlal kuralı -> ${path.join(dir, "_axe.json")}`);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
