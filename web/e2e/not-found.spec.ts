import { expect, test } from "@playwright/test";
import tr from "../messages/tr.json";
import { expectNoAxeViolations } from "./a11y";
import { warmUp } from "./session";

// Yerel 404 (B-W15): `app/[locale]/not-found.tsx`. Hiçbir rotaya uymayan adres (`[...rest]`) ve `notFound()` çağıran
// rota (ör. bilinmeyen yasal sayfa) aynı ekranı çizer. Boş ve hata durumu yok (statik ekran).

test.describe.configure({ timeout: 60_000 });
test.beforeAll(async ({ browser }, info) => warmUp(browser, info, ["/tr/bu-sayfa-yok", "/tr/legal/olmayan", "/de/bu-sayfa-yok"]));

for (const path of ["/tr/bu-sayfa-yok", "/tr/legal/olmayan"]) {
  test(`not-found has no axe violations (${path})`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("404");
    await expectNoAxeViolations(page);
  });

  test(`404 offers home and bookings links (${path})`, async ({ page }) => {
    await page.goto(path);
    const box = page.locator(".not-found");
    await expect(box.getByRole("link", { name: tr.errors.back_home })).toHaveAttribute("href", "/tr");
    await expect(box.getByRole("link", { name: tr.nav.bookings })).toHaveAttribute("href", "/tr/bookings");
    await expect(box.getByRole("link", { name: tr.nav.book, exact: true })).toHaveAttribute("href", "/tr/book");
  });

  test(`404 has its own document title (${path})`, async ({ page }) => {
    await page.goto(path);
    // Sekme ve geçmişte ana sayfa başlığıyla karışmaz.
    await expect(page).toHaveTitle(/^404\b/);
  });
}

test("404 does not overflow at 360-1440 px in German", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Genişlikler testte ayarlanır");
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/de/bu-sayfa-yok");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
  }
});
