// K-81 iyileştirmeleri ekran görüntüleri: web (rezervasyon listesi sayfalama, veri talebini geri çekme, onay adımı
// özeti, noktalı yol 404), admin (fiyat değiştirme sınırı ve görev ayrılığı, incelemedeki ödemeler, sürücü fotoğrafı
// onayı, bahşiş iadesi), sürücü (günlük kiralamada bütün günleri kabul et).
// Kullanım: node k81.js --phone <+90… müşteri> --driver <sürücü id> --tip <bahşişli rezervasyon id>
//           --leg <atanmamış günlük işin ilk günü> --ops <operasyon personeli {email,password} JSON dosyası>
//           [--only web,admin,ops,driver]
// Önkoşul: backend, web, admin ve sürücü önizlemesi çalışıyor; örnek veri hazır. Çıktı: docs/ui-review/screenshots/after/k81/
const fs = require("fs");
const path = require("path");
const { URLS, ADMIN_STATE, hasAdminState, parseArgs, launch, outDir } = require("./lib");

const args = parseArgs();
const only = typeof args.only === "string" ? args.only.split(",") : ["web", "admin", "ops", "driver"];
const OUT = outDir("after", "k81");
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

async function webLogin(page, phone) {
  await page.locator("#otp-phone").fill(phone.replace(/^\+90/, ""), { timeout: 30000 });
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  const dev = page.getByText(/Geliştirme ortamı: kodunuz (\d{6})/);
  await dev.waitFor({ timeout: 15000 });
  const code = (await dev.innerText()).match(/(\d{6})/)[1];
  await page.getByLabel("SMS kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();
}

async function web(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr" });
  const page = await ctx.newPage();
  await page.goto(`${URLS.web}/tr/bookings`);
  await webLogin(page, args.phone);
  const more = page.getByRole("button", { name: "Daha fazla göster" });
  await more.waitFor({ timeout: 30000 });
  await more.scrollIntoViewIfNeeded();
  await shot(page, "web-tr-1440-1-bookings-more");
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll(".booking-list li").length > 20, null, { timeout: 15000 });
  await shot(page, "web-tr-1440-2-bookings-all");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${URLS.web}/tr/data-request`);
  const withdraw = page.getByRole("button", { name: /Talebi geri çek/ }).first();
  await withdraw.waitFor({ timeout: 30000 });
  await withdraw.scrollIntoViewIfNeeded();
  await shot(page, "web-tr-390-3-data-request");
  await withdraw.click();
  await page.getByText("Talebiniz geri çekildi.").waitFor({ timeout: 15000 });
  await shot(page, "web-tr-390-4-withdrawn");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${URLS.web}/tr/a.b`);
  await page.getByRole("heading", { name: "404" }).waitFor({ timeout: 20000 });
  await shot(page, "web-tr-1440-5-dotted-404");
  await ctx.close();
}

async function wizard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "tr" });
  const a = await ctx.newPage();
  const at = new Date(Date.now() + 5 * 86400000);
  at.setUTCHours(7, 0, 0, 0);
  const local = at.toISOString().slice(0, 16);
  await a.goto(`${URLS.web}/tr/book?from=ayt&to=kemer&at=${encodeURIComponent(local)}`);
  await a.waitForSelector(".vehicle-card .price", { timeout: 30000 });
  await a.locator(".vehicle-card:not([disabled])").first().click();
  await a.fill("#name", "Test Yolcu");
  await a.locator("form.card button[type=submit]").click();
  await a.waitForSelector("#otp-phone");
  await a.fill("#otp-phone", `555${String(Date.now()).slice(-7)}`);
  await a.locator("form:has(#otp-phone) button[type=submit]").click();
  await a.waitForSelector(".dev-hint");
  await a.click(".dev-hint");
  await a.locator("form:has(#otp-code) button[type=submit]").click();
  await a.waitForSelector(".confirm-recap", { timeout: 30000 });
  await a.locator(".wizard-main").scrollIntoViewIfNeeded();
  await shot(a, "web-tr-390-6-confirm-recap");
  await ctx.close();
}

