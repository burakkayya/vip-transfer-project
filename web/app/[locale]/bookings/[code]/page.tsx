import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import BookingDetail from "@/components/BookingDetail";
import RequireLogin from "@/components/RequireLogin";
import { parseBookingCode } from "@/lib/routeParams";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ paid?: string }>;
};

export default async function BookingPage({ params, searchParams }: Props) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  // WEB-06: kod BFF yollarına eklenmeden önce ortak yardımcıyla doğrulanır ve kodlanır.
  const bookingCode = parseBookingCode(code) ?? notFound();
  const { paid } = await searchParams;
  return (
    <div className="container narrow page">
      <RequireLogin>
        <BookingDetail code={bookingCode} justPaid={paid === "1"} />
      </RequireLogin>
    </div>
  );
}
