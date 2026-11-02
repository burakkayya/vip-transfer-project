import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";

// Ödeme sonucu geçiş ekranı (B-W5): `/booking/payment-result`, `PaymentResult`.
// Sağlayıcı iFrame'i bu adrese döner; sayfa iFrame'den çıkar ve `/bookings/[code]/pay?result=ok|fail` adresine geçer
// (bekleyen rezervasyon kodu `sessionStorage.ga_pending_booking`'den). Kodu yoksa `/bookings` açılır.

const PENDING_KEY = "ga_pending_booking";
/** `PaymentResult` içindeki gecikme eşiğiyle aynı: bu süreden sonra yönlendirme gecikti notu çıkar. */
const STALL_MS = 8000;

/** Yönlendirme hedefini (`/<dil>/bookings`) tutar: ekran bekleme durumunda kalır, test onu inceleyebilir. */
async function holdBookingsRedirect(page: Page, locale = "tr") {
  await page.route(new RegExp(`/${locale}/bookings(\\?|$)`), () => {});
}

/** Gecikme notunu çıkarır: sanal saati ileri sarar; zamanlayıcı hidrasyondan sonra kurulduğu için yeniden denenir. */
async function showStalledNote(page: Page, scope: Page | FrameLocator = page) {
  await expect(async () => {
    await page.clock.fastForward(STALL_MS);
    await expect(scope.locator(".result-stalled")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test("payment-result shows a status message while redirecting", async ({ page }) => {
  await holdBookingsRedirect(page);
  await page.goto("/tr/booking/payment-result?status=ok");
  const status = page.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Ödeme sonucu alınıyor…");
  await expect(page.getByRole("heading", { level: 1, name: "Ödeme" })).toBeVisible();
});

test("payment-result status message is translated (tr, en, de, ru)", async ({ page }) => {
  const expected: Record<string, string> = {
    tr: "Ödeme sonucu alınıyor…",
    en: "Getting your payment result…",
    de: "Zahlungsergebnis wird abgerufen…",
    ru: "Получаем результат оплаты…",
  };
  for (const [locale, text] of Object.entries(expected)) {
    await holdBookingsRedirect(page, locale);
    await page.goto(`/${locale}/booking/payment-result?status=ok`);
    await expect(page.getByRole("status")).toContainText(text);
  }
});

test("without pending booking it redirects to bookings", async ({ page }) => {
  await page.goto("/tr/booking/payment-result?status=fail");
  await expect(page).toHaveURL(/\/tr\/bookings$/, { timeout: 30_000 });
});

for (const status of ["ok", "fail"] as const) {
  test(`with pending booking ${status} redirects to pay with result=${status}`, async ({ page }) => {
    await page.addInitScript(
      ([key]) => sessionStorage.setItem(key, "GA123456"),
      [PENDING_KEY],
    );
    await page.goto(`/tr/booking/payment-result?status=${status}`);
    await expect(page).toHaveURL(new RegExp(`/tr/bookings/GA123456/pay\\?result=${status}$`), { timeout: 30_000 });
  });
}

test("unknown status counts as fail", async ({ page }) => {
  await page.addInitScript(([key]) => sessionStorage.setItem(key, "GA123456"), [PENDING_KEY]);
  await page.goto("/tr/booking/payment-result?status=whatever");
  await expect(page).toHaveURL(/\/tr\/bookings\/GA123456\/pay\?result=fail$/, { timeout: 30_000 });
});

test("inside the provider iframe it breaks out to the top window", async ({ page }) => {
  await page.goto("/tr/legal/cookies");
  await page.evaluate(
    ([key]) => {
      sessionStorage.setItem(key, "GA123456");
      const frame = document.createElement("iframe");
      frame.src = "/tr/booking/payment-result?status=ok";
      document.body.appendChild(frame);
    },
    [PENDING_KEY],
  );
  // Sayfa kendi iFrame'inde yönlenseydi üst pencere çerez sayfasında kalırdı.
  await expect(page).toHaveURL(/\/tr\/bookings\/GA123456\/pay\?result=ok$/, { timeout: 30_000 });
});

test("inside the iframe the status message is visible and announced", async ({ page }) => {
  // Üst pencereye geçiş engelli (sandbox, allow-top-navigation yok): ekran iFrame içinde bekler.
  await page.clock.install();
  await page.goto("/tr/legal/cookies");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.src = "/tr/booking/payment-result?status=ok";
    document.body.appendChild(frame);
  });
  const frame = page.frameLocator("iframe");
  const status = frame.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Ödeme sonucu alınıyor…");
  // Geçiş engellenince sonsuz bekleme yerine çıkış yolu sunulur.
  await showStalledNote(page, frame);
  await expect(frame.locator(".result-stalled a")).toHaveAttribute("href", /\/tr\/bookings$/);
});

test("a slow redirect shows a note with a link to bookings", async ({ page }) => {
  await page.clock.install();
  await holdBookingsRedirect(page);
  await page.goto("/tr/booking/payment-result?status=ok");
  await expect(page.locator(".result-stalled")).toHaveCount(0);
  await showStalledNote(page);
  const note = page.locator(".result-stalled");
  await expect(note).toContainText("Yönlendirme beklenenden uzun sürüyor");
  await expect(note.getByRole("link", { name: "Rezervasyonlarım" })).toHaveAttribute("href", /\/tr\/bookings$/);
});

test("a broken session storage still redirects to bookings", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage blocked");
    };
  });
  await page.goto("/tr/booking/payment-result?status=ok");
  await expect(page).toHaveURL(/\/tr\/bookings$/, { timeout: 30_000 });
});

test("axe: waiting state and slow note have no violations", async ({ page }) => {
  await page.clock.install();
  await holdBookingsRedirect(page);
  await page.goto("/tr/booking/payment-result?status=ok");
  await expect(page.getByRole("status")).toBeVisible();
  await expectNoAxeViolations(page);
  await showStalledNote(page);
  await expectNoAxeViolations(page);
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`de payment-result at ${width}px has no horizontal overflow`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    await holdBookingsRedirect(page, "de");
    await page.goto("/de/booking/payment-result?status=ok");
    await expect(page.getByRole("status")).toContainText("Zahlungsergebnis wird abgerufen…");
    const check = async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".state-label, .result-stalled, .page-title"))
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent?.trim().slice(0, 40)),
      );
      expect(clipped).toEqual([]);
    };
    await check();
    await showStalledNote(page);
    await check();
  });
}
