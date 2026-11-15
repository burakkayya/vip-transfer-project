// Reklam görüntüleri (web, İngilizce, yüksek çözünürlük). Masaüstü 1920x1080 @2x (3840x2160) ve
// telefon 390x844 @3x (1170x2532). Geliştirme göstergesi gizlenir, sayfa yerleşince çekilir.
// Kullanım: node promo-web.js --out <klasör> [--phone 7700900123]  (telefonla giriş: dolu rezervasyon ekranları)
// Yerel geliştirme yığınına karşı çalışır (WEB_URL, varsayılan http://localhost:3000); üretime karşı çalıştırılmaz.
const path = require("path");
const fs = require("fs");
const { URLS, parseArgs, launch } = require("./lib");

const args = parseArgs();
if (typeof args.out !== "string") {
  console.error("Kullanım: node promo-web.js --out <klasör> [--phone 7700900123]");
  process.exit(2);
}
const OUT = path.resolve(args.out);
fs.mkdirSync(OUT, { recursive: true });
const BASE = URLS.web;
const L = "en";
const DEVICES = [
  { name: "desktop", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, isMobile: false },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];
const HIDE_DEV = `nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }
  * { caret-color: transparent !important; }`;
const shots = [];
const errors = [];

function inDays(d, h) {
  const t = new Date(Date.now() + d * 864e5);
  t.setHours(h, 0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: HIDE_DEV }).catch(() => {});
  // whileInView animasyonları bitsin: sayfa adım adım kaydırılır.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 400) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}

async function shot(page, dev, name, opts = {}) {
  const file = path.join(OUT, `web-${dev}-${name}.png`);
  if (opts.selector) {
    await page.locator(opts.selector).first().scrollIntoViewIfNeeded();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72);
    }, opts.selector);
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: file, fullPage: Boolean(opts.full) });
  shots.push(path.basename(file));
}

(async () => {
  // Yerel tarih kutusu tarayıcı arayüz dilini kullanır: İngilizce Chromium.
  const browser = await launch({ args: ["--lang=en-GB"] });
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ ...d, locale: "en-GB", timezoneId: "Europe/Istanbul", colorScheme: "light" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${d.name}: ${e.message}`));
    try {
      await page.goto(`${BASE}/${L}`);
      await settle(page);
      await shot(page, d.name, "01-home-hero");
      await shot(page, d.name, "02-services", { selector: "#services" });
      await shot(page, d.name, "03-fleet", { selector: "#fleet" });
      await shot(page, d.name, "04-faq", { selector: "#faq" });
      if (d.name === "desktop") await shot(page, d.name, "00-home-full", { full: true });

      await page.goto(`${BASE}/${L}/book?from=ayt&to=kemer&at=${inDays(6, 10)}`);
      await page.waitForSelector(".vehicle-card .price", { timeout: 40000 });
      await settle(page);
      await page.waitForTimeout(2500); // harita karoları
      await shot(page, d.name, "05-book-vehicles");
      await page.locator(".vehicle-card:not([disabled])").nth(1).click();
      await page.fill("#name", "Emma Wilson");
      await page.waitForTimeout(800);
      await shot(page, d.name, "06-book-details");

      if (typeof args.phone === "string") {
        await page.locator("form.card button[type=submit]").click();
        await page.waitForSelector("#otp-phone");
        await page.fill("#otp-phone", args.phone);
        await page.locator("form:has(#otp-phone) button[type=submit]").click();
        await page.waitForSelector(".dev-hint", { timeout: 20000 });
        await page.click(".dev-hint");
        await page.locator("form:has(#otp-code) button[type=submit]").click();
        await page.waitForSelector(".confirm-total", { timeout: 30000 });
        await page.addStyleTag({ content: HIDE_DEV });
        await page.waitForTimeout(800);
        await shot(page, d.name, "07-book-confirm");
        await page.goto(`${BASE}/${L}/bookings`);
        await page.waitForTimeout(2500);
        await page.addStyleTag({ content: HIDE_DEV });
        await shot(page, d.name, "08-my-bookings");
        const link = page.locator("a[href*='/bookings/GA']").first();
        if (await link.count()) {
          await link.click();
          await page.waitForSelector(".booking-cancel-open, .driver-card, h1", { timeout: 30000 }).catch(() => {});
          await page.waitForFunction(() => !document.body.innerText.includes("Checking your session"), null, { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(3000);
          await page.addStyleTag({ content: HIDE_DEV });
          await shot(page, d.name, "09-booking-detail");
          await shot(page, d.name, "09-booking-detail-full", { full: true });
        }
      }
    } catch (e) {
      errors.push(`${d.name}: ${String(e.message).split("\n")[0]}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify({ out: OUT, shots, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
})();
