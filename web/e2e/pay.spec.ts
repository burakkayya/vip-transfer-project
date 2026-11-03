import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { bookingAwaitingPayment, bookingWithPhone, login, loginOnScreen } from "./session";

test.describe.configure({ timeout: 60_000 });

// Ödeme ekranı (B-W4): `/bookings/[code]/pay`, `PaymentPanel`.
// Her test BFF üzerinden yeni bir numarayla giriş yapar (geliştirme kodu) ve ödeme bekleyen bir rezervasyon açar;
// ödeme geliştirme ortamının sahte sağlayıcı sayfasında ("Ödemeyi onayla" / "Reddet") yapılır.

const panel = (page: Page) => page.locator(".pay");
const providerFrame = (page: Page) => page.frameLocator(".iframe-wrap iframe");

type BookingPatch = Record<string, unknown> | { abort: true } | { hang: true } | { status: number; code: string };

/**
 * Rezervasyon GET yanıtını taklit eder: `patch(n)` n'inci çağrıda (1'den başlar) gerçek yanıtın üstüne
 * yazılacak alanları, ağ hatası (`{ abort: true }`), hiç yanıtlanmayan istek (`{ hang: true }`) veya hata yanıtını
 * (`{ status, code }`) döner.
 */
async function mockBooking(page: Page, code: string, patch: (n: number) => BookingPatch) {
  let n = 0;
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    n += 1;
    const p = patch(n);
    if ("abort" in p) return route.abort();
    if ("hang" in p) return;
    if (typeof p.status === "number" && typeof p.code === "string") {
      return route.fulfill({ status: p.status, json: { error: { code: p.code, message: p.code } } });
    }
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), ...p } });
  });
}

/** Ödeme başlatma (POST payments) çağrılarını sayar. */
async function countCheckouts(page: Page, code: string) {
  const calls = { n: 0 };
  await page.route(`**/bff/me/bookings/${code}/payments`, async (route) => {
    calls.n += 1;
    await route.continue();
  });
  return calls;
}

/** Ödeme sayfasını açar ve sahte sağlayıcının düğmeleri görünene kadar bekler. */
async function openPay(page: Page, code: string, locale = "tr") {
  await page.goto(`/${locale}/bookings/${code}/pay`);
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
}

test("pay shows loading state before booking loads", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  // Rezervasyon ve ödeme başlatma istekleri bırakılana kadar bekletilir.
  let releaseBooking!: () => void;
  const bookingHeld = new Promise<void>((r) => (releaseBooking = r));
  let releaseCheckout!: () => void;
  const checkoutHeld = new Promise<void>((r) => (releaseCheckout = r));
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    await bookingHeld;
    await route.continue();
  });
  await page.route(`**/bff/me/bookings/${code}/payments`, async (route) => {
    await checkoutHeld;
    await route.continue();
  });
  await page.goto(`/tr/bookings/${code}/pay`);
  // Oturum denetimi bittikten sonra boş alan değil, rezervasyon yükleniyor durumu görünür.
  await expect(page.getByRole("status").filter({ hasText: "Rezervasyon bilgileri yükleniyor" })).toBeVisible({
    timeout: 30_000,
  });
  releaseBooking();
  // Tutar gelir; ödeme sayfası hazırlanırken ayrı bir yükleniyor durumu görünür.
  await expect(panel(page).locator(".pay-amount")).toBeVisible();
  await expect(panel(page).getByRole("status").filter({ hasText: "Güvenli ödeme sayfası hazırlanıyor" })).toBeVisible();
  releaseCheckout();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
});

test("loading skeleton does not shimmer with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  // Rezervasyon isteği hiç yanıtlanmaz: yükleniyor durumu kalır.
  await page.route("**/bff/me/bookings/GATEST01", () => {});
  await page.goto("/tr/bookings/GATEST01/pay");
  const loading = page.getByRole("status").filter({ hasText: "Rezervasyon bilgileri yükleniyor" });
  await expect(loading).toBeVisible({ timeout: 30_000 });
  const animations = await loading
    .locator(".skeleton")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(animations.length).toBeGreaterThan(0);
  expect(animations.every((name) => name === "none")).toBe(true);
});