async function admin(browser) {
  if (!hasAdminState()) throw new Error("admin oturumu yok (admin: npx playwright test --project=setup)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ADMIN_STATE });
  const page = await ctx.newPage();
  await page.goto(`${URLS.admin}/payments`);
  await page.locator("#h-review").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "admin-2-payment-review");
  await page.goto(`${URLS.admin}/drivers/${args.driver}`);
  const card = page.getByText("Profil fotoğrafı").first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shot(page, "admin-3-driver-photo");
  await page.goto(`${URLS.admin}/bookings/${args.tip}`);
  const tip = page.getByRole("button", { name: "Bahşişi iade et" });
  await tip.waitFor({ timeout: 30000 });
  await tip.scrollIntoViewIfNeeded();
  await shot(page, "admin-4-tip-refund");
  await ctx.close();
}

async function ops(browser) {
  const creds = JSON.parse(fs.readFileSync(args.ops, "utf8"));
  // eslint-disable-next-line import/no-dynamic-require
  const OTPAuth = require(path.resolve(__dirname, "../../admin/node_modules/otpauth"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${URLS.admin}/login`);
  await page.getByLabel("E-posta").fill(creds.email);
  await page.getByLabel("Parola").fill(creds.password);
  await page.getByRole("button", { name: "Devam" }).click();
  await page.getByLabel("Doğrulama kodu").waitFor({ timeout: 20000 });
  const secret = (await page.locator(".hint .mono").first().innerText()).trim();
  await page.getByLabel("Doğrulama kodu").fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20000 });

  await page.goto(`${URLS.admin}/bookings/new`);
  await page.getByLabel("Telefon (tam numara)").fill(args.phone);
  await page.getByRole("button", { name: "Müşteriyi bul" }).click();
  await page.getByRole("button", { name: "Değiştir" }).first().waitFor({ timeout: 15000 });
  await page.locator("section:has(#s-trip) select").first().selectOption("gunluk");
  const start = new Date(Date.now() + 4 * 86400000);
  await page.getByLabel("İlk gün başlangıcı (Türkiye saati)").fill(`${start.toISOString().slice(0, 10)}T09:00`);
  const place = page.locator("fieldset:has(legend:text('Başlangıç noktası (otel)'))");
  await place.getByText("İlçe / havalimanı seç").click();
  await place.locator("select").selectOption({ label: "Kemer" });
  await page.getByRole("button", { name: "Fiyatları hesapla" }).click();
  await page.getByRole("radiogroup", { name: "Araç tipi" }).waitFor({ timeout: 30000 });
  await page.getByText("Fiyatı değiştir (indirim, özel anlaşma)").click();
  await page.getByLabel(/Yeni toplam/).fill("10");
  await page.getByLabel("Gerekçe (zorunlu, denetim kaydına yazılır)").fill("Sadık müşteri indirimi");
  await page.getByText("Ödeme alındı (havale, nakit, POS)").click();
  await page.locator("#s-price").scrollIntoViewIfNeeded();
  await shot(page, "admin-1-override-limit", { fullPage: true });
  await ctx.close();
}

const PHONE_VIEW = { viewport: { width: 440, height: 920 }, deviceScaleFactor: 1, locale: "tr-TR" };

async function driver(browser) {
  const ctx = await browser.newContext(PHONE_VIEW);
  const page = await ctx.newPage();
  await page.goto(URLS.driver, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.getByRole("textbox").first().fill("5300000001");
  await page.getByText(/^Devam$/).last().click();
  await page.getByText(/Geliştirme ortamı/).first().waitFor({ timeout: 20000 });
  await page.getByText(/Geliştirme ortamı/).first().click();
  await page.getByText("Yaklaşan işler").waitFor({ timeout: 30000 });
  await page.goto(`${URLS.driver}/job/${args.leg}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/Bütün günleri kabul et/).first().waitFor({ timeout: 30000 });
  await shot(page, "driver-1-accept-all");
  await page.goto(`${URLS.driver}/documents`, { waitUntil: "domcontentloaded" });
  const pending = page.getByText(/Fotoğrafınız onay bekliyor/).first();
  await pending.waitFor({ timeout: 30000 });
  await pending.scrollIntoViewIfNeeded();
  await shot(page, "driver-2-photo-pending");
  await ctx.close();
}

(async () => {
  const browser = await launch();
  if (only.includes("web")) {
    await run("web", () => web(browser));
    await run("wizard", () => wizard(browser));
  }
  if (only.includes("admin")) await run("admin", () => admin(browser));
  if (only.includes("ops")) await run("ops", () => ops(browser));
  if (only.includes("driver")) await run("driver", () => driver(browser));
  await browser.close();
  console.log(JSON.stringify({ out: OUT, done, missed }, null, 2));
})();
