import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import BookingDetail from "@/components/BookingDetail";
import RequireLogin from "@/components/RequireLogin";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ paid?: string }>;
};

export default async function BookingPage({ params, searchParams }: Props) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  if (!/^GA[A-Z0-9]{6}$/i.test(code)) notFound();
  const { paid } = await searchParams;
  return (
    <div className="container narrow page">
      <RequireLogin>
        <BookingDetail code={code.toUpperCase()} justPaid={paid === "1"} />
      </RequireLogin>
    </div>
  );
}