test("failed payment shows alert and retry", async ({ page }) => {
  test.setTimeout(90_000);
  const code = await bookingAwaitingPayment(page);
  await openPay(page, code);
  await providerFrame(page).getByRole("button", { name: "Reddet" }).click();
  await page.waitForURL(/result=fail/, { timeout: 30_000 });

  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("Ödeme tamamlanamadı");
  await expect(page.locator(".iframe-wrap iframe")).toHaveCount(0);
  // Tutar ve rezervasyon özeti görünür kalır.
  await expect(panel(page).locator(".pay-amount")).toBeVisible();
  const retry = panel(page).getByRole("button", { name: "Tekrar dene" });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.click();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
  await expect(alert).toHaveCount(0);
});

test("network error shows ErrorState with retry", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  // Tam kesinti: oturum denetimi dahil tüm BFF istekleri ağda düşer. Giriş formu değil, hata ve yeniden dene.
  await page.route("**/bff/**", (route) => route.abort());
  await page.goto(`/tr/bookings/${code}/pay`);
  const error = page.locator(".page").getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  await page.unroute("**/bff/**");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".page").getByRole("alert")).toHaveCount(0);
});

for (const [kind, abort] of [
  ["network error", true],
  ["500", false],
] as const) {
  test(`session check ${kind} shows ErrorState with retry, not the login`, async ({ page }) => {
    const code = await bookingAwaitingPayment(page);
    await page.route("**/bff/auth/me", (route) =>
      abort ? route.abort() : route.fulfill({ status: 500, body: "Internal Server Error" }),
    );
    await page.goto(`/tr/bookings/${code}/pay`);
    const error = page.locator(".page").getByRole("alert");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
    await expect(page.locator("#otp-phone")).toHaveCount(0);
    await expect(page.locator(".login-card")).toHaveCount(0);
    await page.unroute("**/bff/auth/me");
    await error.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
    // Odak sayfanın başına düşmez: yeniden denemeden sonra bölge başlığına gider.
    await expect(page.getByRole("heading", { level: 1, name: "Ödeme" })).toBeFocused();
  });
}

