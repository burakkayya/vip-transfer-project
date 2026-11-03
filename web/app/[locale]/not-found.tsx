import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { Link } from "@/i18n/navigation";
import { company } from "@/lib/site";

// Yerel 404: `notFound()` çağrıldığında ve hiçbir rotaya uymayan adreste (`[...rest]`) site düzeni içinde çizilir.
// Kaybolan ziyaretçinin en olası hedefleri: ana sayfa, mevcut rezervasyonu (SMS/e-postadaki bağlantı) ve yeni rezervasyon.
export default function NotFound() {
  const t = useTranslations("errors");
  const nav = useTranslations("nav");
  return (
    <div className="container narrow not-found">
      {/* `not-found` dosyasında `metadata` uygulanmıyor (Next 15); React 19 `<title>`ı başa taşır. Sekme ana sayfa başlığıyla karışmaz. */}
      <title>{`404 | ${company.name}`}</title>
      <h1>404</h1>
      <p className="lead">{t("page_not_found")}</p>
      <div className="not-found-actions">
        <Link href="/" className="btn">{t("back_home")}</Link>
        <Link href="/bookings" className="btn secondary">{nav("bookings")}</Link>
        <Link href="/book" className="btn secondary">{nav("book")} <Icon name="arrow" size={18} /></Link>
      </div>
    </div>
  );
}
