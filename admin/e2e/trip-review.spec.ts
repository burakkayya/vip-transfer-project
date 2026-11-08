import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { hasCredentials, SKIP_MESSAGE } from "./session";

// K-55: müşterinin bitirdiği yolculuklar listesi ve gerekçeyle sohbet incelemesi.
// Liste ve sohbet yanıtları taklit edilir; gerçek rezervasyon detayı (ilk kayıt) üzerinde inceleme kartı denenir.

test("müşterinin bitirdiği yolculuklar listesi: erken işareti ve filtre", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  const all = [
    { booking_id: "b1", booking_code: "GAEARLY1", leg_order: 1, route: "Antalya Havalimanı → Kemer",
      pickup_at: "2026-11-08T10:00:00Z", started_at: "2026-11-08T10:05:00Z", finished_at: "2026-11-08T10:12:00Z",
      planned_minutes: 50, actual_minutes: 7, early: true, distance_km: "42.0", driver_name: "Mehmet Demir" },
    { booking_id: "b2", booking_code: "GANORML2", leg_order: 1, route: "Kemer → Antalya Havalimanı",
      pickup_at: "2026-11-07T10:00:00Z", started_at: "2026-11-07T10:05:00Z", finished_at: "2026-11-07T10:50:00Z",
      planned_minutes: 50, actual_minutes: 45, early: false, distance_km: "42.0", driver_name: "Ayşe Kaya" },
  ];
  const queries: string[] = [];
  // "Yalnızca erken" sunucuda süzülür: taklit yanıt `early=true` parametresine göre döner.
  await page.route("**/bff/admin/trips/customer-finished**", (route) => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    const early = url.searchParams.get("early") === "true";
    return route.fulfill({ json: early ? all.filter((r) => r.early) : all });
  });
  await page.goto("/trip-reviews");
  await expect(page.getByRole("heading", { level: 1, name: "Müşterinin bitirdiği yolculuklar" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "GAEARLY1" })).toBeVisible();
  await expect(page.getByRole("row", { name: /GAEARLY1/ })).toContainText("Erken");
  await expect(page.getByRole("row", { name: /GAEARLY1/ })).toContainText("7 / 50 dk");
  await expectNoAxeViolations(page);

  await page.getByLabel("Yalnızca erken bitenler").check();
  await expect.poll(() => queries.some((q) => q.includes("early=true") && q.includes("offset=0"))).toBe(true);
  await expect(page.getByRole("link", { name: "GANORML2" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "GAEARLY1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Müşteri bitirişleri" })).toBeVisible();
});

test("rezervasyon detayında gerekçeyle sohbet incelemesi", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  let reason = "";
  await page.route(/\/bff\/admin\/bookings\/[^/]+$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { booking: { legs: Record<string, unknown>[] } };
    body.booking.legs = body.booking.legs.map((l) => ({ ...l, driver: { first_name: "Mehmet", vehicle: "Vito", plate: "07 GA 001" } }));
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/bff\/admin\/bookings\/[^/]+\/messages$/, async (route) => {
    reason = (route.request().postDataJSON() as { reason: string }).reason;
    await route.fulfill({
      json: {
        retention_days: 30,
        legs: [{ leg_id: "l1", leg_order: 1, status: "bitti", driver_name: "Mehmet Demir", passenger_name: "Anna Schmidt" }],
        messages: [
          { id: "m1", leg_id: "l1", sender: "driver", body: "Girişteyim.", created_at: "2026-11-08T10:00:00Z", read_at: "2026-11-08T10:01:00Z" },
          { id: "m2", leg_id: "l1", sender: "customer", body: "Geliyorum", created_at: "2026-11-08T10:02:00Z", read_at: null },
        ],
      },
    });
  });

  await page.goto("/bookings");
  await page.locator("table a.mono").first().click();
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Müşteri–sürücü mesajları" }) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const show = card.getByRole("button", { name: "Mesajları göster" });
  await expect(show).toBeDisabled();
  await card.getByLabel("Gerekçe (şikâyet / talep referansı)").fill("Şikâyet #42: erken bitirme");
  await show.click();
  await expect(card.getByText("Girişteyim.")).toBeVisible();
  await expect(card.getByText("Sürücü · Mehmet Demir")).toBeVisible();
  await expect(card.getByText("Müşteri · Anna Schmidt")).toBeVisible();
  await expect(card.getByText(/denetim kaydına yazıldı/)).toBeVisible();
  expect(reason).toBe("Şikâyet #42: erken bitirme");
  await expectNoAxeViolations(page);
});
