"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useApiError, useSession } from "@/lib/hooks";
import { ErrorState } from "./ErrorState";
import OtpLogin from "./OtpLogin";
import { LoadingState } from "./States";

/** Sarılan içerik oturumun düştüğünü (API 401) bildirirse giriş yeniden gösterilir. */
const SessionExpiry = createContext<(() => void) | null>(null);

const dev = process.env.NODE_ENV !== "production";

function missingProvider() {
  if (dev) console.warn("useSessionExpired: RequireLogin dışında çağrıldı; 401 sonrası giriş gösterilemez.");
}

/**
 * Sözleşme: bir API çağrısı 401 döndürünce (BFF yenilemesi de başarısız) bileşen bu işlevi çağırır; `RequireLogin`
 * içeriği kaldırıp "oturumunuz sona erdi" notuyla girişi gösterir. Yalnızca `RequireLogin` içinde anlamlıdır:
 * dışında kullanılırsa geliştirmede hem çizimde hem çağrıda `console.warn` ile uyarır (sessizce yutmaz).
 */
export function useSessionExpired(): () => void {
  const expire = useContext(SessionExpiry);
  useEffect(() => {
    if (!expire) missingProvider();
  }, [expire]);
  return expire ?? missingProvider;
}

/**
 * Oturum yoksa SMS girişi gösterir, varsa içeriği çizer. Denetlenirken yükleniyor durumu; oturum durumu
 * bilinemiyorsa (ağ, süre aşımı, 5xx) giriş formu değil hata ve "Tekrar dene". Yalnızca gerçek 401 giriş ister.
 */
export default function RequireLogin(props: { children: React.ReactNode; title?: string; text?: string }) {
  const t = useTranslations("account");
  const to = useTranslations("otp");
  const te = useTranslations("errors");
  const errorText = useApiError();
  const { loggedIn, setLoggedIn, error, recheck } = useSession();
  const [expired, setExpired] = useState(false);
  const expire = useMemo(
    () => () => {
      setExpired(true);
      setLoggedIn(false);
    },
    [setLoggedIn],
  );
  if (error) return <ErrorState text={errorText(error)} onRetry={recheck} />;
  if (loggedIn === null) return <LoadingState label={to("checking")} />;
  if (loggedIn) return <SessionExpiry.Provider value={expire}>{props.children}</SessionExpiry.Provider>;
  return (
    <div className="card stack login-card">
      <h2>{props.title ?? t("loginTitle")}</h2>
      {expired && (
        <p className="alert info" role="status">
          {te("unauthorized")}
        </p>
      )}
      <p className="muted">{props.text ?? t("loginText")}</p>
      <OtpLogin
        onDone={() => {
          setExpired(false);
          setLoggedIn(true);
        }}
      />
    </div>
  );
}
