import { getTranslations, setRequestLocale } from "next-intl/server";
import BookingWizard from "@/components/BookingWizard";
import { getRegions, getVehicleTypes } from "@/lib/server";
import { tripFromParams } from "@/lib/trip";

// Sorgu parametrelerini okur, istek anında çizilir.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("book");
  const [regions, vehicleTypes, query] = await Promise.all([getRegions(), getVehicleTypes(), searchParams]);
  return (
    <div className="container page">
      <h1 className="page-title">{t("title")}</h1>
      <BookingWizard regions={regions} vehicleTypes={vehicleTypes} initial={tripFromParams(query, regions)} />
    </div>
  );
}
