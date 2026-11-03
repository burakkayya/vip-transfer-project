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

/** WCAG kontrast oranı: yer tutucu rengi ile alanın gerçek (saydamsa üst öğelerden gelen) zemini. */
async function placeholderContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bg = "rgb(255, 255, 255)";
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const a = rgb(c);
      if (a.length === 3 || (a.length === 4 && a[3] === 1)) {
        bg = c;
        break;
      }
    }
    const fg = lum(rgb(getComputedStyle(el, "::placeholder").color));
    const back = lum(rgb(bg));
    return (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05);
  });
}

for (const c of [
  { name: "home address", path: "/tr", selector: "input[placeholder]" },
  { name: "booking code", path: "/tr/bookings", selector: 'input[placeholder="GA7K3P9Q"]' },
]) {
  test(`placeholder meets contrast: ${c.name}`, async ({ page }) => {
    await page.goto(c.path);
    const input = page.locator(c.selector).first();
    await expect(input).toBeVisible();
    // Dinlenme hali (fare alanın dışında).
    await page.mouse.move(0, 0);
    expect(await placeholderContrast(page, c.selector)).toBeGreaterThanOrEqual(4.5);
    // Üzerine gelme hali.
    await input.hover();
    expect(await placeholderContrast(page, c.selector)).toBeGreaterThanOrEqual(4.5);
  });
}

test("Esc closes mobile menu and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tr/legal/privacy");
  const menuBtn = page.locator(".menu-btn");
  await expect(menuBtn).toBeVisible();
  // Düğme sunucuda çizilir; yük altındaki geliştirme sunucusunda hidrasyondan önceki tıklama boşa gider. Açılana kadar yeniden dene.
  await expect(async () => {
    if ((await menuBtn.getAttribute("aria-expanded")) !== "true") await menuBtn.click();
    await expect(menuBtn).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator("#mobile-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobile-menu")).toHaveCount(0);
  await expect(menuBtn).toHaveAttribute("aria-expanded", "false");
  await expect(menuBtn).toBeFocused();
});

test("reduced motion shows animated elements in final state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tr");
  // "Nasıl çalışır" rota rayı (B-W1): görünür alana kaydırılmadan bile hat çizili ve duraklar yerinde olmalı.
  const step = page.locator(".route-steps li").first();
  await expect(step).toBeAttached();
  const state = await step.evaluate((el) => ({
    clip: getComputedStyle(el, "::before").clipPath,
    node: getComputedStyle(el.querySelector(".node") as Element).transform,
  }));
  expect(["none", "inset(0px)"]).toContain(state.clip);
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(state.node);
});
