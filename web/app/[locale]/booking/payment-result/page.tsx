import { getTranslations, setRequestLocale } from "next-intl/server";
import PaymentResult from "@/components/PaymentResult";

// Sorgu parametrelerini okur, istek anında çizilir.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function PaymentResultPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { status } = await searchParams;
  const t = await getTranslations("pay");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("title")}</h1>
      <PaymentResult status={status === "ok" ? "ok" : "fail"} />
    </div>
  );
}
