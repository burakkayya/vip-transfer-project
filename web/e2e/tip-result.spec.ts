import { expect, test } from "@playwright/test";

// Bahşiş ödemesinin dönüş ekranı (K-75): `/booking/tip-result`. Sağlayıcı iFrame'i buraya döner; sayfa
// rezervasyon ekranının puan bölümüne (`/bookings/[code]?tip=ok|fail#rate-title`) geçer. Kod
// `sessionStorage.ga_pending_tip`'ten okunur ve silinir; kod yoksa `/bookings` açılır.

const TIP_KEY = "ga_pending_tip";

for (const status of ["ok", "fail"] as const) {
  test(`tip ${status} returns to the booking rating section`, async ({ page }) => {
    await page.addInitScript(([key]) => sessionStorage.setItem(key, "GA123456"), [TIP_KEY]);
    // Hedef sayfa tutulur (oturum yokken girişe yönlenmesin); istenen adres denetlenir.
    const target = page.waitForRequest((r) => r.url().includes("/tr/bookings/GA123456"), { timeout: 30_000 });
    await page.route(/\/tr\/bookings\/GA123456/, () => {});
    await page.goto(`/tr/booking/tip-result?status=${status}`);
    const url = new URL((await target).url());
    expect(url.pathname).toBe("/tr/bookings/GA123456");
    expect(url.searchParams.get("tip")).toBe(status);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), TIP_KEY)).toBeNull();
  });
}

test("tip result without pending code opens bookings and keeps the booking payment key untouched", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("ga_pending_booking", "GA999999"));
  await page.goto("/tr/booking/tip-result?status=ok");
  await expect(page).toHaveURL(/\/tr\/bookings$/, { timeout: 30_000 });
  expect(await page.evaluate(() => sessionStorage.getItem("ga_pending_booking"))).toBe("GA999999");
});

test("tip result heading is the tip title", async ({ page }) => {
  await page.route(/\/tr\/bookings(\?|$)/, () => {});
  await page.goto("/tr/booking/tip-result?status=ok");
  await expect(page.getByRole("heading", { level: 1, name: "Sürücünüze bahşiş" })).toBeVisible();
});
