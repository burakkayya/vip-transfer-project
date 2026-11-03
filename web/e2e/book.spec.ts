import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { fictionalPhone, login, loginOnScreen } from "./session";

// Rezervasyon sihirbazı (B-W2): araç, bilgiler, doğrulama, onay.

/** Bugünden `d` gün sonra saat `h`:00, `datetime-local` biçiminde (Türkiye saati varsayımıyla yerel). */
function inDays(d: number, h: number) {
  const t = new Date(Date.now() + d * 864e5);
  t.setHours(h, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

const BOOK = (locale = "tr", to = "kemer") => `/${locale}/book?from=ayt&to=${to}&at=${inDays(5, 10)}`;

async function vehicleStep(page: Page, url = BOOK()) {
  await page.goto(url);
  await expect(page.locator(".vehicle-card .price").first()).toBeVisible({ timeout: 30_000 });
}

async function detailsStep(page: Page, url = BOOK()) {
  await vehicleStep(page, url);
  await page.locator(".vehicle-card:not([disabled])").first().click();
  await expect(page.locator("#name")).toBeVisible();
}

/** Bilgiler → telefon doğrulama (geliştirme kodu, kurgusal numara) → onay adımı. */
async function confirmStep(page: Page) {
  await detailsStep(page);
  await page.fill("#name", "Test Yolcu");
  await page.locator("form.wizard-step button[type=submit]").click();
  await page.waitForSelector("#otp-phone");
  await loginOnScreen(page, fictionalPhone().e164);
  await expect(page.locator(".confirm-total")).toBeVisible({ timeout: 30_000 });
}

test("book has no axe violations at each step", async ({ page }) => {
  test.setTimeout(120_000);
  await vehicleStep(page);
  await expectNoAxeViolations(page);
  await page.locator(".vehicle-card:not([disabled])").first().click();
  await expect(page.locator("#name")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.fill("#name", "Test Yolcu");
  await page.locator("form.wizard-step button[type=submit]").click();
  await page.waitForSelector("#otp-phone");
  await expectNoAxeViolations(page);
  await loginOnScreen(page, fictionalPhone().e164);
  await expect(page.locator(".confirm-total")).toBeVisible({ timeout: 30_000 });
  await expectNoAxeViolations(page);
});

test("consent boxes start unchecked and pay is disabled until both required are checked", async ({ page }) => {
  test.setTimeout(90_000);
  await confirmStep(page);
  const boxes = page.locator(".wizard-step .check input[type=checkbox]");
  await expect(boxes).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).not.toBeChecked();
  const pay = page.locator("button.btn.primary.big");
  await expect(pay).toBeDisabled();
  // Neden devre dışı olduğu metinle söylenir ve düğmeye bağlıdır.
  await expect(page.locator("#pay-hint")).toBeVisible();
  await expect(pay).toHaveAttribute("aria-describedby", "pay-hint");
  // Yeni sekmede açılan yasal bağlantılar bunu söyler.
  for (const link of await page.locator(".consents a[target=_blank]").all()) {
    await expect(link).toHaveAccessibleName(/yeni sekmede açılır/);
  }
  await boxes.nth(0).check();
  await expect(pay).toBeDisabled();
  await boxes.nth(1).check();
  await expect(pay).toBeEnabled();
  await expect(page.locator("#pay-hint")).toBeHidden();
  // Pazarlama isteğe bağlıdır: işaretsiz kalırken de ödeme açıktır, zorunlu değildir.
  await expect(boxes.nth(2)).not.toBeChecked();
  await expect(boxes.nth(2)).not.toHaveAttribute("required", /.*/);
  await expect(boxes.nth(0)).toHaveAttribute("aria-required", "true");
  await expect(boxes.nth(1)).toHaveAttribute("aria-required", "true");
  // İptal kademeleri onay adımında K-14 ile birebir: sınırlar (48 ve 24 saat) ve oranlar birlikte.
  const tiers = page.locator(".cancel-tiers");
  await expect(tiers).toContainText("48 saat veya daha önce iptalde %100");
  await expect(tiers).toContainText("24-48 saat kala %50");
  await expect(tiers).toContainText("24 saatten az kala iade yapılmaz");
});

test("invalid flight number shows field-level error", async ({ page }) => {
  await detailsStep(page);
  await page.fill("#name", "Test Yolcu");
  // Brif "TK12" diyordu; ancak TK12 geçerli IATA biçimidir (havayolu kodu + 1-4 hane, ör. TK1 gerçek bir sefer).
  // Geçerli numarayı reddetmek yerine gerçekten geçersiz girişler denenir: numarasız kod ve izin dışı karakter.
  await page.fill("#flight", "TK-12");
  await page.locator("form.wizard-step button[type=submit]").click();
  const flight = page.locator("#flight");
  await expect(flight).toHaveAttribute("aria-invalid", "true");
  await expect(flight).toBeFocused();
  const describedBy = (await flight.getAttribute("aria-describedby")) ?? "";
  expect(describedBy.split(" ")).toContain("flight-error");
  await expect(page.locator("#flight-error")).toBeVisible();
  // Düzeltince hata kalkar.
  await flight.fill("TK1234");
  await expect(flight).not.toHaveAttribute("aria-invalid", "true");
  // Numarasız kod da reddedilir.
  await flight.fill("TK");
  await page.locator("form.wizard-step button[type=submit]").click();
  await expect(flight).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#flight-error")).toBeVisible();
  // TK12 geçerlidir: gönderimde hata yok, sihirbaz doğrulama adımına geçer.
  await flight.fill("TK12");
  await page.locator("form.wizard-step button[type=submit]").click();
  await expect(page.locator("#otp-phone")).toBeVisible();
  await expect(page.locator("#flight-error")).toHaveCount(0);
});

test("empty passenger name shows localized field error", async ({ page }) => {
  await detailsStep(page);
  await page.locator("form.wizard-step button[type=submit]").click();
  const name = page.locator("#name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#name-error")).toHaveText("Yolcunun adını ve soyadını yazın.");
});

test("TRY price fits on one line", async ({ page }) => {
  // tr yerelinde varsayılan ülke TR → TRY. Uzun rota (AYT → Datça) büyük tutar verir.
  await vehicleStep(page, BOOK("tr", "datca"));
  const prices = page.locator(".vehicle-price .price");
  const n = await prices.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const p = prices.nth(i);
    await expect(p).toContainText("₺");
    expect(await p.evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(await p.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
    expect(await p.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.locator(".vehicle-card:not([disabled])").first().click();
  const total = page.locator(".wizard-summary .total-row .price");
  expect(await total.evaluate((el) => el.getClientRects().length)).toBe(1);
});

test("TRY price fits on one line at 360px", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
  await page.setViewportSize({ width: 360, height: 800 });
  await vehicleStep(page, BOOK("tr", "datca"));
  const prices = page.locator(".wizard .price");
  const n = await prices.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const p = prices.nth(i);
    await expect(p).toContainText("₺");
    expect(await p.evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(await p.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  }
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test("logged-in user sees 3 steps without a 4-step frame", async ({ page }) => {
  await login(page);
  // Sayfa açılmadan önce gözlemci kurulur: göstergedeki en büyük adım sayısı kaydedilir.
  await page.addInitScript(() => {
    const w = window as unknown as { __maxSteps: number };
    w.__maxSteps = 0;
    new MutationObserver(() => {
      const n = document.querySelectorAll("ol.stepper-bar li").length;
      if (n > w.__maxSteps) w.__maxSteps = n;
    }).observe(document, { subtree: true, childList: true });
  });
  await vehicleStep(page);
  const bar = page.getByRole("list", { name: "Rezervasyon adımları" });
  await expect(bar.locator("li")).toHaveCount(3);
  await expect(bar).not.toContainText("Doğrulama");
  expect(await page.evaluate(() => (window as unknown as { __maxSteps: number }).__maxSteps)).toBe(3);
  // Bilgiler adımında da 3 kalır.
  await page.locator(".vehicle-card:not([disabled])").first().click();
  await expect(bar.locator("li")).toHaveCount(3);
  await expect(bar.locator('[aria-current="step"]')).toContainText("Bilgiler");
  expect(await page.evaluate(() => (window as unknown as { __maxSteps: number }).__maxSteps)).toBe(3);
});

test("wizard shows step progress to screen readers", async ({ page }) => {
  await vehicleStep(page);
  const bar = page.getByRole("list", { name: "Rezervasyon adımları" });
  await expect(bar).toBeVisible();
  await expect(bar.locator('[aria-current="step"]')).toContainText("Araç");
  // Oturumsuz kullanıcıda doğrulama adımı göstergede görünür.
  await expect(bar.locator("li")).toHaveCount(4);
  await page.locator(".vehicle-card:not([disabled])").first().click();
  await expect(bar.locator('[aria-current="step"]')).toContainText("Bilgiler");
  await expect(bar.locator("li").first()).toContainText("tamamlandı");
  // Odak yeni adımın başlığına gider (tıklanan kart DOM'dan kalkar).
  await expect(page.getByRole("heading", { level: 2, name: "Bilgiler" })).toBeFocused();
});

test("verify stays in the step indicator after phone verification", async ({ page }) => {
  test.setTimeout(90_000);
  await confirmStep(page);
  const bar = page.getByRole("list", { name: "Rezervasyon adımları" });
  await expect(bar.locator("li")).toHaveCount(4);
  await expect(bar.locator('[aria-current="step"]')).toContainText("Onay");
});

test("session check failure shows ErrorState with retry and does not treat the user as logged out", async ({ page }) => {
  await page.route("**/bff/auth/me", (route) => route.abort());
  await vehicleStep(page);
  const sessionError = page.locator(".wizard-session-error");
  await expect(sessionError).toContainText("Sunucuya ulaşılamadı");
  // Bilgiler gönderilince doğrulama adımına sessizce geçilmez.
  await page.locator(".vehicle-card:not([disabled])").first().click();
  await page.fill("#name", "Test Yolcu");
  await page.locator("form.wizard-step button[type=submit]").click();
  await expect(page.locator("form.wizard-step").getByRole("alert")).toContainText("Sunucuya ulaşılamadı");
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  // Bağlantı dönünce yeniden dene: oturumsuz kullanıcı için adım göstergesi gelir.
  await page.unroute("**/bff/auth/me");
  await sessionError.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("list", { name: "Rezervasyon adımları" }).locator("li")).toHaveCount(4);
  await page.locator("form.wizard-step button[type=submit]").click();
  await expect(page.locator("#otp-phone")).toBeVisible();
});

test("401 on booking create returns to verification with a session-expired message", async ({ page }) => {
  test.setTimeout(90_000);
  await confirmStep(page);
  await page.route("**/bff/me/bookings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "giriş gerekli" } } })
      : route.continue(),
  );
  const boxes = page.locator(".wizard-step .check input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.locator("button.btn.primary.big").click();
  await expect(page.locator("#otp-phone")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".wizard-step").getByRole("alert")).toContainText("Oturumunuz sona erdi");
});

test("route form on /book names missing address and focuses it", async ({ page }) => {
  await page.goto("/tr/book");
  const submit = page.locator(".wizard-start button[type=submit]");
  await expect(submit).toBeEnabled();
  await submit.click();
  const from = page.locator("#from");
  await expect(from).toBeFocused();
  await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".address.from .field-error")).toBeVisible();
});

test("address suggestions on /book work with keyboard and Escape", async ({ page }) => {
  await page.goto("/tr/book");
  const input = page.locator("#from");
  await input.click();
  await input.pressSequentially("antalya hav", { delay: 30 });
  await expect(page.getByRole("option", { name: /Antalya Havalimanı/ }).first()).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".address.from .address-chosen")).toBeVisible();
});

test("address search failure offers retry", async ({ page }) => {
  await page.route("**/bff/places/autocomplete**", (r) => r.abort());
  await page.goto("/tr/book");
  const input = page.locator("#from");
  await input.click();
  await input.pressSequentially("lara otel", { delay: 20 });
  const retry = page.locator(".address.from").getByRole("button", { name: "Tekrar dene" });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await page.unroute("**/bff/places/autocomplete**");
  await retry.click();
  await expect(retry).toBeHidden({ timeout: 10_000 });
});

test("price request failure shows error with retry", async ({ page }) => {
  await page.route("**/bff/quotes", (r) => r.abort());
  await page.goto(BOOK());
  const error = page.locator(".wizard-step .state-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/bff/quotes");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.locator(".vehicle-card .price").first()).toBeVisible({ timeout: 30_000 });
});

