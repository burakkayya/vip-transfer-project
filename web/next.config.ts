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
// yollar (bff, _next, statik uzantılı dosyalar) burada nonce'suz ve `'unsafe-inline'` içermeyen politikayı alır.
// Kaynak deseni middleware.ts'teki matcher'ın tam tersidir; iki CSP başlığı aynı yanıta yazılmaz.
// REV-B-9: önekler yalnızca tam yol parçası olarak eşleşir (`/bff`, `/bff/...`; `/bffx` sayfa yoludur ve
// middleware'den nonce'lı CSP alır). Böylece her yanıt tam olarak bir CSP alır (e2e/csp-fallback.spec.ts).
// K-81: "uzantılı dosya" yalnızca bilinen statik uzantılardır (middleware matcher'ındaki listeyle aynı).
const NON_PAGE_SOURCE = "/:path((?:bff|_next|_vercel)(?:/.*)?|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|txt|xml|webmanifest|json|js|mjs|css|map|woff2?|ttf|otf))";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Geliştirme göstergesi ("N" dairesi) ekran görüntülerine ve testlere karışmasın; yalnızca `next dev`'i etkiler.
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: NON_PAGE_SOURCE, headers: [{ key: "Content-Security-Policy", value: buildCsp() }] },
    ];
  },
};

export default withNextIntl(nextConfig);
