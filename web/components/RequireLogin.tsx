"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useMemo } from "react";
import { useSession } from "@/lib/hooks";
import OtpLogin from "./OtpLogin";
import { LoadingState } from "./States";

/** Sarılan içerik oturumun düştüğünü (API 401) bildirirse giriş yeniden gösterilir. */
const SessionExpiry = createContext<(() => void) | null>(null);

/** `RequireLogin` içindeyken oturum düşünce çağrılır; dışında hiçbir şey yapmaz. */
export function useSessionExpired(): () => void {
  const expire = useContext(SessionExpiry);
  return expire ?? noop;
}

function noop() {}

/** Oturum yoksa SMS girişi gösterir, varsa içeriği çizer. Oturum denetlenirken boş ekran yerine yükleniyor durumu. */
export default function RequireLogin(props: { children: React.ReactNode; title?: string; text?: string }) {
  const t = useTranslations("account");
  const to = useTranslations("otp");
  const { loggedIn, setLoggedIn } = useSession();
  const expire = useMemo(() => () => setLoggedIn(false), [setLoggedIn]);
  if (loggedIn === null) return <LoadingState label={to("checking")} />;
  if (loggedIn) return <SessionExpiry.Provider value={expire}>{props.children}</SessionExpiry.Provider>;
  return (
    <div className="card stack login-card">
      <h2>{props.title ?? t("loginTitle")}</h2>
      <p className="muted">{props.text ?? t("loginText")}</p>
      <OtpLogin onDone={() => setLoggedIn(true)} />
    </div>
  );
}
