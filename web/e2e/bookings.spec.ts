import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { bookingAwaitingPayment as createBooking, login, warmUp } from "./session";

// Rezervasyonlarım (B-W8): `/bookings`, `BookingsHome`. Kodla sorgulama alanı, liste, boş ve hata durumları.
// Oturum denetimi, liste ağ hatası ve 401 testleri `booking-detail.spec.ts` sonundadır (B-W6/B-W7).

test.describe.configure({ timeout: 60_000 });
// Soğuk derleme ilk testi zaman aşımına düşürmesin.
test.beforeAll(async ({ browser }, info) => warmUp(browser, info, ["/tr/bookings", "/de/bookings"]));
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const codeInput = (page: Page) => page.locator("#code");
const codeError = (page: Page) => page.locator("#code-error");

// Kod alanı ve liste istemcide, oturum denetiminden sonra çizilir: göründüklerinde sayfa hidrate olmuştur.
// Bu yüzden tıklamalar `toPass` döngüsüne alınmaz (döngü yarış durumunu gizler).

/** Liste GET'ini durağan yanıtla taklit eder (geliştirme sunucusundaki gerçek isteği beklemez). */
async function staticList(page: Page, reply: { json: unknown } | { status: number; code: string }) {
  await page.route("**/bff/me/bookings", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return "json" in reply
      ? route.fulfill({ json: reply.json })
      : route.fulfill({ status: reply.status, json: { error: { code: reply.code, message: reply.code } } });
  });
}

/** Gerçek liste yanıtını değiştirerek taklit eder (yalnızca gerçek rezervasyon gereken testte). */
async function mockList(page: Page, reply: (body: Record<string, unknown>[]) => unknown) {
  await page.route("**/bff/me/bookings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = res.ok() ? ((await res.json()) as Record<string, unknown>[]) : [];
    const r = reply(body);
    if (r && typeof r === "object" && "status" in (r as object) && !Array.isArray(r)) {
      const { status, code } = r as { status: number; code: string };
      return route.fulfill({ status, json: { error: { code, message: code } } });
    }
    await route.fulfill({ response: res, json: r });
  });
}

test("lookup code validates format (signed out)", async ({ page }) => {
  await page.goto("/tr/bookings");
  const input = codeInput(page);
  await expect(input).toBeVisible({ timeout: 30_000 });
  // Biçim ipucu her zaman görünür ve alana bağlıdır (yalnızca yer tutucu değil).
  const hint = page.locator("#code-hint");
  await expect(hint).toHaveText("GA ile başlayan 8 karakter; onay SMS'inizde yazar. İsterseniz boş bırakın.");
  await expect(input).toHaveAttribute("aria-describedby", /code-hint/);
  // Yanlış biçim, odak başka bir alana (ülke seçimi) geçince söylenir.
  await input.fill("ab12");
  await input.press("Tab");
  await expect(codeError(page)).toBeVisible();
  await expect(input).toHaveValue("AB12");
  await expect(codeError(page)).toHaveText("Rezervasyon kodu GA ile başlar ve 8 karakterdir (ör. GA7K3P9Q).");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", /code-error/);
  // Düzeltince hata kalkar.
  await input.fill("GA7K3P9Q");
  await expect(codeError(page)).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  // Boş alan hata değildir (kod isteğe bağlı: giriş sonrası liste açılır).
  await input.fill("");
  await input.press("Tab");
  await expect(codeError(page)).toHaveCount(0);
  // Boş bir yere tıklamak (odak hiçbir alana geçmez) hata göstermez: düğmeye dokunuş kaymasın.
  await input.fill("ab12");
  await page.locator("h1").click();
  await expect(codeError(page)).toHaveCount(0);
});

test("lookup code validates format", async ({ page }) => {
  await login(page);
  await page.goto("/tr/bookings");
  const input = codeInput(page);
  const find = page.locator(".lookup-form").getByRole("button", { name: "Bul" });
  await expect(find).toBeVisible({ timeout: 30_000 });
  // Devre dışı düğme yerine alan hatası (OTP ile aynı desen, B-W3).
  await expect(find).toBeEnabled();
  // Alandan düğmeye geçmek hata göstermez (düzen kaymaz); gönderim gösterir.
  await input.fill("GA12");
  await input.press("Tab");
  await expect(find).toBeFocused();
  await expect(codeError(page)).toHaveCount(0);
  await find.click();
  await expect(codeError(page)).toBeVisible();
  await expect(codeError(page)).toHaveText("Rezervasyon kodu GA ile başlar ve 8 karakterdir (ör. GA7K3P9Q).");
  await expect(codeError(page)).toHaveAttribute("role", "alert");
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/tr\/bookings$/);
  // Küçük harf büyütülür, boşluk ve tire atılır; doğru biçimde detaya gider.
  await input.fill("ga-zz 0000");
  await expect(input).toHaveValue("GAZZ0000");
  await expect(codeError(page)).toHaveCount(0);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/tr\/bookings\/GAZZ0000$/, { timeout: 30_000 });
});