test("first load timeout shows ErrorState with retry", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  let hang = true;
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    if (hang) return; // yanıt hiç gelmez
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}/pay`);
  await expect(page.getByRole("status").filter({ hasText: "Rezervasyon bilgileri yükleniyor" })).toBeVisible({
    timeout: 30_000,
  });
  await page.clock.runFor(16_000);
  const error = panel(page).getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı");
  hang = false;
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
});

test("checkout start failure keeps amount and offers retry", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  await page.route(`**/bff/me/bookings/${code}/payments`, (route) => route.abort());
  await page.goto(`/tr/bookings/${code}/pay`);
  const error = panel(page).getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  // Ödeme başlatılamasa da ödenecek tutar ve rezervasyon görünür kalır.
  await expect(panel(page).locator(".pay-amount")).toBeVisible();
  await page.unroute(`**/bff/me/bookings/${code}/payments`);
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
});

test("waiting state is announced and retry is not offered while the payment page is open", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  await openPay(page, code);
  await expect(panel(page).getByRole("status")).toContainText("Ödemeniz bekleniyor");
  // Açık ödeme sayfasını sıfırlayıp yeni ödeme başlatan düğme yok.
  await expect(panel(page).getByRole("button", { name: "Tekrar dene" })).toHaveCount(0);
});

test("pay summary shows booking code, route and amount as returned by the API", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  const booking = page.waitForResponse((r) => r.url().endsWith(`/bff/me/bookings/${code}`) && r.ok());
  await page.goto(`/tr/bookings/${code}/pay`);
  const data = await (await booking).json();
  const summary = panel(page).locator(".pay-summary");
  await expect(summary).toContainText(code);
  await expect(summary).toContainText("Antalya Havalimanı (AYT)");
  await expect(summary).toContainText("Kemer");
  // Tutar API'nin döndürdüğü değerdir (yalnızca biçimlenir), tek satır ve tabular rakam.
  const amount = summary.locator(".pay-amount");
  const expected = new Intl.NumberFormat("tr", { style: "currency", currency: data.currency, maximumFractionDigits: 2 })
    .format(Number(data.total_amount));
  await expect(amount).toHaveText(expected);
  expect(await amount.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  expect(await amount.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
  // Süre kuralı ve güvenlik notu ayrı satırlardadır.
  await expect(summary.locator(".pay-expiry")).toHaveText("Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir.");
});

test("cancelled booking explains why no payment is taken and offers a new booking", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, status: "iptal", cancelled_at: new Date().toISOString() } });
  });
  await page.goto(`/tr/bookings/${code}/pay`);
  await expect(panel(page)).toContainText("Bu rezervasyon iptal edildi", { timeout: 30_000 });
  await expect(panel(page).getByRole("link", { name: "Yeni rezervasyon" })).toHaveAttribute("href", "/tr/book");
  await expect(panel(page).getByRole("link", { name: "Rezervasyonu görüntüle" })).toHaveAttribute(
    "href",
    `/tr/bookings/${code}`,
  );
  await expect(page.locator(".iframe-wrap")).toHaveCount(0);
});

test("pay page has no axe violations", async ({ page }) => {
  test.setTimeout(90_000);
  const code = await bookingAwaitingPayment(page);
  await openPay(page, code);
  await expectNoAxeViolations(page, { exclude: [".iframe-wrap"] });
  await providerFrame(page).getByRole("button", { name: "Reddet" }).click();
  await page.waitForURL(/result=fail/, { timeout: 30_000 });
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await expectNoAxeViolations(page, { exclude: [".iframe-wrap"] });
});

test("de pay has no horizontal overflow from 360 to 1440 px", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
  test.setTimeout(90_000);
  const code = await bookingAwaitingPayment(page, "de");
  await openPay(page, code, "de");
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".pay .btn, .pay .pay-amount, .pay dd, .pay dt, .pay .hint"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, `${width}px`).toEqual([]);
    // TRY tutarı tek satırda kalır.
    const amount = panel(page).locator(".pay-amount");
    const { height, lineHeight } = await amount.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(height, `${width}px`).toBeLessThan(lineHeight * 1.5);
  }
});

// --- Düzeltme turu 1: onay bekleme, başlatma kilidi, yoklama hataları ---

test("returning with result=ok shows confirming state and offers recovery after the bounded wait", async ({ page }) => {
  test.setTimeout(120_000);
  const code = await bookingAwaitingPayment(page);
  const checkouts = await countCheckouts(page, code);
  await page.clock.install();
  // Sağlayıcıdan "ok" ile dönüldü ama bildirim henüz işlenmedi: rezervasyon hâlâ ödeme bekliyor.
  await page.goto(`/tr/bookings/${code}/pay?result=ok`);
  const confirming = panel(page).getByRole("status").filter({ hasText: "Ödemeniz onaylanıyor" });
  await expect(confirming).toBeVisible({ timeout: 30_000 });
  await expect(panel(page).getByText("Güvenli ödeme sayfası hazırlanıyor")).toHaveCount(0);
  await expect(page.locator(".iframe-wrap")).toHaveCount(0);
  expect(checkouts.n).toBe(0);

  // Sınırlı bekleme (75 sn) dolunca açık mesaj ve iki eylem.
  await page.clock.runFor(76_000);
  const slow = panel(page).locator(".pay-confirm-slow");
  await expect(slow).toContainText("Ödeme onayı henüz bize ulaşmadı");
  const refresh = slow.getByRole("button", { name: "Durumu yenile" });
  await expect(refresh).toBeVisible();
  await expect(slow.getByRole("button", { name: "Ödemeye dön" })).toBeVisible();

  // Durumu yenile: yeniden yoklar ve bekleme baştan başlar.
  await refresh.click();
  await expect(confirming).toBeVisible();
  await expect(slow).toHaveCount(0);

  // Ödemeye dön: adresten `result` kalkar, yeni ödeme sayfası açılır.
  await page.clock.runFor(76_000);
  await slow.getByRole("button", { name: "Ödemeye dön" }).click();
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.has("result")).toBe(false);
  expect(checkouts.n).toBe(1);
});

test("poll turning paid shows success and redirects to the booking", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  // İlk iki okuma ödeme bekliyor, sonra bildirim işlenmiş gibi onaylandı.
  await mockBooking(page, code, (n) => (n <= 2 ? {} : { status: "onaylandi" }));
  await page.goto(`/tr/bookings/${code}/pay?result=ok`);
  await expect(panel(page).getByRole("status").filter({ hasText: "Ödemeniz onaylanıyor" })).toBeVisible({
    timeout: 30_000,
  });
  // İstemci tarafı geçiş ("load" olayı yok): adres beklenir.
  await expect(page).toHaveURL((url) => url.pathname === `/tr/bookings/${code}` && url.searchParams.get("paid") === "1", {
    timeout: 30_000,
  });
});

test("poll turning cancelled shows the cancelled explanation", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  await mockBooking(page, code, (n) => (n <= 1 ? {} : { status: "iptal" }));
  await openPay(page, code);
  await expect(panel(page)).toContainText("Bu rezervasyon iptal edildi", { timeout: 30_000 });
  await expect(page.locator(".iframe-wrap")).toHaveCount(0);
});

test("retry double click starts only one payment", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  const checkouts = await countCheckouts(page, code);
  await page.goto(`/tr/bookings/${code}/pay?result=fail`);
  const retry = panel(page).getByRole("button", { name: "Tekrar dene" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  // İki tıklama React yeniden çizmeden aynı anda gelir.
  await retry.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
  expect(checkouts.n).toBe(1);
  // Yeniden deneme adresteki eski sonucu da temizler.
  expect(new URL(page.url()).searchParams.has("result")).toBe(false);
});

test("poll 401 before the payment page opens sends the user to login", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  // Ödeme sayfası açılmaz (başlatma isteği yanıtlanmaz); yoklama 401 alınca giriş istenir.
  await page.route(`**/bff/me/bookings/${code}/payments`, () => {});
  await mockBooking(page, code, (n) => (n <= 1 ? {} : { status: 401, code: "unauthorized" }));
  await page.goto(`/tr/bookings/${code}/pay`);
  await expect(page.locator("#otp-phone")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".login-card")).toContainText("Oturumunuz sona erdi");
  await expect(page.locator(".pay")).toHaveCount(0);
});

test("poll 401 while the payment page is open keeps it, and after login the same booking is polled again", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { code, phone } = await bookingWithPhone(page);
  const checkouts = await countCheckouts(page, code);
  let mode: "ok" | "401" | "paid" = "ok";
  let gets = 0;
  await mockBooking(page, code, () => {
    gets += 1;
    return mode === "401" ? { status: 401, code: "unauthorized" } : mode === "paid" ? { status: "onaylandi" } : {};
  });
  await openPay(page, code);
  mode = "401";
  // Engellemeyen bildirim: ödeme sayfası (iFrame) yerinde kalır, giriş formu açılmaz, yeni ödeme başlamaz.
  const notice = panel(page).locator(".pay-session");
  await expect(notice).toContainText("Oturumunuz sona erdi", { timeout: 30_000 });
  await expect(providerFrame(page).locator("button.ok")).toBeVisible();
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  // Yoklama durur.
  const before = gets;
  await page.waitForTimeout(7_000);
  expect(gets).toBe(before);
  expect(checkouts.n).toBe(1);

  // Giriş kullanıcının eylemiyle açılır.
  await notice.getByRole("button", { name: "Yeniden giriş yap" }).click();
  await expect(page.locator("#otp-phone")).toBeVisible();
  mode = "ok";
  await loginOnScreen(page, phone);
  // Aynı rezervasyon yeniden yoklanır; otomatik yeni ödeme başlatılmaz.
  await expect(panel(page).locator(".pay-resumed")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".iframe-wrap")).toHaveCount(0);
  expect(checkouts.n).toBe(1);
  mode = "paid";
  await expect(page).toHaveURL((url) => url.pathname === `/tr/bookings/${code}` && url.searchParams.get("paid") === "1", {
    timeout: 30_000,
  });
  expect(checkouts.n).toBe(1);
});

test("a hung poll request is cancelled and counts toward pausing updates", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  let hang = false;
  let hung = 0;
  await mockBooking(page, code, () => {
    if (!hang) return {};
    hung += 1;
    return { hang: true };
  });
  await page.clock.install();
  await openPay(page, code);
  hang = true;
  await page.clock.runFor(15_000);
  const paused = panel(page).locator(".pay-paused");
  await expect(paused).toContainText("Otomatik güncelleme durdu");
  // Yoklamalar üst üste binmez: asılı istek iptal edilmeden yenisi gönderilmez (3 başarısız deneme, sonra durur).
  expect(hung).toBeLessThanOrEqual(3);
  await expect(providerFrame(page).locator("button.ok")).toBeVisible();
  hang = false;
  await paused.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(paused).toHaveCount(0);
});

test("repeated poll network errors pause updates with a refresh action", async ({ page }) => {
  const code = await bookingAwaitingPayment(page);
  let down = false;
  await mockBooking(page, code, () => (down ? { abort: true } : {}));
  await page.clock.install();
  await openPay(page, code);
  down = true;
  await page.clock.runFor(10_000);
  const paused = panel(page).locator(".pay-paused");
  await expect(paused).toContainText("Otomatik güncelleme durdu");
  // Bildirim engellemez: ödeme sayfası açık kalır.
  await expect(providerFrame(page).locator("button.ok")).toBeVisible();
  down = false;
  await paused.getByRole("button", { name: "Durumu yenile" }).click();
  await expect(paused).toHaveCount(0);
});

for (const [status, code] of [
  [404, "not_found"],
  [403, "forbidden"],
] as const) {
  test(`${status} booking shows final error with a link instead of retry`, async ({ page }) => {
    const booking = await bookingAwaitingPayment(page);
    await mockBooking(page, booking, () => ({ status, code }));
    await page.goto(`/tr/bookings/${booking}/pay`);
    await expect(panel(page).getByRole("alert")).toBeVisible({ timeout: 30_000 });
    // Detaydaki gibi ayrılmış "bulunamadı" görünümü; sayfada tek h1 kalır.
    await expect(panel(page).locator(".booking-not-found")).toContainText("Bu koda ait rezervasyon bulunamadı.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(panel(page).getByRole("button", { name: "Tekrar dene" })).toHaveCount(0);
    await expect(panel(page).getByRole("link", { name: "Rezervasyonlarım" })).toHaveAttribute("href", "/tr/bookings");
  });
}

test("large TRY amount fits on one line at 360px", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
  const code = await bookingAwaitingPayment(page);
  await mockBooking(page, code, () => ({ total_amount: "12345.00", currency: "TRY" }));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/tr/bookings/${code}/pay`);
  const amount = panel(page).locator(".pay-amount");
  await expect(amount).toHaveText("₺12.345,00", { timeout: 30_000 });
  const { height, lineHeight, right } = await amount.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    right: el.getBoundingClientRect().right,
  }));
  expect(height).toBeLessThan(lineHeight * 1.5);
  expect(right).toBeLessThanOrEqual(360);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

