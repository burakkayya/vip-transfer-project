// Web ekran görüntüleri: diller x (1440, 390). Tam rezervasyon + OTP + sahte ödeme akışı dahil.
// Kullanım: node web.js --out <before|after> [--only home,pay] [--locales tr,de]
// Çıktı: docs/ui-review/screenshots/<out>/web/<dil>-<genişlik>-<ekran>.png
const path = require("path");
const fs = require("fs");
const { URLS, parseArgs, requireOut, makeFilter, launch, outDir } = require("./lib");

const args = parseArgs();
const out = requireOut(args, "web.js", " [--locales tr,de]");
const filter = makeFilter(args);
const LOCALES = (typeof args.locales === "string" ? args.locales : "tr,de").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = outDir(out, "web");
const BASE = URLS.web;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const ANON = [
  ["home", (l) => `/${l}`],
  ["book-empty", (l) => `/${l}/book`],
  ["bookings-anon", (l) => `/${l}/bookings`],
  ["account-anon", (l) => `/${l}/account`],
  ["data-request-anon", (l) => `/${l}/data-request`],
  ["legal-cancellation", (l) => `/${l}/legal/cancellation`],
  ["legal-privacy", (l) => `/${l}/legal/privacy`],
  ["legal-distance-sales", (l) => `/${l}/legal/distance-sales`],
  ["legal-cookies", (l) => `/${l}/legal/cookies`],
  ["not-found", (l) => `/${l}/bu-sayfa-yok`],
  ["not-found-in-locale", (l) => `/${l}/legal/olmayan`],
  ["booking-not-found", (l) => `/${l}/bookings/ZZZZZZ`],
  // Geçiş ekranı: yönlendirme hedefi (/bookings) tutulur, böylece bekleme durumu görüntülenir.
  ["payment-result", (l) => `/${l}/booking/payment-result?status=ok`],
];
const FLOW = [
  "book-1-vehicle", "book-2-details", "book-3-verify", "book-4-otp", "book-5-confirm",
  "pay", "pay-failed", "booking-detail-paid", "booking-cancel-preview",
];
const LOGGED = [
  ["bookings-list", (l) => `/${l}/bookings`],
  ["account", (l) => `/${l}/account`],
  ["data-request", (l) => `/${l}/data-request`],
];
// --only yalnızca akışın erken ekranlarını isterse akış orada durur: onay adımından sonra
// rezervasyon oluşturulmaz, sahte ödeme yapılmaz.
const LOGGED_NAMES = LOGGED.map(([n]) => n);
function nothingAfter(name) {
  return !filter.wantAny(FLOW.slice(FLOW.indexOf(name) + 1)) && !filter.wantAny(LOGGED_NAMES);
}
const log = [];
const missed = [];

