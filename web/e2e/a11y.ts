import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(
  page: Page,
  opts?: { include?: string; exclude?: string[] },
): Promise<void> {
  // Adım geçişi (`step-in`) ve belirme (`.reveal`) animasyonları bitmeden ölçülen yarı saydam metin sahte
  // kontrast hatası verir (CI'da yavaş makinede görüldü). Sonlu animasyonlar bitene kadar beklenir; sonsuz
  // olanlar (iskelet parıltısı, canlı nokta) beklenmez.
  // Biten animasyon yenisini tetikleyebilir (görünür alana giren `.reveal`); iki kare boyunca yeni sonlu animasyon
  // başlamayana kadar tekrar beklenir.
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0; i < 10; i++) {
      await frame();
      const running = document
        .getAnimations()
        .filter((a) => a.playState !== "finished" && a.effect?.getComputedTiming().iterations !== Infinity);
      if (running.length === 0) return;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    }
  });
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (opts?.include) builder = builder.include(opts.include);
  for (const selector of opts?.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const summary = violations.map(
    (v) => `${v.id} [${v.impact ?? "n/a"}] ${v.nodes[0]?.target?.join(" ") ?? "-"}`,
  );
  expect(summary, `axe ihlalleri:\n${summary.join("\n")}`).toEqual([]);
}
