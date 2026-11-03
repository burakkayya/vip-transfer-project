import { expect, test, type Page } from "@playwright/test";
import tr from "../messages/tr.json";
import { company } from "../lib/site";
import { expectNoAxeViolations } from "./a11y";
import { warmUp } from "./session";

// Yasal sayfalar (B-W11…B-W14): tek dinamik rota `legal/[slug]`. Yalnızca tipografi, okunurluk ve düzen değişir;
// metin anahtarları ve içerik değişmez (bu dosyadaki içerik testleri bunu korur). Boş ve hata durumu yok (statik sayfa).

test.describe.configure({ timeout: 60_000 });
test.beforeAll(async ({ browser }, info) =>
  warmUp(browser, info, [
    "/tr/legal/cancellation",
    "/tr/legal/privacy",
    "/tr/legal/distance-sales",
    "/tr/legal/cookies",
    "/de/legal/privacy",
  ]),
);

type Legal = typeof tr.legal;
const PAGES = [
  { slug: "cancellation", name: "legal cancellation", key: "cancellation", keys: ["intro", "tier1", "tier2", "tier3", "guarantee", "process", "noShow", "howTo"] },
  {
    slug: "privacy",
    name: "legal privacy",
    key: "privacy",
    keys: ["controller", "dataTitle", "data", "purposeTitle", "purpose", "transferTitle", "transfer", "retentionTitle", "retention", "rightsTitle", "rights"],
  },
  { slug: "distance-sales", name: "legal distance sales", key: "distanceSales", keys: ["seller", "service", "price", "performance", "withdrawal", "complaints"] },
  { slug: "cookies", name: "legal cookies", key: "cookies", keys: ["text", "list"] },
] as const;

/** Mesajı sayfanın kullandığı değerlerle doldurur (ICU yer tutucuları). */
function expected(slug: string, key: keyof Legal, k: string): string {
  const values: Record<string, string> = {
    company: company.legalName,
    address: company.address,
    email: slug === "privacy" ? company.kvkkEmail : company.email,
    tursab: company.tursabNo,
  };
  const raw = (tr.legal[key] as Record<string, string>)[k];
  return raw.replace(/\{(\w+)\}/g, (_, v: string) => values[v]);
}

/** Yasal içerik (başlık, paragraf, liste öğesi); taslak notu, sürüm satırı ve içindekiler hariç. */
const content = (page: Page) =>
  page.locator("article.legal").locator(":is(h2, p, li):not(.alert):not(.hint):not(nav *)");

for (const p of PAGES) {
  test(`${p.name} has no axe violations`, async ({ page }) => {
    await page.goto(`/tr/legal/${p.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(tr.legal[p.key].title);
    await expectNoAxeViolations(page);
  });

  test(`${p.name} draft notice visible`, async ({ page }) => {
    await page.goto(`/tr/legal/${p.slug}`);
    const notice = page.locator("article.legal").getByText(tr.legal.draft, { exact: true });
    await expect(notice).toBeVisible();
    // Not, içerikten önce gelir (okuyan önce taslak olduğunu görür).
    const before = await notice.evaluate((n) => {
      const first = document.querySelector("article.legal :is(h2, p, li):not(.alert):not(.hint):not(nav *)");
      return !!first && !!(n.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
  });

  test(`${p.name} content unchanged`, async ({ page }) => {
    await page.goto(`/tr/legal/${p.slug}`);
    const texts = (await content(page).allTextContents()).map((s) => s.trim());
    expect(texts).toEqual(p.keys.map((k) => expected(p.slug, p.key, k)));
  });

  test(`${p.name} reading measure is 65-75ch`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Ölçü yalnızca geniş ekranda sınırlanır; telefonda ekran genişliği belirler");
    await page.goto(`/tr/legal/${p.slug}`);
    const ch = await content(page).first().evaluate((el) => {
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(100);
      probe.style.whiteSpace = "nowrap";
      el.appendChild(probe);
      const one = probe.getBoundingClientRect().width / 100;
      probe.remove();
      return el.getBoundingClientRect().width / one;
    });
    expect(ch).toBeGreaterThanOrEqual(65);
    expect(ch).toBeLessThanOrEqual(75);
  });
}

test("tiers text matches K-14 exactly", async ({ page }) => {
  await page.goto("/tr/legal/cancellation");
  // Üç kademe ayrı bir liste olarak okunur; metin mesajlarla birebir ve sıra değişmez.
  const list = page.locator("article.legal").getByRole("list");
  await expect(list).toHaveCount(1);
  const items = list.getByRole("listitem");
  await expect(items).toHaveText([tr.legal.cancellation.tier1, tr.legal.cancellation.tier2, tr.legal.cancellation.tier3]);
  // K-14: 48 saat ve üzeri %100, 24–48 saat %50, 24 saatten az iade yok (%0).
  await expect(items.nth(0)).toContainText("48 saat");
  await expect(items.nth(0)).toContainText("%100");
  await expect(items.nth(1)).toContainText("24 ile 48 saat");
  await expect(items.nth(1)).toContainText("%50");
  await expect(items.nth(2)).toContainText("24 saatten az");
  await expect(items.nth(2)).toContainText("iade yapılmaz");
});

test("privacy has a section index with working anchors", async ({ page }) => {
  await page.goto("/tr/legal/privacy");
  const toc = page.getByRole("navigation", { name: tr.legal.privacy.title });
  await expect(toc).toBeVisible();
  const titles = ["dataTitle", "purposeTitle", "transferTitle", "retentionTitle", "rightsTitle"] as const;
  await expect(toc.getByRole("link")).toHaveText(titles.map((k) => tr.legal.privacy[k]));
  await toc.getByRole("link", { name: tr.legal.privacy.retentionTitle }).click();
  await expect(page).toHaveURL(/#retention$/);
  const heading = page.getByRole("heading", { level: 2, name: tr.legal.privacy.retentionTitle });
  await expect(heading).toBeInViewport();
  // Yapışkan üst bilginin altında kalmaz.
  const [top, headerBottom] = await Promise.all([
    heading.evaluate((h) => h.getBoundingClientRect().top),
    page.locator(".header").evaluate((h) => h.getBoundingClientRect().bottom),
  ]);
  expect(top).toBeGreaterThanOrEqual(headerBottom);
});

test("legal page prints without site chrome", async ({ page }) => {
  await page.goto("/tr/legal/privacy");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".header")).toBeHidden();
  await expect(page.locator("footer.footer")).toBeHidden();
  await expect(page.getByRole("navigation", { name: tr.legal.privacy.title })).toBeHidden();
  await expect(page.locator("article.legal").getByText(tr.legal.draft, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("legal pages do not overflow at 360-1440 px in German", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Genişlikler testte ayarlanır");
  test.setTimeout(120_000);
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const p of PAGES) {
      await page.goto(`/de/legal/${p.slug}`);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, `${p.slug} ${width}px`).toBeLessThanOrEqual(innerWidth);
    }
  }
});
