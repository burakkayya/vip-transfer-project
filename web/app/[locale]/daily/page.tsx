import { getTranslations, setRequestLocale } from "next-intl/server";
import DailyWizard from "@/components/DailyWizard";
import { getRegions, getVehicleTypes } from "@/lib/server";

// Bölge ve araç tipleri istek anında okunur (rezervasyon sayfasıyla aynı).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "daily" });
  return { title: t("title"), description: t("intro") };
}

/** K-29 şoförlü günlük kiralama. */
export default async function DailyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("daily");
  const [regions, vehicleTypes] = await Promise.all([getRegions(), getVehicleTypes()]);
  return (
    <div className="container page">
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-intro muted">{t("intro")}</p>
      <DailyWizard regions={regions} vehicleTypes={vehicleTypes} />
    </div>
  );
}
