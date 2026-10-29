import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import PaymentPanel from "@/components/PaymentPanel";
import RequireLogin from "@/components/RequireLogin";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ result?: string }>;
};

export default async function PayPage({ params, searchParams }: Props) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  if (!/^GA[A-Z0-9]{6}$/i.test(code)) notFound();
  const { result } = await searchParams;
  const t = await getTranslations("pay");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("title")}</h1>
      <RequireLogin>
        <PaymentPanel
          code={code.toUpperCase()}
          result={result === "ok" || result === "fail" ? result : undefined}
        />
      </RequireLogin>
    </div>
  );
}
