import { getTranslations, setRequestLocale } from "next-intl/server";
import PaymentResult from "@/components/PaymentResult";

// Bahşiş ödemesinin dönüş sayfası: iFrame'den çıkar, rezervasyonun puan bölümüne döner (sonuç sunucu bildirimiyle).
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function TipResultPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { status } = await searchParams;
  const t = await getTranslations("meet");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("tipTitle")}</h1>
      <PaymentResult status={status === "ok" ? "ok" : "fail"} kind="tip" />
    </div>
  );
}