function inDays(d, h) {
  const t = new Date(Date.now() + d * 864e5);
  t.setHours(h, 0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // whileInView animasyonları tetiklensin diye sayfa adım adım kaydırılır.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

async function shot(page, prefix, name) {
  if (!filter.want(name)) return;
  await settle(page);
  const file = path.join(OUT, `${prefix}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log.push({ file: path.basename(file), url: page.url(), hOverflowPx: overflow });
}

function errors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && bucket.push(`console: ${m.text().slice(0, 200)}`));
}

(async () => {
  const browser = await launch();
  const consoleErrors = {};
  const needFlow = filter.wantAny([...FLOW, ...LOGGED.map(([n]) => n)]);
  let n = 0;
  for (const loc of LOCALES) {
    for (const vp of VIEWPORTS) {
      const prefix = `${loc}-${vp.name}`;
      const errs = (consoleErrors[prefix] = []);
      const opts = { viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, locale: loc };
      const ctx = await browser.newContext(opts);
      const a = await ctx.newPage();
      errors(a, errs);

      // Oturumsuz ekranlar
      for (const [name, url] of ANON) {
        if (!filter.want(name)) continue;
        try {
          if (name === "payment-result") await a.route(/\/[a-z]{2}\/bookings(\?|$)/, () => {});
          await a.goto(BASE + url(loc));
          await shot(a, prefix, name);
          if (name === "payment-result") await a.unroute(/\/[a-z]{2}\/bookings(\?|$)/);
        } catch (e) {
          missed.push({ name: prefix + "-" + name, error: String(e.message).split("\n")[0] });
        }
      }

      if (needFlow) {
        let stage = "book-1-vehicle";
        try {
        await (async () => {
        // Rezervasyon akışı (oturumsuz başlar, OTP ile giriş)
        await a.goto(`${BASE}/${loc}/book?from=ayt&to=kemer&at=${inDays(5, 10)}`);
        await a.waitForSelector(".vehicle-card .price", { timeout: 30000 });
        await shot(a, prefix, "book-1-vehicle");
        if (nothingAfter("book-1-vehicle")) return;
        stage = "book-2-details";
        await a.locator(".vehicle-card:not([disabled])").first().click();
        await a.fill("#name", "Test Yolcu");
        await shot(a, prefix, "book-2-details");
        if (nothingAfter("book-2-details")) return;
        await a.locator("form.card button[type=submit]").click();
        await a.waitForSelector("#otp-phone");
        await shot(a, prefix, "book-3-verify");
        if (nothingAfter("book-3-verify")) return;
        n += 1;
        stage = "book-4-otp";
        // Her çalıştırmada benzersiz numara (Date.now son 5 hane + sıra no): önceki çalıştırmaların rezervasyonlarıyla karışmaz.
        await a.fill("#otp-phone", `555${String(Date.now()).slice(-5)}${String(n).padStart(2, "0")}`);
        await a.locator("form:has(#otp-phone) button[type=submit]").click();
        await a.waitForSelector(".dev-hint");
        await shot(a, prefix, "book-4-otp");
        if (nothingAfter("book-4-otp")) return;
        await a.click(".dev-hint");
        await a.locator("form:has(#otp-code) button[type=submit]").click();
        stage = "book-5-confirm";
        await a.waitForSelector(".confirm-total", { timeout: 30000 });
        await shot(a, prefix, "book-5-confirm");
        if (nothingAfter("book-5-confirm")) return;
        const checks = a.locator(".check input[type=checkbox]");
        await checks.nth(0).check();
        await checks.nth(1).check();
        await a.locator("button.btn.primary.big").click();

        // Ödeme: sahte sağlayıcı, önce red sonra onay
        stage = "pay";
        await a.waitForURL(/\/bookings\/[A-Z0-9]+\/pay/, { timeout: 30000 });
        const code = a.url().match(/bookings\/([A-Z0-9]+)\/pay/)[1];
        const frame = a.frameLocator(".iframe-wrap iframe");
        await frame.locator("button.no").waitFor({ timeout: 30000 });
        await shot(a, prefix, "pay");
        await frame.locator("button.no").click();
        await a.waitForURL(/result=fail/, { timeout: 30000 });
        await a.waitForSelector(".pay [role=alert]");
        await shot(a, prefix, "pay-failed");
        await a.locator(".pay-retry").click();
        await frame.locator("button.ok").waitFor({ timeout: 30000 });
        await frame.locator("button.ok").click();
        await a.waitForURL(/paid=1/, { timeout: 40000 });
        await a.waitForTimeout(800);
        await shot(a, prefix, "booking-detail-paid");
        stage = "booking-cancel-preview";
        await a.locator(".booking-cancel-open").click();
        await a.waitForSelector("button.btn.danger");
        await shot(a, prefix, "booking-cancel-preview");

        // Oturumlu ekranlar
        for (const [name, url] of LOGGED) {
          if (!filter.want(name)) continue;
          stage = name;
          await a.goto(BASE + url(loc));
          await a.waitForTimeout(1200);
          await shot(a, prefix, name);
        }
        log.push({ prefix, bookingCode: code });
        })();
        } catch (e) {
          // Akış adımları birbirine bağlıdır; hata o dil/genişlik için akışı keser, sonraki dile geçilir.
          missed.push({ name: prefix + "-" + stage, error: String(e.message).split("\n")[0] });
        }
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, filter.all ? "_log.json" : "_log-only.json"), JSON.stringify({ log, consoleErrors, missed }, null, 2));
  const shots = log.filter((l) => l.file);
  console.log(JSON.stringify({ shots: shots.length, overflow: shots.filter((l) => l.hOverflowPx > 0), consoleErrors, missed }, null, 2));
  if (missed.length) process.exitCode = 1;
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
