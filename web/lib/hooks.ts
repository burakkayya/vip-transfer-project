"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ApiError, checkSession } from "./api";

/** API hatasını kullanıcının dilinde bir mesaja çevirir. İptal ve süre aşımı ağ hatası sayılır. */
export function useApiError() {
  const t = useTranslations("errors");
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) {
        // 429 durumunda backend kalan süreyi verirse dakika olarak gösterilir (yukarı yuvarlanır).
        if (e.code === "too_many_requests" && e.retryAfter) {
          return t("too_many_requests_wait", { minutes: Math.max(1, Math.ceil(e.retryAfter / 60)) });
        }
        return t.has(e.code) ? t(e.code) : t("unknown");
      }
      return t("network");
    },
    [t],
  );
}

/**
 * Müşteri oturumu. Üç durum:
 * - `loggedIn` true/false: oturum var / yok (yalnızca gerçek 401 "yok" demektir),
 * - `loggedIn` null ve `error` null: denetleniyor,
 * - `loggedIn` null ve `error` dolu: bilinmiyor (ağ, süre aşımı, 5xx); çağıran hata ve `recheck` ile "Tekrar dene" gösterir.
 * `check` sonucu döndürür (bilinmiyorsa hatayı fırlatır), `recheck` yükleniyor durumundan yeniden başlar.
 */
export function useSession() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<unknown>(null);

  const check = useCallback(async () => {
    try {
      const v = await checkSession();
      setError(null);
      setLoggedIn(v);
      return v;
    } catch (e) {
      setLoggedIn(null);
      setError(e);
      throw e;
    }
  }, []);

  const recheck = useCallback(() => {
    setError(null);
    setLoggedIn(null);
    check().catch(() => undefined);
  }, [check]);

  useEffect(() => {
    check().catch(() => undefined);
  }, [check]);

  return { loggedIn, setLoggedIn, error, check, recheck };
}
