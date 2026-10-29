import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { company } from "@/lib/site";

// Metinler hukukçu onayından geçmeli (yasal_ve_guvenlik.md). Sürüm, onay kaydındaki sürümle aynı tutulur.
const PAGES = {
  cancellation: { key: "cancellation", version: "1.0", paragraphs: ["intro", "tier1", "tier2", "tier3", "guarantee", "process", "noShow", "howTo"] },
  privacy: {
    key: "privacy",
    version: "1.0",
    paragraphs: ["controller", "dataTitle", "data", "purposeTitle", "purpose", "transferTitle", "transfer", "retentionTitle", "retention", "rightsTitle", "rights"],
  },
  "distance-sales": {
    key: "distanceSales",
    version: "1.0",
    paragraphs: ["seller", "service", "price", "performance", "withdrawal", "complaints"],
  },
  cookies: { key: "cookies", version: "1.0", paragraphs: ["text", "list"] },
} as const;

type Slug = keyof typeof PAGES;
type Props = { params: Promise<{ locale: string; slug: string }> };

const isSlug = (s: string): s is Slug => s in PAGES;

export function generateStaticParams() {
  return Object.keys(PAGES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSlug(slug)) return {};
  const t = await getTranslations({ locale, namespace: `legal.${PAGES[slug].key}` });
  return { title: `${t("title")} | ${company.name}` };
}

export default async function LegalPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  if (!isSlug(slug)) notFound();
  const page = PAGES[slug];
  const t = await getTranslations(`legal.${page.key}`);
  const common = await getTranslations("legal");
  const values = {
    company: company.legalName,
    address: company.address,
    email: slug === "privacy" ? company.kvkkEmail : company.email,
    tursab: company.tursabNo,
  };

  return (
    <article className="container narrow page legal">
      <h1 className="page-title">{t("title")}</h1>
      <p className="alert info">{common("draft")}</p>
      <p className="hint">{common("updated", { version: page.version })}</p>
      {page.paragraphs.map((p) =>
        p.endsWith("Title") ? <h2 key={p}>{t(p)}</h2> : <p key={p}>{t(p, values)}</p>,
      )}
    </article>
  );
}
