"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ApiError, isLoggedIn } from "./api";

/** API hatasını kullanıcının dilinde bir mesaja çevirir. */
export function useApiError() {
  const t = useTranslations("errors");
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) return t.has(e.code) ? t(e.code) : t("unknown");
      return t("network");
    },
    [t],
  );
}

/** Müşteri oturumu var mı? `null`: henüz bilinmiyor. */
export function useSession() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const recheck = useCallback(() => {
    isLoggedIn().then(setLoggedIn);
  }, []);
  useEffect(recheck, [recheck]);
  return { loggedIn, setLoggedIn, recheck };
}
