import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import PaymentPanel from "@/components/PaymentPanel";
import RequireLogin from "@/components/RequireLogin";
import { parseBookingCode } from "@/lib/routeParams";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ result?: string }>;
};

export default async function PayPage({ params, searchParams }: Props) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  // WEB-06: kod BFF yollarına eklenmeden önce ortak yardımcıyla doğrulanır ve kodlanır.
  const bookingCode = parseBookingCode(code) ?? notFound();
  const { result } = await searchParams;
  const t = await getTranslations("pay");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("title")}</h1>
      <RequireLogin>
        <PaymentPanel
          code={bookingCode}
          result={result === "ok" || result === "fail" ? result : undefined}
        />
      </RequireLogin>
    </div>
  );
}
