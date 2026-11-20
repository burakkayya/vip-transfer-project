import type { NextConfig } from "next";
import { buildCsp } from "./lib/csp";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Panel arama motorlarına kapalıdır.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  // HSTS (WEB-05) yalnızca üretim derlemesinde; yerel http geliştirmesini etkilemez.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

// Sayfa yanıtlarının CSP'si middleware'de istek başına nonce ile yazılır (lib/csp.ts). Middleware'e girmeyen
// yollar (bff, _next, uzantılı dosyalar) burada nonce'suz ve `'unsafe-inline'` içermeyen politikayı alır.
// Kaynak deseni middleware.ts'teki matcher'ın tam tersidir; iki CSP başlığı aynı yanıta yazılmaz.
// REV-B-9: önekler yalnızca tam yol parçası olarak eşleşir (`/bffx` sayfa yoludur, middleware'den CSP alır).
const NON_PAGE_SOURCE = "/:path((?:bff|_next)(?:/.*)?|.*\\..*)";
const fallbackCsp = [{ key: "Content-Security-Policy", value: buildCsp() }];
// REV-B-9: middleware önceden getirme (prefetch) başlıklı istekleri atlar (`missing` koşulu); bu istekler de aynı
// koşulun tersiyle (`has`) nonce'suz politikayı alır. Aynı anahtar için son eşleşen kural geçerlidir, çift
// başlık oluşmaz.
const PREFETCH_HEADERS = [
  { type: "header" as const, key: "next-router-prefetch" },
  { type: "header" as const, key: "purpose", value: "prefetch" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: NON_PAGE_SOURCE, headers: fallbackCsp },
      ...PREFETCH_HEADERS.map((h) => ({ source: "/:path*", has: [h], headers: fallbackCsp })),
    ];
  },
};

export default nextConfig;
