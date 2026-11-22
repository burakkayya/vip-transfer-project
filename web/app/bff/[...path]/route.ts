/**
 * Backend vekili (BFF). Tarayıcı backend'e doğrudan gitmez:
 * - Erişim ve yenileme jetonları httpOnly çerezde tutulur, JavaScript'e açılmaz.
 * - Yalnızca müşteri sitesinin ihtiyaç duyduğu uçlar iletilir (admin ve sürücü uçları kapalı).
 * - Durum değiştiren isteklerde Origin sabit listeyle (ALLOWED_ORIGINS) denetlenir (CSRF, WEB-03);
 *   çapraz siteden gelen her istek Sec-Fetch-Site ile reddedilir (WEB-07).
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBffPath } from "@/lib/bffPath";
import { bffCookieNames, cookieSecure } from "@/lib/bffCookies";
import { fetchSiteAllowed, isAllowedOrigin, originConfig, type OriginConfig } from "@/lib/bffGuard";
import { clientIpConfig, upstreamIpHeaders } from "@/lib/clientIp";
import { requestIdFor } from "@/lib/requestId";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
// REV-A-3 / REV-B-1: istemci IP kaynağı açıkça seçilir (BFF_CLIENT_IP_SOURCE, BFF_TRUSTED_HOPS);
// istemcinin yazdığı IP başlıkları aynen aktarılmaz. docs/security/client-ip.md
const IP_CONFIG = clientIpConfig();
// WEB-08: üretimde `__Secure-` önekli adlar; eski öneksiz adlar bir kez okunup taşınır (lib/bffCookies.ts).
const COOKIES = bffCookieNames("ga");
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
const REFRESH_DAYS = 30;

const ALLOWED: RegExp[] = [
  /^client-errors$/, // K-83: tarayıcı hata raporu (kimliksiz; backend IP başına sınırlar)
  /^regions$/,
  /^vehicle-types$/,
  /^quotes$/,
  /^daily-quotes$/,
  /^routes\/preview$/,
  /^places\/.+$/,
  /^auth\/otp\/(request|verify)$/,
  /^auth\/(logout|me)$/,
  /^me\/.+$/,
  // K-62 girişsiz takip bağlantısı ve buluşma rehberi fotoğrafları
  /^track\/[A-Za-z0-9_-]{16,64}(\/driver-photo)?$/,
  /^meeting-guides\/\d+\/photos\/\d+$/,
];

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Params = { params: Promise<{ path: string[] }> };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax" as const,
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
  res.cookies.set(RT, t.refresh_token, cookieOptions(REFRESH_DAYS * 86400));
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

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: {} } }, { status });
}

async function callApi(req: NextRequest, upstream: URL, body: string | undefined, token?: string) {
  const headers: Record<string, string> = { accept: "application/json, image/*" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ua = req.headers.get("user-agent");
  if (ua) headers["user-agent"] = ua;
  Object.assign(headers, upstreamIpHeaders((name) => req.headers.get(name), IP_CONFIG));
  // K-83: istek kimliği ve platform (backend log, olay ve yolculuk geçmişi).
  headers["x-request-id"] = requestIdFor(req, req.headers.get("x-request-id"));
  headers["x-client-platform"] = "web";
  headers["x-client-app"] = "web";
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
  const type = upstream.headers.get("content-type") ?? "application/json";
  // Fotoğraflar (sürücü, rehber) ikili olarak aktarılır; metne çevrilirse bozulur.
  const binary = type.startsWith("image/");
  const body = upstream.status === 204 ? null : binary ? await upstream.arrayBuffer() : await upstream.text();
  const headers: Record<string, string> = { "content-type": type };
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  if (binary) headers["cache-control"] = upstream.headers.get("cache-control") ?? "private, max-age=300";
  return new NextResponse(body, { status: upstream.status, headers });
}

async function handle(req: NextRequest, { params }: Params) {
  // Yol çözülmüş parçalarla denetlenir ve yeniden kodlanır (WEB-01); reddedilen istek backend'e gitmez.
  const resolved = resolveBffPath((await params).path, ALLOWED, API_URL, req.nextUrl.search);
  if (!resolved.ok) {
    return resolved.status === 400
      ? errorResponse(400, "bad_path", "invalid path")
      : errorResponse(404, "not_found", "not found");
  }
  const { path, upstream: target } = resolved;
  // WEB-07: bazı GET'ler yan etkili (sohbet GET'i mesajları okundu işaretler) ve çerez SameSite=Lax; çapraz
  // siteden gelen istek her yöntemde reddedilir.
  if (!fetchSiteAllowed(req.headers.get("sec-fetch-site"))) {
    return errorResponse(403, "forbidden", "cross-site request");
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return errorResponse(403, "forbidden", "origin not allowed");
  }

  const body = req.method === "GET" ? undefined : await req.text();

  // Giriş: jetonlar çereze yazılır, yanıtta tarayıcıya dönmez.
  if (path === "auth/otp/verify") {
    const upstream = await callApi(req, target, body);
    if (!upstream.ok) return relay(upstream);
    const res = NextResponse.json({ ok: true });
    setTokens(req, res, (await upstream.json()) as Tokens);
    return res;
  }

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
  if (path === "auth/logout" || (upstream.status === 401 && refreshToken)) {
    clearTokens(req, res);
  } else if (renewed) {
    setTokens(req, res, renewed);
  }
  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
