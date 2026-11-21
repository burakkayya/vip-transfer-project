// K-79 günlük kiralama tamamlama ekran görüntüleri: web tek gün iptali, admin günler kartı (kullanım, toplu atama,
// gün iptali) ve manuel günlük rezervasyon formu, sürücüde gün sonu km, mobil müşteride gün iptali bağlantısı.
// Kullanım: node k79.js --code <rezervasyon kodu> --id <rezervasyon id> --phone <müşteri telefonu, +90...>
//           --leg <sürücüde başlamış günün id'si> [--only web,admin,driver,mobile]
// Önkoşul: backend, web, admin ve mobil önizlemeler çalışıyor; rezervasyon ödenmiş 3 günlük kiralama, 1. gün demo
// sürücüde (5300000001) başlamış. Çıktı: docs/ui-review/screenshots/after/k79/<ad>.png
const path = require("path");
const { URLS, ADMIN_STATE, hasAdminState, parseArgs, launch, outDir } = require("./lib");

const args = parseArgs();
const only = typeof args.only === "string" ? args.only.split(",") : ["web", "admin", "driver", "mobile"];
const OUT = outDir("after", "k79");
const done = [];
const missed = [];
const digits = String(args.phone || "").replace(/^\+90/, "");

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
  done.push(name);
}

async function run(name, fn) {
  try {
    await fn();
  } catch (e) {
    missed.push({ name, error: String(e.message).split("\n")[0] });
  }
}

async function web(browser, width, prefix, cancel) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, locale: "tr" });
  const page = await ctx.newPage();
  await page.goto(`${URLS.web}/tr/bookings/${args.code}`);
  await page.locator("#otp-phone").fill(digits, { timeout: 30000 });
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  const dev = page.getByText(/Geliştirme ortamı: kodunuz (\d{6})/);
  await dev.waitFor({ timeout: 15000 });
  const code = (await dev.innerText()).match(/(\d{6})/)[1];
  await page.getByLabel("SMS kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();
  await page.locator(".daily-terms").waitFor({ timeout: 20000 });
  const buttons = page.getByRole("button", { name: "Bu günü iptal et" });
  await buttons.first().waitFor({ timeout: 15000 });
  await buttons.last().scrollIntoViewIfNeeded();
  await shot(page, `${prefix}-1-days`, { fullPage: true });
  if (!cancel) return ctx.close();
  await buttons.last().click();
  await page.locator(".day-cancel.cancel-panel").waitFor({ timeout: 15000 });
  await page.locator(".day-cancel.cancel-panel").scrollIntoViewIfNeeded();
  await shot(page, `${prefix}-2-panel`);
  await page.getByRole("button", { name: "Günü iptal et", exact: true }).click();
  await page.getByText(/gün iptal edildi/).first().waitFor({ timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${prefix}-3-done`, { fullPage: true });
  await ctx.close();
}

async function admin(browser) {
  if (!hasAdminState()) throw new Error("admin oturumu yok (admin: npx playwright test --project=setup)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ADMIN_STATE });
  const page = await ctx.newPage();
  await page.goto(`${URLS.admin}/bookings/${args.id}`);
  const section = page.locator("#daily-ops");
  await section.waitFor({ timeout: 30000 });
  await section.scrollIntoViewIfNeeded();
  await shot(page, "admin-1-days");
  await page.getByRole("button", { name: "Uygun sürücüleri getir" }).click();
  await page.waitForTimeout(2000);
  await section.scrollIntoViewIfNeeded();
  await shot(page, "admin-2-assign-all");
  await page.goto(`${URLS.admin}/bookings/new`);
  await page.getByText("2. Yolculuk").waitFor({ timeout: 30000 });
  await page.locator("section:has(#s-trip) select").first().selectOption("gunluk");
  await page.locator("#s-trip").scrollIntoViewIfNeeded();
  await shot(page, "admin-3-manual-daily", { fullPage: true });
  await ctx.close();
}

const PHONE_VIEW = { viewport: { width: 440, height: 920 }, deviceScaleFactor: 1, locale: "tr-TR" };

async function mobileLogin(page, d) {
  await page.getByRole("textbox").first().fill(d);
  await page.getByText(/^Devam$/).last().click();
  await page.getByText(/Geliştirme ortamı/).first().waitFor({ timeout: 20000 });
  await page.getByText(/Geliştirme ortamı/).first().click();
}

async function driver(browser) {
  const ctx = await browser.newContext(PHONE_VIEW);
  const page = await ctx.newPage();
  await page.goto(URLS.driver, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await mobileLogin(page, "5300000001");
  await page.getByText("Yaklaşan işler").waitFor({ timeout: 30000 });
  await page.goto(`${URLS.driver}/trip/${args.leg}`, { waitUntil: "domcontentloaded" });
  const card = page.getByText("Gün sonu km").first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await shot(page, "driver-1-day-report");
  await page.getByRole("textbox").last().fill("268");
  await page.getByText(/^Km'yi kaydet$/).click();
  await page.getByText(/Kaydedildi: 268 km/).waitFor({ timeout: 15000 });
  await shot(page, "driver-2-day-report-saved");
  await ctx.close();
}

async function mobile(browser) {
  const ctx = await browser.newContext(PHONE_VIEW);
  const page = await ctx.newPage();
  await page.goto(URLS.mobile, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await mobileLogin(page, digits);
  await page.waitForTimeout(3000);
  await page.goto(`${URLS.mobile}/booking/${args.code}`, { waitUntil: "domcontentloaded" });
  const link = page.getByText("Bu günü iptal et").first();
  await link.waitFor({ timeout: 30000 });
  await link.scrollIntoViewIfNeeded();
  await shot(page, "mobile-1-days");
  await ctx.close();
}

(async () => {
  const browser = await launch();
  if (only.includes("web")) {
    await run("web-390", () => web(browser, 390, "web-tr-390", false));
    await run("web-1440", () => web(browser, 1440, "web-tr-1440", true));
  }
  if (only.includes("admin")) await run("admin", () => admin(browser));
  if (only.includes("driver")) await run("driver", () => driver(browser));
  if (only.includes("mobile")) await run("mobile", () => mobile(browser));
  await browser.close();
  console.log(JSON.stringify({ out: OUT, done, missed }, null, 2));
})();
