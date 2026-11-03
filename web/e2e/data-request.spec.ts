import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { login } from "./session";

// Veri talebi (B-W10): `/data-request`, `DataRequestPanel`. KVKK m.11 / GDPR talep formu ve talep listesi.
// Talep oluşturma (POST) taklit edilir: geliştirme veritabanında admin'in KVKK kuyruğuna test talebi düşmesin.

test.describe.configure({ timeout: 60_000 });
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const due = () => new Date(Date.now() + 30 * 864e5).toISOString();

/** GET listesini ve POST oluşturmayı taklit eder; gönderilen gövdeleri döndürür. */
async function mockRequests(page: Page, opts: { list?: unknown[]; hold?: Promise<void> } = {}) {
  const posted: Record<string, unknown>[] = [];
  await page.route("**/bff/me/data-requests", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: opts.list ?? [] });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posted.push(body);
    if (opts.hold) await opts.hold;
    await route.fulfill({
      status: 201,
      json: { id: `dr-${posted.length}`, request_type: body.request_type, status: "acik", due_at: due(), completed_at: null },
    });
  });
  return posted;
}

const typeGroup = (page: Page) => page.getByRole("group", { name: "Talep türü" });
const submit = (page: Page) => page.getByRole("button", { name: "Talebi gönder" });

test("request type radio group; sent state", async ({ page }) => {
  await login(page);
  const posted = await mockRequests(page);
  await page.goto("/tr/data-request");
  const group = typeGroup(page);
  await expect(group).toBeVisible({ timeout: 30_000 });
  const radios = group.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toHaveAccessibleName("Verilerime erişim");
  await expect(radios.nth(1)).toHaveAccessibleName("Verilerimin düzeltilmesi");
  await expect(radios.nth(2)).toHaveAccessibleName("Verilerimin silinmesi");
  // Tür önceden seçili değildir: seçmeden gönderilirse alan hatası ve odak ilk seçeneğe.
  for (let i = 0; i < 3; i++) await expect(radios.nth(i)).not.toBeChecked();
  const error = page.locator("#type-error");
  await expect(async () => {
    await submit(page).click();
    await expect(error).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(error).toHaveText("Talep türünü seçin.");
  await expect(error).toHaveAttribute("role", "alert");
  await expect(radios.nth(0)).toBeFocused();
  expect(posted).toHaveLength(0);

  await group.getByRole("radio", { name: "Verilerimin düzeltilmesi" }).check();
  await expect(error).toHaveCount(0);
  await page.fill("#note", "Soyadım yanlış yazılmış.");
  await submit(page).click();
  const status = page.locator(".data-request-form").getByRole("status");
  await expect(status).toContainText("Talebiniz alındı.");
  expect(posted).toEqual([{ request_type: "duzeltme", note: "Soyadım yanlış yazılmış." }]);
  // Gönderilen talep listede, form sıfırlandı.
  const list = page.getByRole("list", { name: "Taleplerim" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem").first()).toContainText("Verilerimin düzeltilmesi");
  await expect(list.getByRole("listitem").first()).toContainText("Açık");
  await expect(page.locator("#note")).toHaveValue("");
  for (let i = 0; i < 3; i++) await expect(radios.nth(i)).not.toBeChecked();
});

test("data request submit is locked while sending", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const posted = await mockRequests(page, { hold });
  await page.goto("/tr/data-request");
  await expect(typeGroup(page)).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await typeGroup(page).getByRole("radio", { name: "Verilerime erişim" }).check();
    await expect(typeGroup(page).getByRole("radio", { name: "Verilerime erişim" })).toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await submit(page).click();
  const busy = page.getByRole("button", { name: "Gönderiliyor…" });
  await expect(busy).toBeDisabled();
  await busy.click({ force: true });
  release();
  await expect(page.locator(".data-request-form").getByRole("status")).toContainText("Talebiniz alındı.");
  expect(posted).toHaveLength(1);
});

test("data-request empty state", async ({ page }) => {
  await login(page);
  await mockRequests(page, { list: [] });
  await page.goto("/tr/data-request");
  const section = page.locator(".data-request-list");
  await expect(section.getByRole("heading", { level: 2, name: "Taleplerim" })).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText("Henüz bir talebiniz yok.");
  await expect(section.getByRole("list")).toHaveCount(0);
});

test("data-request loading state", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/bff/me/data-requests", async (route) => {
    await held;
    await route.fulfill({ json: [] });
  });
  await page.goto("/tr/data-request");
  const loading = page.getByRole("status").filter({ hasText: "Talepleriniz yükleniyor" });
  await expect(loading).toBeVisible({ timeout: 30_000 });
  release();
  await expect(page.locator(".data-request-list")).toContainText("Henüz bir talebiniz yok.");
  await expect(loading).toHaveCount(0);
});

test("data-request error state", async ({ page }) => {
  await login(page);
  await page.route("**/bff/me/data-requests", (route) =>
    route.request().method() === "GET" ? route.abort() : route.continue(),
  );
  await page.goto("/tr/data-request");
  const section = page.locator(".data-request-list");
  const error = section.getByRole("alert");
  await expect(error).toContainText("Sunucuya ulaşılamadı", { timeout: 30_000 });
  // Liste alınamadı diye "talebiniz yok" denmez; form kullanılabilir kalır.
  await expect(section).not.toContainText("Henüz bir talebiniz yok.");
  await expect(typeGroup(page)).toBeVisible();
  await page.unroute("**/bff/me/data-requests");
  await mockRequests(page, { list: [] });
  await error.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(section).toContainText("Henüz bir talebiniz yok.", { timeout: 30_000 });
});

test("data-request has no axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await mockRequests(page, {
    list: [
      { id: "a", request_type: "erisim", status: "isleniyor", due_at: due(), completed_at: null },
      { id: "b", request_type: "silme", status: "reddedildi", due_at: due(), completed_at: null },
    ],
  });
  await page.goto("/tr/data-request");
  await expect(page.getByRole("list", { name: "Taleplerim" })).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await submit(page).click();
    await expect(page.locator("#type-error")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expectNoAxeViolations(page, { include: "main" });
});

test("data-request fits 360px in German", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "genişlikler testte ayarlanır");
  await login(page, "de");
  await mockRequests(page, {
    list: [
      { id: "a", request_type: "duzeltme", status: "isleniyor", due_at: due(), completed_at: null },
      { id: "b", request_type: "silme", status: "tamamlandi", due_at: due(), completed_at: null },
    ],
  });
  await page.goto("/de/data-request");
  await expect(page.getByRole("list", { name: "Meine Anträge" })).toBeVisible({ timeout: 30_000 });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(innerWidth);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".page .btn, .page h1, .page h2, .page legend, .page label, .page .hint, .page .badge"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, `${width}px`).toEqual([]);
  }
});
