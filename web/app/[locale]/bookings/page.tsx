import { getTranslations, setRequestLocale } from "next-intl/server";
import BookingsHome from "@/components/BookingsHome";

type Props = { params: Promise<{ locale: string }> };

export default async function BookingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bookings");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("title")}</h1>
      <BookingsHome />
    </div>
  );
}
