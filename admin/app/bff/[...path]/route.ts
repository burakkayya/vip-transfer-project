/**
 * Admin backend vekili. Jetonlar httpOnly çerezde tutulur; yalnızca personel giriş uçları ve /admin/* iletilir.
 * Durum değiştiren isteklerde Origin sabit listeyle (ALLOWED_ORIGINS) denetlenir (CSRF, WEB-03);
 * çapraz siteden gelen her istek Sec-Fetch-Site ile reddedilir (WEB-07).
 */
import { NextRequest, NextResponse } from "next/server";
import { bffCookieNames, cookieSecure } from "@/lib/bffCookies";
import { fetchSiteAllowed, isAllowedOrigin, originConfig, type OriginConfig } from "@/lib/bffGuard";
import { resolveBffPath } from "@/lib/bffPath";
import { clientIpConfig, upstreamIpHeaders } from "@/lib/clientIp";
import { requestIdFor } from "@/lib/requestId";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
// REV-A-3 / REV-B-1: istemci IP kaynağı açıkça seçilir (BFF_CLIENT_IP_SOURCE, BFF_TRUSTED_HOPS);
// istemcinin yazdığı IP başlıkları aynen aktarılmaz. docs/security/client-ip.md
const IP_CONFIG = clientIpConfig();
// WEB-08: üretimde `__Secure-` önekli adlar; eski öneksiz adlar bir kez okunup taşınır (lib/bffCookies.ts).
const COOKIES = bffCookieNames("gaa");
const SECURE_COOKIES = cookieSecure();
const AT = COOKIES.at;
const RT = COOKIES.rt;
// WEB-03: durum değiştiren isteklerde Origin sabit listeyle (ALLOWED_ORIGINS) tam eşleşir; Host başlıklarına bakılmaz.
// İlk istekte okunur (build sırasında modül değerlendirilirken değil).
let originsCache: OriginConfig | null = null;
function origins(): OriginConfig {
  if (!originsCache) {
    originsCache = originConfig();
    if (originsCache.mode === "deny") {
      console.error("[bff] ALLOWED_ORIGINS tanımsız: üretimde durum değiştiren tüm istekler 403 ile reddedilir.");
    }
  }
  return originsCache;
}
// Personel oturumu en çok 12 saat yenilenebilir; backend süresinden kısa tutulur.
const REFRESH_SECONDS = 12 * 3600;
// En büyük istek gövdesi: rehber fotoğrafı 5 MB + multipart payı. Aşan istek backend'e gitmez (413).
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// K-83: `client-errors` panelin kendi hata raporu (kimliksiz uç; backend IP başına sınırlar).
const ALLOWED: RegExp[] = [/^auth\/staff\/(login|2fa|password)$/, /^auth\/(logout|me)$/, /^admin\/.+$/, /^client-errors$/];
const PASS_HEADERS = ["content-type", "content-disposition", "cache-control"];

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Params = { params: Promise<{ path: string[] }> };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "strict" as const,
    path: "/bff",
    maxAge,
  };
}

/** Önek öncesi adlarla yazılmış çerezleri siler (WEB-08 geçişi). Geliştirmede eski ad yoktur. */
function clearLegacy(req: NextRequest, res: NextResponse) {
  for (const name of [COOKIES.legacyAt, COOKIES.legacyRt]) {
    if (name && req.cookies.has(name)) res.cookies.set(name, "", cookieOptions(0));
  }
}

function setTokens(req: NextRequest, res: NextResponse, t: Tokens) {
  res.cookies.set(AT, t.access_token, cookieOptions(t.expires_in));
  res.cookies.set(RT, t.refresh_token, cookieOptions(REFRESH_SECONDS));
  clearLegacy(req, res);
}

function clearTokens(req: NextRequest, res: NextResponse) {
  res.cookies.set(AT, "", cookieOptions(0));
  res.cookies.set(RT, "", cookieOptions(0));
  clearLegacy(req, res);
}

