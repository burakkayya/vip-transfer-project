import { expect, test } from "@playwright/test";
import tr from "../messages/tr.json";
import { expectNoAxeViolations } from "./a11y";
import { warmUp } from "./session";

// K-29 / K-79 şoförlü günlük kiralama sihirbazı (`/daily`). Fiyatlar API'den gelir; burada teklif yanıtı sahte
// verilir, istemcinin fiyatı hesaplamadığı ve tekil/çoğul gün metinleri sınanır.

test.describe.configure({ timeout: 60_000 });
test.beforeAll(async ({ browser }, info) => warmUp(browser, info, ["/tr/daily", "/en/daily"]));

const QUOTE = {
  vehicle_type_code: "minivan", package: "tam", days: 1, hours_per_day: 10, km_per_day: 250, day_price: "170.00",
  price: "170.00", total: "170.00", currency: "EUR", extra_hour_price: "20.00", extra_km_price: "0.80",
  schedule: [{ day: 1, start_at: "2030-01-02T06:00:00Z", price: "170.00" }],
};

test("plan step has no axe violations and the menu links to it", async ({ page }) => {
  await page.goto("/tr");
  // Dar ekranda bağlantı menü panelindedir.
  const menu = page.getByRole("button", { name: tr.nav.menu });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: tr.nav.daily }).locator("visible=true").first().click();
  await expect(page).toHaveURL(/\/tr\/daily$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(tr.daily.title);
  await expectNoAxeViolations(page, { include: "main" });
});

test("submitting without a start point shows a field error, not the label", async ({ page }) => {
  await page.goto("/tr/daily");
  await page.getByRole("button", { name: tr.daily.showPrices }).click();
  await expect(page.locator("#daily-start")).toBeFocused();
  await expect(page.getByText(tr.daily.startRequired)).toBeVisible();
});

test("package is a radio group with arrow key navigation", async ({ page }) => {
  await page.goto("/tr/daily");
  const full = page.getByRole("radio", { name: tr.daily.full });
  const half = page.getByRole("radio", { name: tr.daily.half });
  await expect(full).toHaveAttribute("aria-checked", "true");
  await full.focus();
  await page.keyboard.press("ArrowRight");
  await expect(half).toHaveAttribute("aria-checked", "true");
  await expect(half).toBeFocused();
});

test("vehicle step shows API prices and singular day text", async ({ page }) => {
  await page.route("**/bff/daily-quotes", (route) => route.fulfill({ json: QUOTE }));
  await page.goto("/en/daily");
  await page.locator("#daily-start").click();
  await page.locator("#daily-start").pressSequentially("Kemer", { delay: 40 });
  await page.locator("[role=listbox] [role=option]").first().click();
  await page.locator("#daily-days").selectOption("1");
  await page.getByRole("button", { name: "Show prices" }).click();
  const card = page.locator(".vehicle-card").first();
  await expect(card).toContainText("€170.00");
  await expect(card).toContainText("Total for 1 day");
  await expect(page.locator(".wizard-summary")).toContainText("1 day · Full day");
});

test("390 px has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tr/daily");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
