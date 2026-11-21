// K-29 şoförlü günlük kiralama ekran görüntüleri: web (1440, 390), admin, mobil müşteri ve sürücü önizlemesi.
// Kullanım: node daily.js [--only web,admin,mobile,driver]
// Çıktı: docs/ui-review/screenshots/after/k29/<ad>.png
// Önkoşul: backend, web (3000), admin (3001), mobil önizleme (8081 müşteri, 8082 sürücü) çalışıyor; seed ve seed-demo yüklü.
const path = require("path");
const { URLS, ADMIN_STATE, hasAdminState, parseArgs, launch, outDir } = require("./lib");

const args = parseArgs();
const only = typeof args.only === "string" ? args.only.split(",") : ["web", "admin", "mobile", "driver"];
const OUT = outDir("after", "k29");
const done = [];
const missed = [];

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

let bookingCode = null;

async function web(browser, width, locale, prefix) {
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, locale });
  const page = await ctx.newPage();
  await page.goto(`${URLS.web}/${locale}/daily`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot(page, `${prefix}-1-plan-empty`);
  await page.locator("#daily-start").click();
  await page.locator("#daily-start").pressSequentially("Kemer", { delay: 60 });
  await page.locator("[role=listbox] [role=option]").first().waitFor({ timeout: 15000 });
  await page.locator("[role=listbox] [role=option]").first().click();
  await page.locator("#daily-days").selectOption("3");
  await shot(page, `${prefix}-2-plan`, { fullPage: true });
  await page.getByRole("button", { name: /Fiyatları göster|Show prices/ }).click();
  await page.locator(".vehicle-card .price").first().waitFor({ timeout: 20000 });
  await shot(page, `${prefix}-3-vehicle`, { fullPage: true });
  if (locale !== "tr") return ctx.close();
  await page.locator(".vehicle-card").first().click();
  await page.locator("#daily-name").fill("Anna Schmidt");
  await page.locator("#daily-note").fill("1. gün Olimpos ve Çıralı, 2. gün Phaselis, 3. gün Kemer marina");
  await page.getByRole("button", { name: "Devam" }).click();
  await page.locator("#otp-phone").fill(`555${String(Date.now()).slice(-7)}`);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  const dev = page.getByText(/Geliştirme ortamı: kodunuz (\d{6})/);
  await dev.waitFor({ timeout: 15000 });
  const code = (await dev.innerText()).match(/(\d{6})/)[1];
  await page.getByLabel("SMS kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();
  await page.locator(".consents").waitFor({ timeout: 20000 });
  const boxes = page.locator(".consents input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await shot(page, `${prefix}-4-confirm`, { fullPage: true });
  await page.getByRole("button", { name: /Rezervasyonu oluştur ve öde/ }).click();
  await page.waitForURL(/\/pay$/, { timeout: 30000 });
  await page.locator(".pay-facts").waitFor({ timeout: 20000 });
  bookingCode = page.url().match(/bookings\/([A-Z0-9]+)\/pay/)[1];
  await shot(page, `${prefix}-5-pay`, { fullPage: true });
  const frame = page.frameLocator("iframe").first();
  await frame.getByRole("button", { name: /Ödemeyi onayla/ }).click();
  await page.getByText(/Ödemeniz alındı/).waitFor({ timeout: 30000 });
  await page.goto(`${URLS.web}/tr/bookings/${bookingCode}`);
  await page.locator(".daily-terms").waitFor({ timeout: 20000 });
  await shot(page, `${prefix}-6-detail`, { fullPage: true });
  await ctx.close();
}

async function admin(browser) {
  if (!hasAdminState()) throw new Error("admin oturumu yok (admin: npx playwright test --project=setup)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ADMIN_STATE });
  const page = await ctx.newPage();
  await page.goto(`${URLS.admin}/pricing`);
  const section = page.locator("#daily-rates-title");
  await section.waitFor({ timeout: 30000 });
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, "admin-1-daily-rates");
  await page.goto(`${URLS.admin}/bookings`);
  await page.getByText("Hizmet").first().waitFor({ timeout: 20000 });
  await page.locator("select").nth(2).selectOption("gunluk");
  await page.waitForTimeout(1500);
  await shot(page, "admin-2-bookings-daily");
  await page.locator("table a").first().click();
  await page.getByText(/Aşım \(bilgi\)/).waitFor({ timeout: 20000 });
  await shot(page, "admin-3-booking-detail", { fullPage: true });
  await ctx.close();
}

const PHONE_VIEW = { viewport: { width: 440, height: 920 }, deviceScaleFactor: 1, locale: "tr-TR" };

async function mobileLogin(page, digits) {
  await page.getByRole("textbox").first().fill(digits);
  await page.getByText(/^Devam$/).last().click();
  await page.getByText(/Geliştirme ortamı/).first().waitFor({ timeout: 20000 });
  await page.getByText(/Geliştirme ortamı/).first().click();
}

async function mobile(browser) {
  const ctx = await browser.newContext(PHONE_VIEW);
  const page = await ctx.newPage();
  await page.goto(URLS.mobile, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await mobileLogin(page, `555${String(Date.now()).slice(-7)}`);
  await page.getByText("Günlük şoförlü araç").waitFor({ timeout: 20000 });
  await page.getByText("Günlük şoförlü araç").scrollIntoViewIfNeeded();
  await shot(page, "mobile-1-home-card");
  await page.getByText("Günlük şoförlü araç").click();
  await page.getByText("Şoförlü günlük kiralama").waitFor({ timeout: 20000 });
  await page.getByText("Başlangıç noktası (otel)").first().click();
  await page.getByRole("textbox").last().fill("Kemer");
  await page.waitForTimeout(2500);
  await page.getByText(/^Kemer$/).first().click();
  await page.waitForTimeout(1000);
  await shot(page, "mobile-2-plan");
  await page.getByText("Fiyatları göster").click();
  await page.getByText(/gün toplam/).first().waitFor({ timeout: 20000 });
  await shot(page, "mobile-3-vehicle");
  await page.getByText(/ seç · /).click();
  await page.getByText("Yolcu bilgileri").waitFor({ timeout: 20000 });
  await shot(page, "mobile-4-details");
  await ctx.close();
}

async function driver(browser) {
  const ctx = await browser.newContext(PHONE_VIEW);
  const page = await ctx.newPage();
  await page.goto(URLS.driver, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await mobileLogin(page, "5300000001");
  await page.getByText("Yaklaşan işler").waitFor({ timeout: 20000 });
  const card = page.getByText(/Günlük kiralama ·/).first();
  await card.waitFor({ timeout: 20000 });
  await card.scrollIntoViewIfNeeded();
  await shot(page, "driver-1-pool");
  await card.click();
  await page.waitForTimeout(4000);
  await shot(page, "driver-2-job");
  await ctx.close();
}

(async () => {
  const browser = await launch();
  if (only.includes("web")) {
    await run("web-tr-1440", () => web(browser, 1440, "tr", "web-tr-1440"));
    await run("web-tr-390", () => web(browser, 390, "tr", "web-tr-390"));
    await run("web-en-1440", () => web(browser, 1440, "en", "web-en-1440"));
  }
  if (only.includes("admin")) await run("admin", () => admin(browser));
  if (only.includes("mobile")) await run("mobile", () => mobile(browser));
  if (only.includes("driver")) await run("driver", () => driver(browser));
  await browser.close();
  console.log(JSON.stringify({ out: OUT, done, missed, bookingCode }, null, 2));
})();