/**
 * Yenileme jetonu: önce yeni (önekli) ad, yoksa önceki sürümün öneksiz adı. Eski erişim jetonu bilerek okunmaz:
 * böylece eski çerezli ilk istekte yenileme yapılır, jetonlar yeni adla yazılır, eski çerezler silinir.
 */
function readRefreshToken(req: NextRequest): string | undefined {
  return req.cookies.get(RT)?.value ?? (COOKIES.legacyRt ? req.cookies.get(COOKIES.legacyRt)?.value : undefined);
}

function sameOrigin(req: NextRequest): boolean {
  return isAllowedOrigin(req.headers.get("origin"), origins());
}

async function callApi(req: NextRequest, upstream: URL, body: ArrayBuffer | undefined, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ua = req.headers.get("user-agent");
  if (ua) headers["user-agent"] = ua;
  Object.assign(headers, upstreamIpHeaders((name) => req.headers.get(name), IP_CONFIG));
  // K-83: istek kimliği ve platform (backend log, olay ve yolculuk geçmişi).
  headers["x-request-id"] = requestIdFor(req, req.headers.get("x-request-id"));
  headers["x-client-platform"] = "admin";
  headers["x-client-app"] = "admin";
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(upstream, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  });
}

async function refresh(req: NextRequest, refreshToken: string): Promise<Tokens | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", ...upstreamIpHeaders((name) => req.headers.get(name), IP_CONFIG) },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  return res.ok ? ((await res.json()) as Tokens) : null;
}

async function relay(upstream: Response): Promise<NextResponse> {
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  return new NextResponse(body, { status: upstream.status, headers });
}

async function handle(req: NextRequest, { params }: Params) {
  // Yol çözülmüş parçalarla denetlenir ve yeniden kodlanır (WEB-01); reddedilen istek backend'e gitmez.
  const resolved = resolveBffPath((await params).path, ALLOWED, API_URL, req.nextUrl.search);
  if (!resolved.ok) {
    return resolved.status === 400
      ? NextResponse.json({ error: { code: "bad_path", message: "geçersiz yol" } }, { status: 400 })
      : NextResponse.json({ error: { code: "not_found", message: "bulunamadı" } }, { status: 404 });
  }
  const { path, upstream: target } = resolved;
  // WEB-07: çapraz siteden gelen istek her yöntemde reddedilir (admin çerezi Strict; ek katman).
  if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: { code: "forbidden", message: "çapraz site isteği" } }, { status: 403 });
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return NextResponse.json({ error: { code: "forbidden", message: "köken reddedildi" } }, { status: 403 });
  }
  // İkili gövde (buluşma rehberi fotoğrafı, multipart) bozulmadan iletilir; boyut okunmadan önce ve sonra denetlenir.
  const tooLarge = () =>
    NextResponse.json({ error: { code: "payload_too_large", message: "istek çok büyük" } }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const body = req.method === "GET" ? undefined : await req.arrayBuffer();
  if (body && body.byteLength > MAX_BODY_BYTES) return tooLarge();

  if (path === "auth/staff/2fa") {
    const upstream = await callApi(req, target, body);
    if (!upstream.ok) return relay(upstream);
    const res = NextResponse.json({ ok: true });
    setTokens(req, res, (await upstream.json()) as Tokens);
    return res;
  }
  if (path === "auth/staff/login") return relay(await callApi(req, target, body));

  let access = req.cookies.get(AT)?.value;
  const refreshToken = readRefreshToken(req);
  let renewed: Tokens | null = null;
  if (!access && refreshToken) {
    renewed = await refresh(req, refreshToken);
    access = renewed?.access_token;
  }
  let upstream = await callApi(req, target, body, access);
  if (upstream.status === 401 && refreshToken && !renewed) {
    renewed = await refresh(req, refreshToken);
    if (renewed) upstream = await callApi(req, target, body, renewed.access_token);
  }

  const res = await relay(upstream);
  if (path === "auth/logout" || (upstream.status === 401 && refreshToken)) clearTokens(req, res);
  else if (renewed) setTokens(req, res, renewed);
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
