import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { bookingAwaitingPayment as createBooking, login } from "./session";

test.describe.configure({ timeout: 60_000 });
// Test biterken yanıtı beklenen taklit istekleri (geliştirme modunda çift GET) hata saymaz.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Rezervasyon detayı ve iptal (B-W6): `/bookings/[code]`, `BookingDetail`.
// Her test BFF üzerinden yeni bir numarayla giriş yapar (geliştirme kodu) ve ödeme bekleyen gerçek bir rezervasyon açar.
// Ödenmiş, canlı takipte veya bulunamayan durumlar rezervasyon GET yanıtı taklit edilerek kurulur;
// iade önizlemesi (tutar ve oran) API yanıtından gelir, istemci hesaplamaz.

type Json = Record<string, unknown>;
type BookingPatch = Json | { abort: true } | { status: number; code: string };

/**
 * Rezervasyon GET yanıtını taklit eder: `patch(body, n)` n'inci çağrıda gerçek yanıtın üstüne yazılacak alanları,
 * ağ hatasını (`{ abort: true }`) veya hata yanıtını (`{ status, code }`) döner.
 */
async function mockBooking(page: Page, code: string, patch: (body: Json, n: number) => BookingPatch) {
  let n = 0;
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    n += 1;
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    const p = patch(body, n);
    if ("abort" in p) return route.abort();
    if (typeof p.status === "number" && typeof p.code === "string" && Object.keys(p).length === 2) {
      return route.fulfill({ status: p.status, json: { error: { code: p.code, message: p.code } } });
    }
    await route.fulfill({ response: res, json: { ...body, ...p } });
  });
}

/** Ödenmiş (onaylandı) rezervasyon. */
const paid = (page: Page, code: string) => mockBooking(page, code, () => ({ status: "onaylandi" }));

/** İade önizlemesi: oran ve tutar API'den (taklit) gelir. */
async function mockRefund(page: Page, code: string, refund: { refund_percent: number; refund_amount: string }) {
  await page.route(`**/bff/me/bookings/${code}/cancellation`, (route) =>
    route.fulfill({
      json: { hours_left: "120.00", guarantee_applied: false, currency: "TRY", ...refund },
    }),
  );
}

const detail = (page: Page) => page.locator(".booking-detail");
const cancelPanel = (page: Page) => page.locator(".cancel-panel");
const openCancel = (page: Page) => detail(page).getByRole("button", { name: "Rezervasyonu iptal et" });

