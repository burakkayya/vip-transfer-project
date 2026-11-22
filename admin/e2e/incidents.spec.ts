import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { hasCredentials, SKIP_MESSAGE } from "./session";

// K-83: olaylar ekranı (liste, ayrıntı, incelemeye al, çözüldü) ve rezervasyonda yolculuk geçmişi.
test("olaylar: istemci hatası listede, senaryosuyla açılır, incelenir ve çözülür", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  test.setTimeout(90_000);
  // Uzun rakam dizisi telefon sanılıp maskelenir (K-83); kimlik harf ağırlıklı.
  const code = `uncaught_Etoe${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 10)}`;

  await page.goto("/incidents");
  await expect(page.getByRole("heading", { level: 1, name: "Olaylar" })).toBeVisible();
  // Panelin kendi hata raporu BFF üzerinden gider (aynı köken).
  const status = await page.evaluate(async (c) => {
    const r = await fetch("/bff/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "admin", code: c, message: "E2E deneme hatası", screen: "/incidents" }),
    });
    return r.status;
  }, code);
  expect(status).toBe(202);

  await page.reload();
  const link = page.getByRole("link", { name: `admin: ${code} (/incidents)` });
  await expect(link).toBeVisible();
  await expectNoAxeViolations(page);
  await link.click();

  await expect(page.getByRole("heading", { level: 1, name: `admin: ${code} (/incidents)` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("E2E deneme hatası")).toBeVisible(); // ileti yalnızca ayrıntıda
  await expect(page.getByRole("heading", { name: /Senaryo/ })).toBeVisible();
  await expect(page.getByText("Admin paneli").first()).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "İncelemeye al" }).click();
  await expect(page.getByText("Olay incelemeye alındı.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Çözüldü" })).toBeDisabled(); // not zorunlu
  await page.getByLabel(/^Not/).fill("E2E: deneme olayı, işlem gerekmiyor");
  await page.getByRole("button", { name: "Çözüldü" }).click();
  await expect(page.getByText("Olay çözüldü olarak işaretlendi.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeniden aç" })).toBeVisible();
});

test("rezervasyon: yolculuk geçmişi gerekçeyle açılır", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  test.setTimeout(90_000);
  await page.goto("/bookings");
  const first = page.locator("table tbody tr a").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  const section = page.locator("#timeline");
  await expect(section.getByRole("heading", { name: "Yolculuk geçmişi" })).toBeVisible({ timeout: 30_000 });
  const show = section.getByRole("button", { name: "Geçmişi göster" });
  await expect(show).toBeDisabled();
  await section.getByLabel(/^Gerekçe/).fill("E2E: geçmiş görünümü denemesi");
  await show.click();
  await expect(section.getByText(/Bu görüntüleme denetim kaydına yazıldı/)).toBeVisible();
  await expect(section.getByRole("list", { name: /yolculuk geçmişi/ }).getByText("Rezervasyon oluşturuldu").first()).toBeVisible();
  await expectNoAxeViolations(page, { include: "#timeline" });
});