test("lookup with an empty code asks for the code", async ({ page }) => {
  await login(page);
  await staticList(page, { json: [] });
  await page.goto("/tr/bookings");
  const find = page.locator(".lookup-form").getByRole("button", { name: "Bul" });
  await expect(find).toBeVisible({ timeout: 30_000 });
  await find.click();
  await expect(codeError(page)).toHaveText("Rezervasyon kodunu girin.");
  await expect(codeInput(page)).toBeFocused();
  await expect(codeInput(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/tr\/bookings$/);
  // Yazmaya başlayınca kalkar.
  await codeInput(page).fill("G");
  await expect(codeError(page)).toHaveCount(0);
});

test("empty list EmptyState", async ({ page }) => {
  await login(page);
  await staticList(page, { json: [] });
  await page.goto("/tr/bookings");
  const empty = page.locator(".state-empty");
  await expect(empty.getByRole("heading", { level: 2, name: "Henüz rezervasyonunuz yok." })).toBeVisible({
    timeout: 30_000,
  });
  await expect(empty).toContainText("Transferinizi birkaç dakikada planlayın; fiyatı rezervasyondan önce görürsünüz.");
  await expect(empty.getByRole("link", { name: "Yeni rezervasyon" })).toHaveAttribute("href", "/tr/book");
  await expect(page.locator(".booking-list")).toHaveCount(0);
});

test("bookings empty state has no axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await staticList(page, { json: [] });
  await page.goto("/tr/bookings");
  await expect(page.locator(".state-empty")).toBeVisible({ timeout: 30_000 });
  await expectNoAxeViolations(page, { include: "main" });
});

test("bookings error state", async ({ page }) => {
  await login(page);
  await staticList(page, { status: 500, code: "internal" });
  await page.goto("/tr/bookings");
  const error = page.locator(".page").getByRole("alert");
  await expect(error).toContainText("Bir hata oluştu", { timeout: 30_000 });
  await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  await expect(page.locator(".state-empty")).toHaveCount(0);
  // Sorgulama formu hata durumunda da kullanılabilir.
  await expect(codeInput(page)).toBeEditable();
});

test("bookings has no axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  // Oturumsuz: sorgulama ve giriş, alan hatası açıkken.
  await page.goto("/tr/bookings");
  const input = codeInput(page);
  await input.fill("AB12");
  await input.press("Tab");
  await expect(codeError(page)).toBeVisible();
  await expectNoAxeViolations(page, { include: "main" });
  // Oturumlu: liste.
  await createBooking(page);
  await page.goto("/tr/bookings");
  await expect(page.locator(".booking-list li").first()).toBeVisible({ timeout: 30_000 });
  await expectNoAxeViolations(page, { include: "main" });
});

test("bookings list is a list with a heading", async ({ page }) => {
  const code = await createBooking(page);
  await page.goto("/tr/bookings");
  const list = page.getByRole("list", { name: "Rezervasyonlarınız" });
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list.getByRole("listitem").filter({ hasText: code })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Rezervasyonlarınız" })).toBeVisible();
});

test("bookings list fits 360px in German with a large TRY amount", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlikler testte ayarlanır");
  const code = await createBooking(page, "de");
  await mockList(page, (body) =>
    body.map((b) => (b.booking_code === code ? { ...b, total_amount: "12345.00", status: "odeme_basarisiz" } : b)),
  );
  await page.goto("/de/bookings");
  const row = page.locator(".booking-row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Uzun Almanca alan hatası da açıkken.
  await page.locator("#code").fill("GA12");
  await page.locator(".lookup-form").getByRole("button", { name: "Suchen" }).click();
  await expect(codeError(page)).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".page .btn, .page h1, .page h2, .booking-row *, .field-error, .hint"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, `${width}px`).toEqual([]);
    const price = row.locator(".price");
    await expect(price).toHaveText(
      new Intl.NumberFormat("de", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(12345),
    );
    const m = await price.evaluate((n) => ({
      height: n.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(n).lineHeight),
      numeric: getComputedStyle(n).fontVariantNumeric,
    }));
    expect(m.height, `${width}px`).toBeLessThan(m.lineHeight * 1.5);
    expect(m.numeric).toContain("tabular-nums");
  }
});
