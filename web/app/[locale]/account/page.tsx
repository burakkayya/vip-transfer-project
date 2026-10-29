import { getTranslations, setRequestLocale } from "next-intl/server";
import AccountPanel from "@/components/AccountPanel";
import RequireLogin from "@/components/RequireLogin";

type Props = { params: Promise<{ locale: string }> };

export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account");
  return (
    <div className="container narrow page">
      <h1 className="page-title">{t("title")}</h1>
      <RequireLogin>
        <AccountPanel />
      </RequireLogin>
    </div>
  );
}
