import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Ödeme iFrame'i PayTR'den (geliştirmede backend'in sahte sayfasından) yüklenir.
const frameSrc = ["'self'", "https://www.paytr.com", process.env.GETAWAY_API_URL ?? "http://localhost:8000"];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Google Maps JavaScript API (rezervasyon sayfası rota haritası).
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com",
      "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com",
      "worker-src 'self' blob:",
      `frame-src ${frameSrc.join(" ")}`,
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Geliştirme göstergesi ("N" dairesi) ekran görüntülerine ve testlere karışmasın; yalnızca `next dev`'i etkiler.
  devIndicators: false,
  // Lint ayrı çalıştırılır (`npm run lint`); mevcut taban ihlalleri docs/ui-review/lint-taban.md'de.
  // Plan kapanışında lint zorunlu hale getirilir.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
