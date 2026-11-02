"use client";

import { useTranslations } from "next-intl";
import { useSession } from "@/lib/hooks";
import OtpLogin from "./OtpLogin";
import { LoadingState } from "./States";

/** Oturum yoksa SMS girişi gösterir, varsa içeriği çizer. Oturum denetlenirken boş ekran yerine yükleniyor durumu. */
export default function RequireLogin(props: { children: React.ReactNode; title?: string; text?: string }) {
  const t = useTranslations("account");
  const to = useTranslations("otp");
  const { loggedIn, setLoggedIn } = useSession();
  if (loggedIn === null) return <LoadingState label={to("checking")} />;
  if (loggedIn) return <>{props.children}</>;
  return (
    <div className="card stack login-card">
      <h2>{props.title ?? t("loginTitle")}</h2>
      <p className="muted">{props.text ?? t("loginText")}</p>
      <OtpLogin onDone={() => setLoggedIn(true)} />
    </div>
  );
}
