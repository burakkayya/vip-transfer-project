import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("errors");
  return (
    <div className="container narrow stack">
      <h1>404</h1>
      <p>{t("not_found")}</p>
      <Link href="/">Getaway Transfers</Link>
    </div>
  );
}
