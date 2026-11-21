import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { countryFromHeaders, localeForCountry } from "./i18n/locales";
import { routing } from "./i18n/routing";
import { addRequestHeaders, buildCsp, createNonce } from "./lib/csp";

const intl = createMiddleware(routing);

// Dil yönlendirmesi + istek başına CSP nonce'ı (WEB-04). Next, istek başlığındaki CSP'den nonce'ı okuyup
// kendi inline script'lerine ekler; aynı politika yanıta da yazılır.
export default function middleware(req: NextRequest) {
  const csp = buildCsp(createNonce());
  const res = intl(withCountryLanguage(req));
  // K-77: önekli olmayan yolda yönlendirme ülkeye ve tarayıcı diline göre değişir; ortak önbelleğe girmemeli.
  const first = req.nextUrl.pathname.split("/")[1] ?? "";
  if (!(routing.locales as readonly string[]).includes(first)) {
    res.headers.set("cache-control", "private, no-store");
    res.headers.append("vary", "Accept-Language, CF-IPCountry, X-Vercel-IP-Country, Cookie");
  }
  addRequestHeaders(res, req, { "content-security-policy": csp });
  res.headers.set("content-security-policy", csp);
  return res;
}

/**
 * K-77: dil önekli olmayan ilk ziyarette dil ziyaretçinin ülkesinden seçilir (ülkenin dili desteklenmiyorsa
 * İngilizce). Açık seçim (NEXT_LOCALE çerezi, dil seçici) her zaman önce gelir. next-intl dili Accept-Language'dan
 * okuduğu için seçilen dil bu başlığa yazılır; ülke bilinmiyorsa (yerel geliştirme) tarayıcı dili kullanılır.
 */
function withCountryLanguage(req: NextRequest): NextRequest {
  if (req.cookies.has("NEXT_LOCALE")) return req;
  const first = req.nextUrl.pathname.split("/")[1] ?? "";
  if ((routing.locales as readonly string[]).includes(first)) return req;
  const locale = localeForCountry(countryFromHeaders(req.headers), req.headers.get("accept-language"));
  if (!locale) return req;
  const headers = new Headers(req.headers);
  headers.set("accept-language", locale);
  return new NextRequest(req, { headers });
}

export const config = {
  // bff (backend vekili), Next iç dosyaları ve uzantılı dosyalar dil yönlendirmesine girmez; bunlar
  // next.config.ts'teki nonce'suz politikayı alır. REV-B-9: önekler yalnızca tam yol parçası olarak dışlanır
  // (`/bffx`, `/_nextx` middleware'e girer ve nonce'lı CSP alır). Desen next.config.ts'teki NON_PAGE_SOURCE'un
  // tam tersidir; değiştirirken ikisi birlikte değişmeli.
  // K-81: yalnızca bilinen statik dosya uzantıları dışlanır; noktalı başka yollar (`/tr/a.b`) sayfa yoludur,
  // nonce'lı CSP alır ve 404 sayfası boş kalmaz.
  matcher: ["/((?!(?:bff|_next|_vercel)(?:/|$)|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|txt|xml|webmanifest|json|js|mjs|css|map|woff2?|ttf|otf)$).*)"],
};
