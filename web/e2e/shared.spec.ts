import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";

// Ortak dosyalar (B-W0): üst bilgi, yerel 404, klavye odağı, placeholder rengi.

/** Bir CSS değişkeninin hesaplanmış rengini döndürür (ör. `--faint` → `rgb(118, 118, 123)`). */
async function resolveColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, cssVar);
}

test("header has no axe violations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/tr/legal/privacy");
  await expect(page.locator("header")).toBeVisible();
  await expectNoAxeViolations(page, { include: "header" });
});

test("unknown path renders localized 404", async ({ page }) => {
  const response = await page.goto("/tr/yok");
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("404");
  // Site düzeni içinde çizilir: üst bilgi ve ana sayfaya dönüş bağlantısı vardır.
  await expect(page.locator("header")).toBeVisible();
});

test("keyboard focus is visible on primary button", async ({ page }) => {
  await page.goto("/tr/legal/privacy");
  let isBtn = false;
  for (let i = 0; i < 30 && !isBtn; i++) {
    await page.keyboard.press("Tab");
    isBtn = await page.evaluate(() => document.activeElement?.classList.contains("btn") ?? false);
  }
  expect(isBtn, "Tab ile .btn öğesine ulaşılamadı").toBe(true);
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(ring.style).not.toBe("none");
  // DESIGN.md: iki piksellik lake siyah halka.
  expect(ring.style).toBe("solid");
  expect(ring.width).toBe("2px");
  expect(ring.color).toBe(await resolveColor(page, "--ink"));
});

test("placeholder meets contrast", async ({ page }) => {
  await page.goto("/tr");
  const input = page.locator("input[placeholder]").first();
  await expect(input).toBeAttached();
  const color = await input.evaluate((el) => getComputedStyle(el, "::placeholder").color);
  expect(color).toBe(await resolveColor(page, "--faint"));
});

test("reduced motion shows animated elements in final state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tr");
  const bar = page.locator(".step-bar span").first();
  await expect(bar).toBeAttached();
  // Görünür alana kaydırılmadan bile çizgi dolu olmalı (scaleX 1 = dönüşüm yok).
  const transform = await bar.evaluate((el) => getComputedStyle(el).transform);
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
});
