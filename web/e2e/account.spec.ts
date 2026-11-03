import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { login } from "./session";

// Hesabım (B-W9): `/account`, `AccountPanel`. Profil, pazarlama onayı (KVKK: önceden işaretli değil), durumlar.
// Her test BFF üzerinden yeni bir kurgusal numarayla giriş yapar (geliştirme kodu).

test.describe.configure({ timeout: 60_000 });
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const marketingCard = (page: Page) => page.locator(".marketing-card");
const marketingBox = (page: Page) =>
  page.getByRole("checkbox", { name: "Kampanya ve fırsat iletileri almak istiyorum." });

/** Hidrasyon tamamlanana kadar tıklamayı yineler. */
async function clickUntil(page: Page, action: () => Promise<void>, done: () => Promise<void>) {
  await expect(async () => {
    await action();
    await done();
  }).toPass({ timeout: 30_000 });
}

test("marketing consent toggle not preselected; save announces", async ({ page }) => {
  await login(page);
  await page.goto("/tr/account");
  const box = marketingBox(page);
  await expect(box).toBeVisible({ timeout: 30_000 });
  // KVKK: yeni hesapta pazarlama onayı işaretli gelmez.
  await expect(box).not.toBeChecked();
  const status = marketingCard(page).getByRole("status");
  await clickUntil(
    page,
    async () => {
      if (!(await box.isChecked())) await box.check();
    },
    async () => expect(status).toHaveText("Tercihiniz kaydedildi. Kampanya iletileri açık.", { timeout: 3_000 }),
  );
  await expect(box).toBeChecked();
  // Kalıcı: yeniden yüklenince işaretli.
  await page.reload();
  await expect(marketingBox(page)).toBeChecked({ timeout: 30_000 });
  await clickUntil(
    page,
    async () => {
      if (await marketingBox(page).isChecked()) await marketingBox(page).uncheck();
    },
    async () =>
      expect(marketingCard(page).getByRole("status")).toHaveText("Tercihiniz kaydedildi. Kampanya iletileri kapalı.", {
        timeout: 3_000,
      }),
  );
  // Profil kaydı da duyurulur.
  await page.fill("#full-name", "Test Yolcu");
  await page.locator(".profile-card").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator(".profile-card").getByRole("status")).toHaveText("Kaydedildi.");
  // Alan değişince eski "Kaydedildi." kalkar.
  await page.fill("#full-name", "Test Yolcu 2");
  await expect(page.locator(".profile-card").getByRole("status")).toHaveText("");
});

test("marketing consent failure keeps the previous value", async ({ page }) => {
  await login(page);
  await page.route("**/bff/me/consents", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, body: "Internal Server Error" })
      : route.continue(),
  );
  await page.goto("/tr/account");
  const box = marketingBox(page);
  await expect(box).toBeVisible({ timeout: 30_000 });
  const alert = marketingCard(page).getByRole("alert");
  await clickUntil(
    page,
    async () => box.click(),
    async () => expect(alert).toBeVisible({ timeout: 3_000 }),
  );
  await expect(alert).toContainText("Tercihiniz kaydedilemedi");
  // Kaydedilmeyen onay işaretli gösterilmez.
  await expect(box).not.toBeChecked();
  // Hata profil kartına değil onay kartına yazılır.
  await expect(page.locator(".profile-card").getByRole("alert")).toHaveCount(0);
});

test("network error shows ErrorState with retry", async ({ page }) => {
  await login(page);
  await page.route("**/bff/me/profile", (route) => route.abort());
  await page.goto("/tr/account");
  const error = page.locator(".page").getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  const retry = error.getByRole("button", { name: "Tekrar dene" });
  await expect(retry).toBeVisible();
  await page.unroute("**/bff/me/profile");
  await retry.click();
  await expect(page.getByRole("heading", { level: 2, name: "Profil" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".page").getByRole("alert")).toHaveCount(0);
});

test("network error on every BFF call shows ErrorState, not the login", async ({ page }) => {
  await login(page);
  await page.route("**/bff/**", (route) => route.abort());
  await page.goto("/tr/account");
  const error = page.locator(".page").getByRole("alert");
  await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#otp-phone")).toHaveCount(0);
});

test("account loading state", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/bff/me/profile", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/tr/account");
  const loading = page.getByRole("status").filter({ hasText: "Hesap bilgileriniz yükleniyor" });
  await expect(loading).toBeVisible({ timeout: 30_000 });
  release();
  await expect(page.getByRole("heading", { level: 2, name: "Profil" })).toBeVisible({ timeout: 30_000 });
  await expect(loading).toHaveCount(0);
});

test("account empty state", async ({ page }) => {
  // "Boş" hesap: ad ve e-posta yok, hiç onay kaydı yok. Form boş alanlarla çizilir, uyarı yok, kutu işaretsiz.
  const phone = await login(page);
  // Yanıt tümüyle taklit (gerçek isteği beklemez; derleme sırasında süre aşımına düşmez).
  await page.route("**/bff/me/profile", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: { full_name: null, email: null, phone, country_code: "TR", locale: "tr", currency: "TRY" },
        })
      : route.continue(),
  );
  await page.route("**/bff/me/consents", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue(),
  );
  await page.goto("/tr/account");
  await expect(page.locator("#full-name")).toHaveValue("", { timeout: 30_000 });
  await expect(page.locator("#email")).toHaveValue("");
  await expect(marketingBox(page)).not.toBeChecked();
  await expect(page.locator(".page").getByRole("alert")).toHaveCount(0);
  // Telefon değiştirilemez ama okunur ve odaklanabilir (devre dışı değil, salt okunur).
  await expect(page.locator("#phone")).toHaveAttribute("readonly", "");
  await expect(page.locator("#phone")).toBeEnabled();
});

test("account error state", async ({ page }) => {
  // Onay durumu alınamazsa kutu "işaretsiz" diye gösterilmez: kartta hata ve yeniden dene.
  await login(page);
  await page.route("**/bff/me/consents", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, body: "Internal Server Error" })
      : route.continue(),
  );
  await page.goto("/tr/account");
  const card = marketingCard(page);
  const error = card.getByRole("alert");
  await expect(error).toContainText("Bir hata oluştu", { timeout: 30_000 });
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  // Profil formu etkilenmez.
  await expect(page.getByRole("heading", { level: 2, name: "Profil" })).toBeVisible();
  await page.unroute("**/bff/me/consents");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(marketingBox(page)).toBeVisible({ timeout: 30_000 });
  await expect(marketingBox(page)).not.toBeChecked();
});

test("account has no axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/tr/account");
  await expect(marketingBox(page)).toBeVisible({ timeout: 30_000 });
  await page.fill("#full-name", "Test Yolcu");
  await page.locator(".profile-card").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator(".profile-card .alert")).toBeVisible();
  await expectNoAxeViolations(page, { include: "main" });
});

test("account fits 360px in German with a 120 character name", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlikler testte ayarlanır");
  await login(page, "de");
  const long = "Maximilian-Alexander von Hohenzollern-Sigmaringen ".repeat(3).slice(0, 120);
  await page.route("**/bff/me/profile", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      json: { ...(await res.json()), full_name: long, email: `${"a".repeat(60)}@example-sehr-langer-name.de` },
    });
  });
  await page.goto("/de/account");
  await expect(page.locator("#full-name")).toHaveValue(long, { timeout: 30_000 });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".page .btn, .page h1, .page h2, .page label, .page .hint, .page a"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, `${width}px`).toEqual([]);
  }
});
