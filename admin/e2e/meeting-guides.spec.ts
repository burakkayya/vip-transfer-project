import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { hasCredentials, SKIP_MESSAGE } from "./session";

// K-62, K-75: Katalog > Buluşma rehberi. Rehber listesi ve bölgeler taklit edilir; kaydetme gövdesi denetlenir.

const REGIONS = [
  { id: 1, name: "Antalya Havalimanı", type: "havalimani", iata_code: "AYT", is_active: true },
  { id: 2, name: "İstanbul Havalimanı", type: "havalimani", iata_code: "IST", is_active: true },
  { id: 3, name: "Kemer", type: "ilce", iata_code: null, is_active: true },
];
// 1x1 JPEG yerine geçen küçük PNG (önizleme yalnızca blob olarak çizilir).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function guide(over: Record<string, unknown> = {}) {
  return {
    id: 7, region_id: 1, region: "Antalya Havalimanı", terminal: "Dış Hatlar", is_active: true,
    updated_at: "2026-11-15T10:00:00Z",
    steps: [
      { texts: { tr: "Pasaport kontrolünden geçin", en: "Pass passport control" }, has_photo: true,
        photo_path: "/api/v1/meeting-guides/7/photos/0", admin_photo_path: "admin/meeting-guides/7/steps/0/photo" },
      { texts: { tr: "Çıkış kapısına yürüyün", en: "Walk to the exit", de: "Zum Ausgang", ru: "К выходу" },
        has_photo: false, photo_path: null, admin_photo_path: null },
    ],
    ...over,
  };
}

test("buluşma rehberi: liste, eksik dil, düzenleme ve sıralama", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  let sent: { steps: { texts: Record<string, string>; photo_from: number | null }[]; terminal: string } | null = null;
  await page.route("**/bff/admin/regions", (route) => route.fulfill({ json: REGIONS }));
  await page.route("**/bff/admin/meeting-guides", (route) => route.fulfill({ json: [guide()] }));
  await page.route("**/bff/admin/meeting-guides/7/steps/0/photo", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }));
  await page.route("**/bff/admin/meeting-guides/7", async (route) => {
    sent = route.request().postDataJSON();
    const g = guide();
    await route.fulfill({ json: { ...g, steps: [g.steps[1], g.steps[0]] } });
  });

  await page.goto("/meeting-guides");
  await expect(page.getByRole("heading", { level: 1, name: "Buluşma rehberi" })).toBeVisible({ timeout: 30_000 });
  const row = page.getByRole("row", { name: /Antalya Havalimanı/ });
  await expect(row).toContainText("Dış Hatlar");
  await expect(row).toContainText("1/2");
  await expect(row).toContainText("DE, RU");
  // Rehberi olmayan havalimanı için kısa yol (ilçe listelenmez).
  await expect(page.getByRole("button", { name: "IST için rehber ekle" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kemer/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await row.getByRole("button", { name: "Düzenle" }).click();
  await expect(page.getByRole("img", { name: "Adım 1 fotoğrafı" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  await page.getByRole("button", { name: "Adım 1: aşağı taşı" }).click();
  await expect(page.getByText("Fotoğraf için önce kaydedin.").first()).toBeVisible();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Rehber kaydedildi.")).toBeVisible();
  expect(sent).not.toBeNull();
  // Fotoğraf adımıyla birlikte taşınır: yeni ilk adımın fotoğrafı yok, ikincisi eski 0. adımın fotoğrafı.
  expect(sent!.steps.map((s) => s.photo_from)).toEqual([null, 0]);
  expect(sent!.steps[1].texts.tr).toBe("Pasaport kontrolünden geçin");
  await expectNoAxeViolations(page);
});

test("buluşma rehberi: yeni rehber metinsiz kaydedilemez", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  let created: Record<string, unknown> | null = null;
  await page.route("**/bff/admin/regions", (route) => route.fulfill({ json: REGIONS }));
  await page.route("**/bff/admin/meeting-guides", async (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: guide({ id: 8, region_id: 2, region: "İstanbul Havalimanı", terminal: "" }) });
    }
    return route.fulfill({ json: [guide()] });
  });
  await page.goto("/meeting-guides");
  await page.getByRole("button", { name: "IST için rehber ekle" }).click();
  await expect(page.getByLabel("Havalimanı")).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  await expect(page.getByText("Fotoğraf, rehber eklendikten sonra yüklenir.")).toBeVisible();
  await page.getByLabel("Türkçe").fill("Gelen yolcu çıkışında bekleyin");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/Rehber eklendi/)).toBeVisible();
  expect(created).toMatchObject({ region_id: 2, steps: [{ texts: { tr: "Gelen yolcu çıkışında bekleyin" }, photo_from: null }] });
});
