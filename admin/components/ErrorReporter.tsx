"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * K-83: tarayıcıdaki yakalanmamış hatalar ve sonuçlanmayan promise'ler backend'e olay olarak bildirilir
 * (`/bff/client-errors`). Kişisel veri gönderilmez: ileti ve yığın izi backend'de ayrıca maskelenir; ekran adı
 * olarak gerçek yol değil, yoldaki kod ve sayıların yerine `#` konmuş şablon gider. Sayfa başına en fazla 5 rapor.
 */
const MAX_REPORTS = 5;

function screenOf(pathname: string): string {
  return pathname.replace(/\/[A-Za-z]{0,3}[0-9][A-Za-z0-9-]*/g, "/#").slice(0, 120) || "/";
}

export default function ErrorReporter() {
  const pathname = usePathname();

  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();

    function report(message: string, stack: string | undefined, code: string) {
      const key = code + message;
      if (sent >= MAX_REPORTS || seen.has(key)) return;
      seen.add(key);
      sent += 1;
      void fetch("/bff/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          source: "admin",
          code,
          message: message.slice(0, 500) || "bilinmeyen hata",
          stack: stack?.slice(0, 4000),
          screen: screenOf(window.location.pathname),
        }),
      }).catch(() => undefined);
    }

    function onError(e: ErrorEvent) {
      const err = e.error instanceof Error ? e.error : null;
      report(err?.message ?? e.message ?? "", err?.stack, err?.name ? `uncaught_${err.name}` : "uncaught_error");
    }
    function onRejection(e: PromiseRejectionEvent) {
      const err = e.reason instanceof Error ? e.reason : null;
      report(err?.message ?? String(e.reason ?? ""), err?.stack,
        err?.name ? `unhandled_${err.name}` : "unhandled_rejection");
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [pathname]);

  return null;
}
