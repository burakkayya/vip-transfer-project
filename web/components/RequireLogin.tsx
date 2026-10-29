"use client";

import { useTranslations } from "next-intl";
import { useSession } from "@/lib/hooks";
import OtpLogin from "./OtpLogin";

/** Oturum yoksa SMS girişi gösterir, varsa içeriği çizer. */
export default function RequireLogin(props: { children: React.ReactNode; title?: string; text?: string }) {
  const t = useTranslations("account");
  const { loggedIn, setLoggedIn } = useSession();
  if (loggedIn === null) return null;
  if (loggedIn) return <>{props.children}</>;
  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <h2>{props.title ?? t("loginTitle")}</h2>
      <p className="muted">{props.text ?? t("loginText")}</p>
      <OtpLogin onDone={() => setLoggedIn(true)} />
    </div>
  );
}
