import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";

// K-77: on iki dil, ülkeye göre ilk açılış dili ve Arapçada sağdan sola düzen.

const LOCALES = ["tr", "en", "de", "es", "ru", "fr", "ar", "zh", "ja", "it", "pt", "ko"];

for (const locale of LOCALES) {
  test(`ana sayfa ${locale} dilinde açılır`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", locale);
    await expect(html).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Dil seçici her dili kendi adıyla listeler.
    await expect(page.getByRole("combobox").first().locator("option")).toHaveCount(LOCALES.length);
  });
}

const COUNTRY_CASES: [country: string, acceptLanguage: string, expected: string][] = [
  ["DE", "en-US,en;q=0.9", "de"],
  ["SA", "en-US", "ar"],
  ["BR", "en-US", "pt"],
  ["MX", "en-US", "es"],
  ["JP", "en-US", "ja"],
  ["KR", "en-US", "ko"],
  ["CN", "en-US", "zh"],
  ["NL", "nl-NL", "en"], // desteklenmeyen dil: İngilizce
  ["TR", "tr-TR", "tr"],
  ["TR", "de-DE,de;q=0.9", "de"], // Türkiye'deki turist kendi dilinde görür
  ["TR", "nl-NL,nl;q=0.9", "en"], // Türkiye'deki turist, dili desteklenmiyor: İngilizce
];

for (const [country, acceptLanguage, expected] of COUNTRY_CASES) {
  test(`ülke ${country} (${acceptLanguage}) → /${expected}`, async ({ request }) => {
    const res = await request.get("/", {
      headers: { "x-country-code": country, "accept-language": acceptLanguage },
      maxRedirects: 0,
    });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    expect(new URL(res.headers().location, "http://x").pathname).toBe(`/${expected}`);
    // Yönlendirme ziyaretçiye göre değişir: ortak önbelleğe girmez.
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
}

test("açık dil seçimi ülkeden önce gelir", async ({ request }) => {
  const res = await request.get("/", {
    headers: { "x-country-code": "DE", cookie: "NEXT_LOCALE=fr" },
    maxRedirects: 0,
  });
  expect(new URL(res.headers().location, "http://x").pathname).toBe("/fr");
});

test("Arapça sayfa sağdan sola, erişilebilir ve yatay kaydırmasız", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("سائقك جاهز. وسعرك ثابت.");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Yön oku aynalanır.
  const flipped = await page.locator(".icon-dir path").first().evaluate((el) => getComputedStyle(el).transform);
  expect(flipped).toContain("matrix(-1");
  await expectNoAxeViolations(page);
});

test("dil seçici sayfayı seçilen dile taşır", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("combobox", { name: "Language" }).first().selectOption("ja");
  await expect(page).toHaveURL(/\/ja$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});