/** Hidrasyon tamamlanana kadar tıklamayı yineler (uyku yok). */
async function clickUntil(button: Locator, visible: Locator) {
  await expect(async () => {
    await button.click();
    await expect(visible).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

const fmtTry = (amount: string) =>
  new Intl.NumberFormat("tr", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(amount));

/** İki rengin WCAG kontrast oranı (`rgb(...)` / `rgba(...)`). */
function contrast(a: string, b: string) {
  const lum = (c: string) => {
    const [r, g, bl] = c.match(/[\d.]+/g)!.slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- Kırmızı testler (görev) ---

test("detail shows LoadingState then content", async ({ page }) => {
  const code = await createBooking(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/tr/bookings/${code}`);
  const loading = page.getByRole("status").filter({ hasText: "Rezervasyon bilgileri yükleniyor" });
  await expect(loading).toBeVisible({ timeout: 30_000 });
  release();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("cancel preview states K-14 refund for >48h", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 100, refund_amount: "4190.00" });
  await page.goto(`/tr/bookings/${code}`);
  await clickUntil(openCancel(page), cancelPanel(page));

  const panel = cancelPanel(page);
  // Oran ve tutar API'nin döndürdüğüdür; Türkçe yüzde biçimi "%100".
  await expect(panel).toContainText("%100");
  await expect(panel.locator(".cancel-refund")).toHaveText(fmtTry("4190.00"));
  // K-14 kademeleri birebir.
  await expect(panel).toContainText(
    "alış saatinden 48 saat veya daha önce iptalde %100, 24-48 saat kala %50 iade yapılır; 24 saatten az kala iade yapılmaz.",
  );
  await expect(panel.getByRole("link", { name: "İptal ve iade politikası" })).toHaveAttribute(
    "href",
    "/tr/legal/cancellation",
  );

  const confirm = panel.getByRole("button", { name: "İptali onayla" });
  const keep = panel.getByRole("button", { name: "Vazgeç" });
  await expect(confirm).toHaveClass(/\bbtn\b/);
  await expect(confirm).toHaveClass(/\bdanger\b/);
  await expect(keep).toHaveClass(/\bbtn\b/);
  await expect(keep).not.toHaveClass(/\b(ghost|link)\b/);
  // "Vazgeç" eşit görünürlükte: aynı yükseklik, yazı boyutu ve ağırlığı; sınırı kart zemininde en az 3:1.
  const box = async (l: Locator) =>
    l.evaluate((el) => {
      const s = getComputedStyle(el);
      const card = getComputedStyle(el.closest(".card")!);
      return {
        height: el.getBoundingClientRect().height,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        border: s.borderTopColor,
        borderWidth: parseFloat(s.borderTopWidth),
        bg: s.backgroundColor,
        color: s.color,
        cardBg: card.backgroundColor,
      };
    });
  const c = await box(confirm);
  const k = await box(keep);
  expect(Math.abs(c.height - k.height)).toBeLessThanOrEqual(1);
  expect(k.fontSize).toBe(c.fontSize);
  expect(k.fontWeight).toBe(c.fontWeight);
  expect(k.borderWidth).toBeGreaterThanOrEqual(1);
  expect(contrast(k.border, k.cardBg)).toBeGreaterThanOrEqual(3);
  expect(contrast(k.color, k.bg)).toBeGreaterThanOrEqual(4.5);
});

test("cancel confirm is reachable by keyboard and announces result", async ({ page }) => {
  const code = await createBooking(page);
  // Ödeme dönüşü sözleşmesi (B-W4): `?paid=1`. İptal sonrası "onaylandı" bildirimi kalmamalı.
  await paid(page, code);
  await page.goto(`/tr/bookings/${code}?paid=1`);
  await expect(detail(page).getByText("Rezervasyonunuz onaylandı")).toBeVisible({ timeout: 30_000 });

  const open = openCancel(page);
  const heading = cancelPanel(page).getByRole("heading", { name: "Rezervasyonu iptal et" });
  await expect(async () => {
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(heading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // Panel açılınca odak başlığa taşınır; Tab sırası: politika bağlantısı, onay düğmesi.
  await expect(heading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelPanel(page).getByRole("link", { name: "İptal ve iade politikası" })).toBeFocused();
  await page.keyboard.press("Tab");
  const confirm = cancelPanel(page).getByRole("button", { name: "İptali onayla" });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");

  const status = detail(page).getByRole("status").filter({ hasText: "Rezervasyon iptal edildi" });
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).toBeFocused();
  await expect(detail(page).locator(".booking-head .badge")).toHaveText("İptal edildi");
  await expect(detail(page).getByText("Rezervasyonunuz onaylandı")).toHaveCount(0);
  await expect(cancelPanel(page)).toHaveCount(0);
});

test("not-found code shows localized error", async ({ page }) => {
  const res = await page.goto("/tr/bookings/ZZZZZZ");
  expect(res?.status()).toBe(404);
  const box = page.locator(".booking-not-found");
  await expect(box.getByRole("heading", { level: 1, name: "Rezervasyon bulunamadı" })).toBeVisible();
  await expect(box).toContainText("Bu koda ait rezervasyon bulunamadı.");
  await expect(box.getByRole("link", { name: "Rezervasyonlarım" })).toHaveAttribute("href", "/tr/bookings");

  await page.goto("/en/bookings/ZZZZZZ");
  await expect(
    page.locator(".booking-not-found").getByRole("heading", { level: 1, name: "Booking not found" }),
  ).toBeVisible();
  await expect(page.locator(".booking-not-found").getByRole("link", { name: "My bookings" })).toHaveAttribute(
    "href",
    "/en/bookings",
  );
});

test("detail has no axe violations", async ({ page }) => {
  test.setTimeout(90_000);
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 100, refund_amount: "4190.00" });
  await page.goto(`/tr/bookings/${code}?paid=1`);
  await clickUntil(openCancel(page), cancelPanel(page));
  await expectNoAxeViolations(page);
});

// --- Harden: ağ hatası, oturum, bulunamadı, iptal hataları ---

test("network error shows ErrorState with retry", async ({ page }) => {
  const code = await createBooking(page);
  // Tam kesinti: oturum denetimi dahil tüm BFF istekleri ağda düşer. Giriş formu değil, hata ve yeniden dene.
  await page.route("**/bff/**", (route) => route.abort());
  await page.goto(`/tr/bookings/${code}`);
  const error = page.locator(".page").getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  await page.unroute("**/bff/**");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".page").getByRole("alert")).toHaveCount(0);
});

test("session check 500 shows ErrorState with retry, not the login", async ({ page }) => {
  const code = await createBooking(page);
  await page.route("**/bff/auth/me", (route) => route.fulfill({ status: 500, body: "Internal Server Error" }));
  await page.goto(`/tr/bookings/${code}`);
  const error = page.locator(".page").getByRole("alert");
  await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  await page.unroute("**/bff/auth/me");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible({ timeout: 30_000 });
});

test("load error retry moves focus to the booking heading, not the page top", async ({ page }) => {
  const code = await createBooking(page);
  await page.route(`**/bff/me/bookings/${code}`, (route) => route.abort());
  await page.goto(`/tr/bookings/${code}`);
  const retry = detail(page).getByRole("button", { name: "Tekrar dene" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await page.unroute(`**/bff/me/bookings/${code}`);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeFocused({ timeout: 30_000 });
});

test("first load timeout shows ErrorState with retry", async ({ page }) => {
  const code = await createBooking(page);
  let hang = true;
  await page.route(`**/bff/me/bookings/${code}`, async (route) => {
    if (hang) return; // yanıt hiç gelmez
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  await expect(page.getByRole("status").filter({ hasText: "Rezervasyon bilgileri yükleniyor" })).toBeVisible({
    timeout: 30_000,
  });
  await page.clock.runFor(16_000);
  const error = detail(page).getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı");
  hang = false;
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible({ timeout: 30_000 });
});

test("session check timeout shows ErrorState with retry", async ({ page }) => {
  const code = await createBooking(page);
  let hang = true;
  let asked!: () => void;
  const sessionAsked = new Promise<void>((r) => (asked = r));
  await page.route("**/bff/auth/me", async (route) => {
    if (hang) return asked(); // yanıt hiç gelmez
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  await expect(page.getByRole("status").filter({ hasText: "Oturum denetleniyor" })).toBeVisible({ timeout: 30_000 });
  // Yükleniyor durumu sunucuda çizilir: süre sayacı ancak hidrasyondan sonra istek gidince başlar.
  await sessionAsked;
  await page.clock.runFor(16_000);
  const error = page.locator(".page").getByRole("alert");
  await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  await expect(page.locator("#otp-phone")).toHaveCount(0);
  hang = false;
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible({ timeout: 30_000 });
});

test("unknown booking from the API shows the not-found message without retry", async ({ page }) => {
  await login(page);
  await page.goto("/tr/bookings/GAZZ0000");
  const box = page.locator(".booking-not-found");
  await expect(box).toContainText("Bu koda ait rezervasyon bulunamadı.", { timeout: 30_000 });
  await expect(box.getByRole("link", { name: "Rezervasyonlarım" })).toHaveAttribute("href", "/tr/bookings");
  await expect(page.getByRole("button", { name: "Tekrar dene" })).toHaveCount(0);
});

test("401 while loading sends the user to login", async ({ page }) => {
  const code = await createBooking(page);
  await mockBooking(page, code, () => ({ status: 401, code: "unauthorized" }));
  await page.goto(`/tr/bookings/${code}`);
  await expect(page.locator("#otp-phone")).toBeVisible({ timeout: 30_000 });
  await expect(detail(page)).toHaveCount(0);
  // Neden yeniden giriş istendiği söylenir.
  await expect(page.locator(".login-card")).toContainText("Oturumunuz sona erdi");
});

test("refund preview failure shows retry", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await page.route(`**/bff/me/bookings/${code}/cancellation`, (route) => route.abort());
  await page.goto(`/tr/bookings/${code}`);
  const error = detail(page).getByRole("alert");
  await clickUntil(openCancel(page), error);
  await expect(error).toContainText("Sunucuya ulaşılamadı");
  await page.unroute(`**/bff/me/bookings/${code}/cancellation`);
  await mockRefund(page, code, { refund_percent: 50, refund_amount: "2095.00" });
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(cancelPanel(page)).toContainText("%50");
  await expect(cancelPanel(page).locator(".cancel-refund")).toHaveText(fmtTry("2095.00"));
});

test("keep closes the panel and returns focus to the cancel button", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 0, refund_amount: "0.00" });
  await page.goto(`/tr/bookings/${code}`);
  await clickUntil(openCancel(page), cancelPanel(page));
  await expect(cancelPanel(page)).toContainText("%0");
  await cancelPanel(page).getByRole("button", { name: "Vazgeç" }).click();
  await expect(cancelPanel(page)).toHaveCount(0);
  await expect(openCancel(page)).toBeFocused();
});

test("not cancellable conflict is announced and the booking is reloaded", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 100, refund_amount: "4190.00" });
  await page.route(`**/bff/me/bookings/${code}/cancel`, (route) =>
    route.fulfill({ status: 409, json: { error: { code: "not_cancellable", message: "x" } } }),
  );
  await page.goto(`/tr/bookings/${code}`);
  await clickUntil(openCancel(page), cancelPanel(page));
  await cancelPanel(page).getByRole("button", { name: "İptali onayla" }).click();
  await expect(detail(page).getByRole("alert")).toContainText("Bu rezervasyon artık iptal edilemez.");
});

test("double click on confirm cancels only once", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 100, refund_amount: "4190.00" });
  const calls = { n: 0 };
  await page.route(`**/bff/me/bookings/${code}/cancel`, async (route) => {
    calls.n += 1;
    await route.continue();
  });
  await page.goto(`/tr/bookings/${code}`);
  await clickUntil(openCancel(page), cancelPanel(page));
  await cancelPanel(page)
    .getByRole("button", { name: "İptali onayla" })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(detail(page).getByRole("status").filter({ hasText: "Rezervasyon iptal edildi" })).toBeVisible({
    timeout: 30_000,
  });
  expect(calls.n).toBe(1);
});

// --- Canlı takip: eski konum canlı gibi sunulmaz ---

/** Sürücü yolda: bacak durumu `yolda`, sürücü atanmış. */
const enRoute = (page: Page, code: string) =>
  mockBooking(page, code, (body) => ({
    status: "atandi",
    legs: (body.legs as Json[]).map((leg) => ({
      ...leg,
      status: "yolda",
      driver: { first_name: "Mehmet", vehicle: "Mercedes Vito", plate: "07 ABC 123" },
    })),
  }));

test("live tracking turns non-live after 3 failed polls and keeps the last update time", async ({ page }) => {
  const code = await createBooking(page);
  await enRoute(page, code);
  let down = false;
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) =>
    down
      ? route.abort()
      : route.fulfill({
          json: { leg_id: "x", lat: 36.9, lng: 30.8, heading: null, at: new Date(Date.now()).toISOString() },
        }),
  );
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  const box = detail(page).locator(".live-box");
  await expect(box).toContainText("Canlı takip", { timeout: 30_000 });
  await expect(box).toContainText("Son güncelleme");
  await expect(box).not.toHaveClass(/\bstale\b/);

  down = true;
  // İki yoklama hatası (10 sn): henüz eskimiş sayılmaz.
  await page.clock.runFor(10_000);
  await expect(box).not.toHaveClass(/\bstale\b/);
  // Üç aralıktan uzun süre başarılı güncelleme yok: canlı değil, son güncelleme zamanı görünür.
  await page.clock.runFor(11_000);
  await expect(box).toHaveClass(/\bstale\b/);
  await expect(box.getByRole("status")).toContainText("Konum güncellenemiyor");
  await expect(box).toContainText("Son güncelleme");
  await expect(box.locator(".live-dot")).toHaveCount(0);
  await expectNoAxeViolations(page, { include: ".live-box" });

  down = false;
  await page.clock.runFor(5_000);
  await expect(box).not.toHaveClass(/\bstale\b/);
  await expect(box.getByRole("status")).toContainText("Canlı takip");
});

test("live dot does not pulse with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const code = await createBooking(page);
  await enRoute(page, code);
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) =>
    route.fulfill({ json: { leg_id: "x", lat: 36.9, lng: 30.8, heading: null, at: new Date().toISOString() } }),
  );
  await page.goto(`/tr/bookings/${code}`);
  const dot = detail(page).locator(".live-box .live-dot");
  await expect(dot).toBeVisible({ timeout: 30_000 });
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

// --- Düzeltme turu 1: duvar saati eskime, değişmeyen konum zamanı, ilk hata, boş yanıt ---

const loc = (at: string) => ({ leg_id: "x", lat: 36.9, lng: 30.8, heading: null, at });

test("a hung location request turns the box stale on a timer without overlapping polls", async ({ page }) => {
  const code = await createBooking(page);
  await enRoute(page, code);
  let hang = false;
  const calls = { hung: 0 };
  await page.route(`**/bff/me/bookings/${code}/driver-location`, async (route) => {
    if (!hang) return route.fulfill({ json: loc(new Date().toISOString()) });
    calls.hung += 1;
    await new Promise(() => {}); // yanıt hiç gelmez
  });
  const aborted = { n: 0 };
  page.on("requestfailed", (r) => {
    if (r.url().endsWith("/driver-location")) aborted.n += 1;
  });
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  const box = detail(page).locator(".live-box");
  await expect(box).toHaveClass(/\bis-live\b/, { timeout: 30_000 });

  hang = true;
  await page.clock.runFor(10_000);
  await expect(box).toHaveClass(/\bis-live\b/);
  // İstek asılı kalsa da 15 sn'den sonra saat kendisi eskitir.
  await page.clock.runFor(7_000);
  await expect(box).toHaveClass(/\bstale\b/);
  await expect(box.getByRole("status")).toContainText("Konum güncellenemiyor");
  await expect(box).toContainText("Son güncelleme");
  // Yoklamalar üst üste binmez: her asılı istek bir sonraki aralıktan önce iptal edilir.
  expect(calls.hung).toBeGreaterThanOrEqual(2);
  await expect.poll(() => aborted.n).toBeGreaterThanOrEqual(calls.hung - 1);
});

test("an unchanged location time is not shown as live", async ({ page }) => {
  const code = await createBooking(page);
  await enRoute(page, code);
  const at = new Date().toISOString();
  // Sunucu her yoklamada başarılı yanıt verir ama konum zamanı hiç değişmez (sürücü göndermeyi bıraktı).
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) => route.fulfill({ json: loc(at) }));
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  const box = detail(page).locator(".live-box");
  await expect(box).toHaveClass(/\bis-live\b/, { timeout: 30_000 });
  await page.clock.runFor(10_000);
  await expect(box).toHaveClass(/\bis-live\b/);
  await page.clock.runFor(7_000);
  await expect(box).toHaveClass(/\bstale\b/);
  await expect(box.getByRole("status")).toContainText("Konum güncellenemiyor");
  await expect(box).toContainText("Son güncelleme");
});

test("first location poll failure shows the failure state", async ({ page }) => {
  const code = await createBooking(page);
  await enRoute(page, code);
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) => route.abort());
  await page.goto(`/tr/bookings/${code}`);
  const box = detail(page).locator(".live-box");
  await expect(box.getByRole("status")).toContainText("Konum güncellenemiyor", { timeout: 30_000 });
  await expect(box).toHaveClass(/\bstale\b/);
  await expect(box).not.toContainText("Sürücü konumu şu an alınamıyor");
  await expect(box.getByRole("button", { name: "Yenile" })).toBeVisible();
});

test("null location: not available when nothing is known, stale once a position was shown", async ({ page }) => {
  const code = await createBooking(page);
  await enRoute(page, code);
  let reply: "null" | "loc" = "null";
  await page.route(`**/bff/me/bookings/${code}/driver-location`, (route) =>
    route.fulfill({ json: reply === "null" ? null : loc(new Date().toISOString()) }),
  );
  await page.clock.install();
  await page.goto(`/tr/bookings/${code}`);
  const box = detail(page).locator(".live-box");
  await expect(box).toContainText("Sürücü konumu şu an alınamıyor.", { timeout: 30_000 });
  await expect(box).not.toHaveClass(/\bis-live\b/);
  reply = "loc";
  await page.clock.runFor(5_000);
  await expect(box).toHaveClass(/\bis-live\b/);
  // Konum gösterildikten sonra sunucu konum döndürmezse (kayıt süresi doldu) eldeki konum hemen eskir.
  reply = "null";
  await page.clock.runFor(5_000);
  await expect(box).toHaveClass(/\bstale\b/);
  await expect(box).toContainText("Son güncelleme");
});

test("cancel error is shown inside the panel next to the confirm button", async ({ page }) => {
  const code = await createBooking(page);
  await paid(page, code);
  await mockRefund(page, code, { refund_percent: 100, refund_amount: "4190.00" });
  await page.route(`**/bff/me/bookings/${code}/cancel`, (route) => route.abort());
  await page.goto(`/tr/bookings/${code}`);
  await clickUntil(openCancel(page), cancelPanel(page));
  await cancelPanel(page).getByRole("button", { name: "İptali onayla" }).click();
  const alert = cancelPanel(page).getByRole("alert");
  await expect(alert).toContainText("Sunucuya ulaşılamadı");
  await expect(cancelPanel(page).getByRole("button", { name: "İptali onayla" })).toBeVisible();
  await expect(detail(page).getByRole("alert")).toHaveCount(1);
});

// --- Uyum: uzun Almanca metin, uzun ad ve adres, büyük TRY tutarı ---

test("de detail has no horizontal overflow from 360 to 1440 px", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
  test.setTimeout(90_000);
  const code = await createBooking(page, "de");
  const long = "Lange Straße ".repeat(10).slice(0, 120);
  await mockBooking(page, code, (body) => ({
    status: "atandi",
    total_amount: "12345.00",
    currency: "TRY",
    passenger_name: "Maximilian-Alexander ".repeat(6).slice(0, 120),
    note: "Bitte ".repeat(20).slice(0, 120),
    legs: (body.legs as Json[]).map((leg) => ({
      ...leg,
      status: "atandi",
      pickup_address: long,
      dropoff_address: long,
      driver: { first_name: "Mehmet", vehicle: "Mercedes-Benz V-Klasse Exclusive", plate: "07 ABC 123" },
    })),
  }));
  await page.route(`**/bff/me/bookings/${code}/cancellation`, (route) =>
    route.fulfill({
      json: { hours_left: "120.00", guarantee_applied: false, currency: "TRY", refund_percent: 100, refund_amount: "12345.00" },
    }),
  );
  await page.goto(`/de/bookings/${code}`);
  await clickUntil(detail(page).getByRole("button", { name: "Buchung stornieren" }), cancelPanel(page));
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
    const clipped = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          ".booking-detail .btn, .booking-detail h1, .booking-detail h2, .booking-detail dd, .booking-detail dt, .booking-detail .timeline li, .booking-detail .booking-total, .booking-detail .cancel-refund, .booking-detail .hint",
        ),
      )
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, `${width}px`).toEqual([]);
    // TRY tutarları tek satırda ve tabular rakamla.
    for (const sel of [".booking-total", ".cancel-refund"]) {
      const el = detail(page).locator(sel);
      // API tutarı yalnızca biçimlenir (de + TRY: "12.345,00 TRY").
      await expect(el).toHaveText(
        new Intl.NumberFormat("de", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(12345),
      );
      const m = await el.evaluate((n) => ({
        height: n.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(n).lineHeight),
        numeric: getComputedStyle(n).fontVariantNumeric,
      }));
      expect(m.height, `${sel} ${width}px`).toBeLessThan(m.lineHeight * 1.5);
      expect(m.numeric).toContain("tabular-nums");
    }
  }
});

// --- Rezervasyonlarım (BookingsHome): oturum denetlenirken boş ekran yok ---

test("bookings page shows loading state while the session is checked", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/bff/auth/me", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/tr/bookings");
  await expect(page.getByRole("status").filter({ hasText: "Oturum denetleniyor" })).toBeVisible({ timeout: 30_000 });
  release();
  const card = page.locator(".login-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  expect(await card.getAttribute("style")).toBeNull();
});

test("bookings list load error shows ErrorState with retry", async ({ page }) => {
  await login(page);
  await page.route("**/bff/me/bookings", (route) => route.abort());
  await page.goto("/tr/bookings");
  const error = page.locator(".page").getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  await expect(page.getByText("Henüz rezervasyonunuz yok.")).toHaveCount(0);
  await page.unroute("**/bff/me/bookings");
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  // Hesapta rezervasyon olup olmaması varsayılmaz: liste ya da boş durum gelir, hata kalkar.
  await expect(page.locator(".booking-row").or(page.getByText("Henüz rezervasyonunuz yok.")).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".page").getByRole("alert")).toHaveCount(0);
});

for (const [kind, abort] of [
  ["network error", true],
  ["500", false],
] as const) {
  test(`bookings page session check ${kind} shows ErrorState with retry, not the login`, async ({ page }) => {
    await page.route("**/bff/auth/me", (route) =>
      abort ? route.abort() : route.fulfill({ status: 500, body: "Internal Server Error" }),
    );
    await page.goto("/tr/bookings");
    const error = page.locator(".page").getByRole("alert");
    await expect(error.getByRole("button", { name: "Tekrar dene" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#otp-phone")).toHaveCount(0);
    await page.unroute("**/bff/auth/me");
    await error.getByRole("button", { name: "Tekrar dene" }).click();
    // Oturumsuz bağlam: gerçek 401 sonrası sorgulama ve giriş formu.
    await expect(page.locator(".login-card #otp-phone")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Rezervasyonlarım" })).toBeFocused();
  });
}

test("bookings list row shows region labels like pay and detail", async ({ page }) => {
  const code = await createBooking(page);
  await page.goto("/tr/bookings");
  const row = page.locator(".booking-row").filter({ hasText: code });
  await expect(row).toContainText("Antalya Havalimanı (AYT)", { timeout: 30_000 });
});

test("bookings list 401 returns to the login", async ({ page }) => {
  await login(page);
  await page.route("**/bff/me/bookings", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "x" } } }),
  );
  await page.goto("/tr/bookings");
  await expect(page.locator(".login-card #otp-phone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Henüz rezervasyonunuz yok.")).toHaveCount(0);
  await expect(page.locator(".login-card")).toContainText("Oturumunuz sona erdi");
});