// --- Tur 2: kayıt oluşturan isteklerde uzun zaman aşımı ve belirsiz sonuç ---

for (const paid of [false, true]) {
  test(`payment start timeout re-checks the booking ${paid ? "and continues when it is paid" : "before offering retry"}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const code = await bookingAwaitingPayment(page);
    const checkouts = { n: 0 };
    let asked!: () => void;
    const startAsked = new Promise<void>((r) => (asked = r));
    let hang = true;
    await page.route(`**/bff/me/bookings/${code}/payments`, async (route) => {
      checkouts.n += 1;
      if (hang) return asked(); // yanıt hiç gelmez (backend sağlayıcıyı bekliyor gibi)
      await route.continue();
    });
    await mockBooking(page, code, () => (paid && !hang ? { status: "onaylandi" } : {}));
    await page.clock.install();
    await page.goto(`/tr/bookings/${code}/pay`);
    await startAsked;
    // Varsayılan 15 sn'de vazgeçilmez: sağlayıcı çağrısı 20 sn sürebilir.
    await page.clock.runFor(20_000);
    await expect(panel(page).getByRole("status").filter({ hasText: "Güvenli ödeme sayfası hazırlanıyor" })).toBeVisible();
    if (paid) hang = false; // bu arada ödeme alınmış: yeniden okuma "onaylandı" döner
    await page.clock.runFor(26_000);
    if (paid) {
      await expect(page).toHaveURL(
        (url) => url.pathname === `/tr/bookings/${code}` && url.searchParams.get("paid") === "1",
        { timeout: 30_000 },
      );
      expect(checkouts.n).toBe(1);
      return;
    }
    const error = panel(page).getByRole("alert");
    await expect(error).toContainText("Ödeme sayfası zamanında açılamadı");
    expect(checkouts.n).toBe(1);
    hang = false;
    await error.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(providerFrame(page).locator("button.ok")).toBeVisible({ timeout: 30_000 });
    expect(checkouts.n).toBe(2);
  });
}
