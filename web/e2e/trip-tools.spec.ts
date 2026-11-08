import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { bookingAwaitingPayment } from "./session";

// Web rezervasyon detayında yolculuk araçları (K-48, K-50, K-51): kalan süre, sürücüyle mesajlaşma, yolculuğu bitirme.
// Gerçek bir rezervasyon açılır; yolculuk durumu, sürücü, tahmini süre ve sohbet BFF yanıtları taklit edilerek kurulur.

test.describe.configure({ timeout: 60_000 });
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

type Json = Record<string, unknown>;
const DRIVER = { first_name: "Mehmet", vehicle: "Mercedes Vito", plate: "07 GA 001" };

/** Rezervasyonu "yolcu araçta" (basladi) gösterir; `finished` true ise bitirme sonrası durum döner. */
async function onTrip(page: Page, code: string, state: { finished: boolean }) {
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as Json & { legs: Json[] };
    const legStatus = state.finished ? "bitti" : "basladi";
    await route.fulfill({
      response: res,
      json: {
        ...body,
        status: state.finished ? "tamamlandi" : "yolculukta",
        legs: body.legs.map((l) => ({ ...l, status: legStatus, driver: DRIVER })),
      },
    });
  });
  await page.route(`**/bff/me/bookings/${code}/eta`, async (route) => {
    const res = await page.request.get(`/bff/me/bookings/${code}`);
    const legId = ((await res.json()) as { legs: { id: string }[] }).legs[0].id;
    await route.fulfill({ json: { leg_id: legId, status: "basladi", eta_minutes: 12, location: null } });
  });
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) => route.fulfill({ json: null }));
}

async function mockChat(page: Page, code: string) {
  const messages: Json[] = [
    { id: "m1", sender: "driver", body: "Girişte bekliyorum.", created_at: new Date().toISOString(), read_at: null },
  ];
  const sent: string[] = [];
  await page.route(`**/bff/me/bookings/${code}/messages/unread`, (route) => route.fulfill({ json: { unread: 2 } }));
  await page.route(`**/bff/me/bookings/${code}/messages`, async (route) => {
    if (route.request().method() === "POST") {
      const { body } = route.request().postDataJSON() as { body: string };
      sent.push(body);
      const msg = { id: `s${sent.length}`, sender: "customer", body, created_at: new Date().toISOString(), read_at: null };
      messages.push(msg);
      return route.fulfill({ status: 201, json: msg });
    }
    await route.fulfill({ json: { open: true, unread: 0, other_name: "Mehmet", messages } });
  });
  return sent;
}

test("aktif yolculukta kalan süre, okunmamış rozeti ve sohbet", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  await onTrip(page, code, { finished: false });
  const sent = await mockChat(page, code);
  await page.goto(`/tr/bookings/${code}`);

  // Geliştirme sunucusunda sayfa ilk açılışta derlenir.
  await expect(page.locator(".eta-line")).toHaveText("Varışa ~12 dk", { timeout: 30_000 });
  const open = page.getByRole("button", { name: /Sürücüye yaz/ });
  await expect(open).toContainText("2");
  await expectNoAxeViolations(page, { include: ".booking-detail" });

  await expect(async () => {
    await open.click();
    await expect(page.getByRole("heading", { name: "Mehmet ile mesajlaşma" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Mehmet ile mesajlaşma" })).toBeFocused();
  await expect(page.getByRole("log")).toContainText("Girişte bekliyorum.");

  await page.getByRole("button", { name: "Kapıdayım" }).click();
  await expect(page.getByRole("log")).toContainText("Kapıdayım");
  await page.getByLabel("Mesaj yazın").fill("Valizler büyük, bagaja sığar mı?");
  await page.getByLabel("Mesaj yazın").press("Enter");
  await expect(page.getByRole("log")).toContainText("Valizler büyük");
  expect(sent).toEqual(["Kapıdayım", "Valizler büyük, bagaja sığar mı?"]);
  await expect(page.getByLabel("Mesaj yazın")).toHaveValue("");
  await expectNoAxeViolations(page, { include: ".chat-panel" });

  await page.getByRole("button", { name: "Kapat" }).click();
  await expect(page.locator(".chat-panel")).toHaveCount(0);
});

test("yolculuğu bitirme: açıklama, vazgeç ve onay", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  const state = { finished: false };
  await onTrip(page, code, state);
  await mockChat(page, code);
  let finishCalls = 0;
  await page.route(`**/bff/me/bookings/${code}/finish`, async (route) => {
    finishCalls += 1;
    state.finished = true;
    const res = await page.request.get(`/bff/me/bookings/${code}`);
    const body = (await res.json()) as Json & { legs: Json[] };
    await route.fulfill({
      json: { ...body, status: "tamamlandi", legs: body.legs.map((l) => ({ ...l, status: "bitti", driver: DRIVER })) },
    });
  });
  await page.goto(`/tr/bookings/${code}`);

  const finish = page.getByRole("button", { name: "Yolculuğu bitir" });
  await expect(async () => {
    await finish.click();
    await expect(page.getByRole("heading", { name: "Yolculuğu bitirmek istiyor musunuz?" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator(".cancel-panel")).toContainText("iade yapılmaz");
  await page.getByRole("button", { name: "Vazgeç" }).click();
  expect(finishCalls).toBe(0);

  await finish.click();
  await page.locator(".cancel-panel").getByRole("button", { name: "Yolculuğu bitir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Yolculuğunuz tamamlandı" })).toBeVisible();
  expect(finishCalls).toBe(1);
  await expect(page.locator(".booking-head .badge")).toHaveText("Tamamlandı");
  await expect(page.getByRole("button", { name: "Mesajları gör" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yolculuğu bitir" })).toHaveCount(0);
});

test("390 px: sohbet yatay taşma yapmaz, yazma alanı alt alta", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const code = await bookingAwaitingPayment(page);
  await onTrip(page, code, { finished: false });
  await mockChat(page, code);
  await page.goto(`/tr/bookings/${code}`);
  const open = page.getByRole("button", { name: /Sürücüye yaz/ });
  await expect(async () => {
    await open.click();
    await expect(page.locator(".chat-panel")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const dir = await page.locator(".chat-compose").evaluate((el) => getComputedStyle(el).flexDirection);
  expect(dir).toBe("column");
});
