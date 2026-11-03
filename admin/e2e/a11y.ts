import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(
  page: Page,
  opts?: { include?: string; exclude?: string[] },
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (opts?.include) builder = builder.include(opts.include);
  for (const selector of opts?.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const summary = violations.map(
    (v) => `${v.id} [${v.impact ?? "n/a"}] ${v.nodes[0]?.target?.join(" ") ?? "-"}`,
  );
  expect(summary, `axe ihlalleri:\n${summary.join("\n")}`).toEqual([]);
}