test("vehicle capacity is announced in words", async ({ page }) => {
  await vehicleStep(page);
  const card = page.locator(".vehicle-card").first();
  await expect(card).toContainText(/\d+ yolcu/);
  await expect(card).toContainText(/\d+ bagaj/);
  await expect(page.locator(".wizard-summary dl.summary")).toContainText(/2 yolcu · 2 bagaj/);
});

test("reduced motion: step panel is shown without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await vehicleStep(page);
  const step = page.locator(".wizard-step");
  expect(await step.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await step.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`de book at ${width}px has no horizontal overflow`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
    await page.setViewportSize({ width, height: 900 });
    const check = async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".wizard .btn, .wizard h2, .wizard h3, .stepper-bar li, .vehicle-card, .price"))
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
          .map((el) => el.textContent?.trim().slice(0, 40)),
      );
      expect(clipped).toEqual([]);
      // Fiyatlar tek satır.
      const wrapped = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".wizard .price")).filter((el) => el.getClientRects().length > 1).length,
      );
      expect(wrapped).toBe(0);
    };
    await vehicleStep(page, BOOK("de", "datca"));
    await check();
    await page.locator(".vehicle-card:not([disabled])").first().click();
    await expect(page.locator("#name")).toBeVisible();
    await check();
  });
}
