"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * K-83: tarayıcıdaki yakalanmamış hatalar ve sonuçlanmayan promise'ler backend'e olay olarak bildirilir
 * (`/bff/client-errors`). Kişisel veri gönderilmez: ileti ve yığın izi backend'de ayrıca maskelenir; ekran adı
 * olarak gerçek yol değil, yoldaki kod ve sayıların yerine `#` konmuş şablon gider. Sayfa başına en fazla 5 rapor.
 */
const MAX_REPORTS = 5;

/** Yalnızca küçük harfli kısa parçalar kalır; kod, jeton ve kimlikler `[x]` olur (backend aynı kuralı uygular). */
function screenOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean).slice(0, 8);
  return "/" + parts.map((p) => (/^[a-z][a-z-]{0,19}$/.test(p) ? p : "[x]")).join("/");
}

/** Backend yalnızca `uncaught|unhandled|fatal` + `_HarfAdı` biçimini kabul eder. */
function codeOf(kind: "uncaught" | "unhandled", name: string | undefined): string {
  const clean = (name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 40);
  return clean ? `${kind}_${clean}` : kind;
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
      report(err?.message ?? e.message ?? "", err?.stack, codeOf("uncaught", err?.name));
    }
    function onRejection(e: PromiseRejectionEvent) {
      const err = e.reason instanceof Error ? e.reason : null;
      report(err?.message ?? String(e.reason ?? ""), err?.stack, codeOf("unhandled", err?.name));
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
