import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { buildCsp } from "./lib/csp";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS (WEB-05) yalnızca üretim derlemesinde; yerel http geliştirmesini etkilemez.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

// Sayfa yanıtlarının CSP'si middleware'de istek başına nonce ile yazılır (lib/csp.ts). Middleware'e girmeyen
// yollar (bff, _next, uzantılı dosyalar) burada nonce'suz ve `'unsafe-inline'` içermeyen politikayı alır.
// Kaynak deseni middleware.ts'teki matcher'ın tersidir; iki CSP başlığı aynı yanıta yazılmaz.
const NON_PAGE_SOURCE = "/:path((?:bff|_next|_vercel)(?:/.*)?|.*\\..*)";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Geliştirme göstergesi ("N" dairesi) ekran görüntülerine ve testlere karışmasın; yalnızca `next dev`'i etkiler.
  devIndicators: false,
  // Lint ayrı çalıştırılır (`npm run lint`); mevcut taban ihlalleri docs/ui-review/lint-taban.md'de.
  // Plan kapanışında lint zorunlu hale getirilir.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: NON_PAGE_SOURCE, headers: [{ key: "Content-Security-Policy", value: buildCsp() }] },
    ];
  },
};

export default withNextIntl(nextConfig);
