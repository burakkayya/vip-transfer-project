import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { Link } from "@/i18n/navigation";

// Yerel 404: `notFound()` çağrıldığında ve hiçbir rotaya uymayan adreste (`[...rest]`) site düzeni içinde çizilir.
export default function NotFound() {
  const t = useTranslations("errors");
  const nav = useTranslations("nav");
  return (
    <div className="container narrow not-found">
      <h1>404</h1>
      <p className="lead">{t("page_not_found")}</p>
      <div className="not-found-actions">
        <Link href="/" className="btn">{t("back_home")}</Link>
        <Link href="/book" className="btn secondary">{nav("book")} <Icon name="arrow" size={18} /></Link>
      </div>
    </div>
  );
}
