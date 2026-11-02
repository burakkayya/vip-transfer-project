// Müşteri (8081) ve sürücü (8082) uygulamalarının web önizlemesinde çalışan ortak akış.
// mobile.js yalnızca `customer-*`, driver.js yalnızca `driver-*` dosyalarını yazar; akış aynıdır,
// çünkü sürücü teklifi bir müşteri rezervasyonu ister ve müşterinin canlı takip ekranı sürücü ister.
const path = require("path");
const { URLS, parseArgs, requireOut, makeFilter, launch, outDir } = require("./lib");

const VIEW = { viewport: { width: 440, height: 920 }, deviceScaleFactor: 1 };
const DRIVER_PHONE = "5300000001"; // geliştirme tohum sürücüsü
const BROWSER_LOCALE = { tr: "tr-TR", de: "de-DE" };
// Müşteri rezervasyonu ile sürücüyü birlikte gerektiren ekranlar.
const DRIVER_FLOW = [
  "driver-tr-home-offer",
  "driver-tr-trip-assigned",
  "driver-tr-trip-sign",
  "driver-tr-trip-enroute",
  "customer-tr-booking-live",
];
const DRIVER_STAGES = ["driver-tr-login", "driver-tr-login-otp", "driver-tr-home-offline", "driver-tr-home-online"];
const TAIL = ["driver-tr-home-upcoming", "driver-tr-documents", "driver-tr-earnings", "driver-tr-register"];

