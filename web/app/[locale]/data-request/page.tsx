import { getTranslations, setRequestLocale } from "next-intl/server";
import DataRequestPanel from "@/components/DataRequestPanel";
import RequireLogin from "@/components/RequireLogin";
import { company } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

export default async function DataRequestPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dataRequest");
  const p = await getTranslations("legal.privacy");
  return (
    <div className="container narrow page stack">
      <h1 className="page-title">{t("title")}</h1>
      <p>{t("text")}</p>
      <p className="hint">{p("rights", { email: company.kvkkEmail })}</p>
      <RequireLogin>
        <DataRequestPanel />
      </RequireLogin>
    </div>
  );
}
