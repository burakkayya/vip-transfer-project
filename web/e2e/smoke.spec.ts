import { expect, test } from "@playwright/test";
import { gotoStable } from "./nav";

test("home renders localized hero", async ({ page }) => {
  await gotoStable(page, "/tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