async function main(surface, script) {
  const args = parseArgs();
  const out = requireOut(args, script, surface === "customer" ? " [--locales tr,de]" : "");
  const filter = makeFilter(args, { suffix: true });
  const OUT = outDir(out, "mobile");
  const allow = (name) => name.startsWith(`${surface}-`) && filter.want(name);
  const locales = (typeof args.locales === "string" ? args.locales : "tr,de").split(",").map((s) => s.trim()).filter(Boolean);

  const done = [];
  const missed = [];
  const shotFn = (page) => async (name) => {
    if (!allow(name)) return;
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    done.push(name);
  };
  async function run(id, fn) {
    try {
      await fn();
    } catch (e) {
      missed.push({ name: id, error: String(e.message).split("\n")[0] });
    }
  }
  async function login(page, digits) {
    await page.getByRole("textbox").first().fill(digits);
    await page.getByText(/^(Devam|Weiter)$/).last().click();
    await page.getByText(/Geliştirme ortamı|Entwicklung|dev/i).first().waitFor({ timeout: 20000 });
  }
  // Adımlar sırayla çalışır; son istenen adımdan sonrası atlanır. step = {id, shots, drv?, fn}
  // drv: sürücü akışı gerekiyorsa bu adım da (rezervasyon oluşturmak için) çalışmalıdır.
  async function runSteps(steps, driverNeeded) {
    const wanted = steps.map((s) => s.shots.some(allow) || (s.drv && driverNeeded));
    const last = wanted.lastIndexOf(true);
    for (let i = 0; i <= last; i++) await run(steps[i].id, steps[i].fn);
  }

  const driverFlowNeeded = DRIVER_FLOW.some(allow);
  const driverOnline = driverFlowNeeded || DRIVER_STAGES.some(allow);
  const localeWanted = (l) => {
    if (l === "tr" && driverFlowNeeded) return true;
    if (surface !== "customer") return false;
    return filter.all || filter.list.some((p) => p.startsWith(`customer-${l}-`) || (!p.startsWith("customer-") && !p.startsWith("driver-")));
  };

  const browser = await launch();

  // Sürücü önce çevrimiçi olur ki anlık rezervasyonda teklif gelsin.
  let dctx = null;
  let d = null;
  let dshot = async () => {};
  if (driverOnline) {
    dctx = await browser.newContext({ ...VIEW, locale: "tr-TR" });
    d = await dctx.newPage();
    dshot = shotFn(d);
    await d.goto(URLS.driver);
    await d.waitForTimeout(3000);
    await run("driver-login", () => dshot("driver-tr-login"));
    await run("driver-otp", async () => {
      await login(d, DRIVER_PHONE);
      await dshot("driver-tr-login-otp");
      await d.getByText(/Geliştirme ortamı/).first().click();
      await d.getByText("Yaklaşan işler").waitFor({ timeout: 20000 });
    });
    await run("driver-home-offline", async () => {
      const off = d.getByText("Çevrimdışı ol");
      if (await off.count()) {
        await off.first().click();
        await d.waitForTimeout(1200);
      }
      await dshot("driver-tr-home-offline");
    });
    await run("driver-home-online", async () => {
      await d.getByText("GO", { exact: true }).click();
      await d.getByText("Teklif bekleniyor…").waitFor({ timeout: 15000 });
      await dshot("driver-tr-home-online");
    });
  }

  for (const loc of locales.filter(localeWanted)) {
    const ctx = await browser.newContext({ ...VIEW, locale: BROWSER_LOCALE[loc] || loc });
    const c = await ctx.newPage();
    const cshot = shotFn(c);
    const p = `customer-${loc}`;
    const steps = [
      { id: `${p}-login`, shots: [`${p}-login`], fn: async () => {
        await c.goto(URLS.mobile);
        await c.waitForTimeout(3000);
        await cshot(`${p}-login`);
      } },
      { id: `${p}-otp`, shots: [`${p}-login-otp`, `${p}-home`], drv: true, fn: async () => {
        await login(c, `55590${loc === "tr" ? "1" : "2"}${String(Date.now()).slice(-4)}`);
        await cshot(`${p}-login-otp`);
        await c.getByText(/Geliştirme ortamı|Entwicklung/).first().click();
        await c.waitForTimeout(3000);
        await cshot(`${p}-home`);
      } },
      { id: `${p}-bookings-empty`, shots: [`${p}-bookings-empty`], fn: async () => {
        await c.getByText(/^(Rezervasyonlarım|Meine Buchungen)$/).last().click();
        await c.waitForTimeout(2000);
        await cshot(`${p}-bookings-empty`);
      } },
      { id: `${p}-profile`, shots: [`${p}-profile`], fn: async () => {
        await c.getByText(/^(Profil|Hesap|Konto)$/).last().click();
        await c.waitForTimeout(2000);
        await cshot(`${p}-profile`);
      } },
      { id: `${p}-book-trip`, shots: [`${p}-book-trip`], drv: true, fn: async () => {
        await c.getByText(/^(Ana sayfa|Start(seite)?)$/).last().click();
        await c.waitForTimeout(1500);
        await c.getByText(/Antalya/).first().click();
        await c.waitForTimeout(1500);
        await cshot(`${p}-book-trip`);
      } },
      { id: `${p}-address-modal`, shots: [`${p}-address-search`], drv: true, fn: async () => {
        await c.getByText(/^(Nereye|Wohin|Nach)$/).filter({ visible: true }).first().click();
        await c.waitForTimeout(1000);
        await c.getByRole("textbox").last().fill("kemer");
        await c.waitForTimeout(2000);
        await cshot(`${p}-address-search`);
        await c.getByText(/Kemer/).last().click();
        await c.waitForTimeout(1200);
      } },
      loc === "tr"
        ? { id: `${p}-instant`, shots: [`${p}-book-trip-filled`], drv: true, fn: async () => {
            await c.getByText("Şimdi", { exact: true }).first().click();
            await c.waitForTimeout(800);
            await cshot(`${p}-book-trip-filled`);
          } }
        : { id: `${p}-trip-filled`, shots: [`${p}-book-trip-filled`], drv: true, fn: () => cshot(`${p}-book-trip-filled`) },
      { id: `${p}-vehicle`, shots: [`${p}-book-vehicle`], drv: true, fn: async () => {
        await c.getByText(/^(Fiyatları göster|Preise anzeigen)/).last().click();
        await c.waitForTimeout(4000);
        await cshot(`${p}-book-vehicle`);
      } },
      { id: `${p}-details`, shots: [`${p}-book-details`, `${p}-book-details-filled`], drv: true, fn: async () => {
        await c.getByText(/(seç|wählen|auswählen) ·/).last().click();
        await c.waitForTimeout(1500);
        await cshot(`${p}-book-details`);
        await c.getByRole("textbox").first().fill("Test Yolcu");
        const checks = c.getByRole("checkbox");
        await checks.nth(0).click();
        await checks.nth(1).click();
        await cshot(`${p}-book-details-filled`);
      } },
      { id: `${p}-pay`, shots: [`${p}-booking-waiting-payment`, `${p}-booking-detail`], drv: true, fn: async () => {
        const popupP = ctx.waitForEvent("page", { timeout: 20000 });
        popupP.catch(() => {});
        await c.getByText(/(Rezervasyonu oluştur ve öde|Buchen und bezahlen)/).last().click();
        const pay = await popupP;
        await pay.waitForLoadState();
        await c.waitForTimeout(1500);
        await cshot(`${p}-booking-waiting-payment`);
        await pay.getByText("Ödemeyi onayla").click();
        await pay.waitForTimeout(1000);
        await pay.close();
        await c.waitForTimeout(6000);
        await cshot(`${p}-booking-detail`);
      } },
    ];
    if (loc === "tr" && d) {
      steps.push(
        { id: "driver-offer", shots: ["driver-tr-home-offer", "driver-tr-trip-assigned"], drv: true, fn: async () => {
          await d.getByText("Kabul et").waitFor({ timeout: 30000 });
          await dshot("driver-tr-home-offer");
          await d.getByText("Kabul et").click();
          await d.waitForTimeout(3000);
          await dshot("driver-tr-trip-assigned");
        } },
        { id: "driver-sign", shots: ["driver-tr-trip-sign"], drv: true, fn: async () => {
          await d.getByText("Karşılama tabelasını aç").click();
          await d.waitForTimeout(1200);
          await dshot("driver-tr-trip-sign");
          await d.getByText("Kapatmak için dokunun").click();
          await d.waitForTimeout(800);
        } },
        { id: "customer-live", shots: ["driver-tr-trip-enroute", "customer-tr-booking-live"], drv: true, fn: async () => {
          await d.getByText("Yola çıktım").click().catch(() => {});
          await d.waitForTimeout(1500);
          const send = d.getByText(/konum gönder/i);
          if (await send.count()) {
            await send.first().click();
            await d.waitForTimeout(800);
            await send.first().click();
          }
          await dshot("driver-tr-trip-enroute");
          await c.waitForTimeout(4000);
          await cshot(`${p}-booking-live`);
        } },
      );
    }
    steps.push(
      { id: `${p}-cancel-preview`, shots: [`${p}-booking-cancel-preview`], fn: async () => {
        await c.getByText(/(Rezervasyonu iptal et|stornieren)/).first().click();
        await c.waitForTimeout(1500);
        await cshot(`${p}-booking-cancel-preview`);
      } },
      { id: `${p}-bookings-list`, shots: [`${p}-bookings-list`], fn: async () => {
        await c.goto(`${URLS.mobile}/bookings`);
        await c.waitForTimeout(3000);
        await cshot(`${p}-bookings-list`);
      } },
    );
    await runSteps(steps, driverFlowNeeded && loc === "tr");
    await ctx.close();
  }
  if (dctx) await dctx.close();

  // Sürücü kuyruğu: yaklaşan işler, belgeler, kazanç; yeni numarayla kayıt.
  if (surface === "driver" && TAIL.some(allow)) {
    const tlogin = async (page, digits) => {
      await page.goto(URLS.driver);
      await page.waitForTimeout(3000);
      await page.getByRole("textbox").first().fill(digits);
      await page.getByText(/^Devam$/).last().click();
      await page.getByText(/Geliştirme ortamı/).first().click();
      await page.waitForTimeout(3500);
    };
    if (["driver-tr-home-upcoming", "driver-tr-documents", "driver-tr-earnings"].some(allow)) {
      const tail = await browser.newContext({ ...VIEW, locale: "tr-TR" });
      const t = await tail.newPage();
      const tshot = shotFn(t);
      await run("driver-tail-login", () => tlogin(t, DRIVER_PHONE));
      await run("driver-home-upcoming", () => tshot("driver-tr-home-upcoming"));
      await run("driver-documents", async () => {
        await t.getByText("Belgeler", { exact: true }).last().click();
        await t.waitForTimeout(1200);
        await tshot("driver-tr-documents");
      });
      await run("driver-earnings", async () => {
        await t.getByText("Kazanç", { exact: true }).last().click();
        await t.waitForTimeout(1200);
        await tshot("driver-tr-earnings");
      });
      await tail.close();
    }
    if (allow("driver-tr-register")) {
      const rctx = await browser.newContext({ ...VIEW, locale: "tr-TR" });
      const r = await rctx.newPage();
      await run("driver-register", async () => {
        await tlogin(r, `5419${String(Date.now()).slice(-6)}`);
        await shotFn(r)("driver-tr-register");
      });
      await rctx.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify({ done: done.length, names: done, missed }, null, 2));
  if (missed.length) process.exitCode = 1;
}

module.exports = { main };
