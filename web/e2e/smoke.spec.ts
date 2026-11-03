import { expect, test } from "@playwright/test";

test("home renders localized hero", async ({ page }) => {
  await page.goto("/tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
