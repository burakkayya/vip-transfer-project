import { NextRequest, NextResponse } from "next/server";
import { buildCsp, createNonce } from "./lib/csp";

// İstek başına CSP nonce'ı (WEB-04). Next, istek başlığındaki CSP'den nonce'ı okuyup kendi script'lerine ekler.
export function middleware(req: NextRequest) {
  const csp = buildCsp(createNonce());
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // bff (backend vekili), Next iç dosyaları ve uzantılı dosyalar next.config.ts'teki nonce'suz politikayı alır.
  matcher: [
    {
      source: "/((?!bff|_next|.*\\..*).*)",
      // Önceden getirme istekleri sayfa çizmez; nonce gerekmez.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
