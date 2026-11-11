import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";

// Ana sayfa (B-W1): erişilebilirlik, adres önerilerinde klavye, hareket azaltma, dar ekran.

/** whileInView animasyonları tetiklensin diye sayfayı adım adım kaydırır, sonra başa döner. */
async function scrollThrough(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 400) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1200);
}

/** İçerik öğelerinin görünür opaklığı (atalarla çarpılmış). Kaydırma yapılmadan ölçülür. */
async function hiddenContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors = [
      ".hero h1",
      ".hero .lead",
      ".hero-stats li",
      ".hero-card",
      ".trust-item",
      ".section-title",
      ".section-head p",
      ".service",
      ".fleet-card",
      ".route-steps li",
      ".drive-car",
      ".feature-band h2",
      ".feature-band .btn",
      ".airport-row",
      ".cta-band h2",
      ".faq details",
    ];
    const out: string[] = [];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length === 0) out.push(`${sel}: yok`);
      nodes.forEach((el, i) => {
        let o = 1;
        for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        if (o < 0.99) out.push(`${sel}[${i}] opacity=${o.toFixed(2)}`);
      });
    }
    // Başlık kelimeleri ayrı ayrı canlandırılabilir; her biri görünür olmalı.
    document.querySelectorAll(".hero h1 *").forEach((el, i) => {
      if (Number(getComputedStyle(el).opacity) < 0.99) out.push(`h1 kelime[${i}] gizli`);
    });
    return out;
  });
}

for (const locale of ["tr", "de"]) {
  test(`home has no axe violations (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scrollThrough(page);
    await expectNoAxeViolations(page);
  });
}

test("address suggestions are keyboard operable", async ({ page }) => {
  await page.goto("/tr");
  const input = page.locator("#from");
  await input.click();
  await input.pressSequentially("antalya hav", { delay: 30 });
  await expect(page.getByRole("option", { name: /Antalya Havalimanı/ }).first()).toBeVisible();
  await input.press("ArrowDown");
  // Etkin öneri ekran okuyucuya bildirilir (aria-activedescendant) ve görsel olarak işaretlidir.
  const activeId = await input.getAttribute("aria-activedescendant");
  expect(activeId, "aria-activedescendant yok").toBeTruthy();
  const active = page.locator(`[id="${activeId}"]`);
  await expect(active).toHaveAttribute("aria-selected", "true");
  const title = (await active.locator("strong").textContent())?.trim();
  await input.press("Enter");
  const chosen = page.locator(".address.from .address-chosen");
  await expect(chosen.locator("strong")).toHaveText(title ?? "");
  await expect(chosen.getByText(/Bölge: .+/)).toBeVisible();
});

test("reduced motion shows all sections", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tr");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Kaydırma yok: hareket azaltılmışsa içerik görünür alana girmeyi beklemeden görünür.
  expect(await hiddenContent(page)).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("server render shows all sections", async ({ page }) => {
    await page.goto("/tr");
    // Giriş sahnesi saf CSS'tir (JS olmadan da oynar, ~1,6 sn); bittikten sonra hiçbir bölüm gizli kalmaz.
    await page.waitForTimeout(2000);
    expect(await hiddenContent(page)).toEqual([]);
  });
});

test("empty route submit explains what is missing", async ({ page }) => {
  await page.goto("/tr");
  const submit = page.locator(".hero-card button[type=submit]");
  await expect(submit).toBeEnabled();
  await submit.click();
  const from = page.locator("#from");
  await expect(from).toBeFocused();
  await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".address.from .field-error")).toBeVisible();
});

test("trip form controls have localized names", async ({ page }) => {
  await page.goto("/tr");
  const card = page.locator(".hero-card");
  await expect(card.getByRole("radiogroup", { name: "Yolculuk türü" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Yolcu sayısını azalt" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Bagaj sayısını artır" })).toBeVisible();
});

test("trip type radios move with arrow keys", async ({ page }) => {
  await page.goto("/tr");
  const oneWay = page.getByRole("radio", { name: "Tek yön" });
  await oneWay.focus();
  await page.keyboard.press("ArrowRight");
  const round = page.getByRole("radio", { name: "Gidiş-dönüş" });
  await expect(round).toBeFocused();
  await expect(round).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#ret")).toBeVisible();
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`de at ${width}px has no horizontal overflow`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/de");
    await scrollThrough(page);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    // Düğmeler ve başlıklar kapsayıcısından taşmaz.
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".btn, h1, h2, h3, .segmented button"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
        .map((el) => el.textContent?.trim().slice(0, 40)),
    );
    expect(clipped).toEqual([]);
  });
}
