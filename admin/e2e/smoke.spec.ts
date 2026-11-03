import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { hasCredentials, SKIP_MESSAGE } from "./session";

test.describe("giriş yapılmamış", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page has no axe violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Giriş yap" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test("dashboard loads when logged in", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1, name: "Genel panel" })).toBeVisible();
});
