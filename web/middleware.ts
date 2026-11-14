import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { addRequestHeaders, buildCsp, createNonce } from "./lib/csp";

const intl = createMiddleware(routing);

// Dil yönlendirmesi + istek başına CSP nonce'ı (WEB-04). Next, istek başlığındaki CSP'den nonce'ı okuyup
// kendi inline script'lerine ekler; aynı politika yanıta da yazılır.
export default function middleware(req: NextRequest) {
  const csp = buildCsp(createNonce());
  const res = intl(req);
  addRequestHeaders(res, req, { "content-security-policy": csp });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // bff (backend vekili), Next iç dosyaları ve uzantılı dosyalar dil yönlendirmesine girmez; bunlar
  // next.config.ts'teki nonce'suz politikayı alır. REV-B-9: önekler yalnızca tam yol parçası olarak dışlanır
  // (`/bffx`, `/_nextx` middleware'e girer ve nonce'lı CSP alır). Desen next.config.ts'teki NON_PAGE_SOURCE'un
  // tam tersidir; değiştirirken ikisi birlikte değişmeli.
  matcher: ["/((?!(?:bff|_next|_vercel)(?:/|$)|.*\\..*).*)"],
};
