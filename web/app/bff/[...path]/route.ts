/**
 * Backend vekili (BFF). Tarayıcı backend'e doğrudan gitmez:
 * - Erişim ve yenileme jetonları httpOnly çerezde tutulur, JavaScript'e açılmaz.
 * - Yalnızca müşteri sitesinin ihtiyaç duyduğu uçlar iletilir (admin ve sürücü uçları kapalı).
 * - Durum değiştiren isteklerde Origin kontrolü yapılır (CSRF).
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBffPath } from "@/lib/bffPath";
import { clientIpConfig, upstreamIpHeaders } from "@/lib/clientIp";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
// REV-A-3 / REV-B-1: istemci IP kaynağı açıkça seçilir (BFF_CLIENT_IP_SOURCE, BFF_TRUSTED_HOPS);
// istemcinin yazdığı IP başlıkları aynen aktarılmaz. docs/security/client-ip.md
const IP_CONFIG = clientIpConfig();
const AT = "ga_at";
const RT = "ga_rt";
const REFRESH_DAYS = 30;

const ALLOWED: RegExp[] = [
  /^regions$/,
  /^vehicle-types$/,
  /^quotes$/,
  /^routes\/preview$/,
  /^places\/.+$/,
  /^auth\/otp\/(request|verify)$/,
  /^auth\/(logout|me)$/,
  /^me\/.+$/,
];

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Params = { params: Promise<{ path: string[] }> };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/bff",
    maxAge,
  };
}

function setTokens(res: NextResponse, t: Tokens) {
  res.cookies.set(AT, t.access_token, cookieOptions(t.expires_in));
  res.cookies.set(RT, t.refresh_token, cookieOptions(REFRESH_DAYS * 86400));
}

function clearTokens(res: NextResponse) {
  res.cookies.set(AT, "", cookieOptions(0));
  res.cookies.set(RT, "", cookieOptions(0));
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: {} } }, { status });
}

async function callApi(req: NextRequest, upstream: URL, body: string | undefined, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ua = req.headers.get("user-agent");
  if (ua) headers["user-agent"] = ua;
  Object.assign(headers, upstreamIpHeaders((name) => req.headers.get(name), IP_CONFIG));
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
  const body = upstream.status === 204 ? null : await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
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
  if (req.method !== "GET" && !sameOrigin(req)) {
    return errorResponse(403, "forbidden", "origin not allowed");
  }

  const body = req.method === "GET" ? undefined : await req.text();

  // Giriş: jetonlar çereze yazılır, yanıtta tarayıcıya dönmez.
  if (path === "auth/otp/verify") {
    const upstream = await callApi(req, target, body);
    if (!upstream.ok) return relay(upstream);
    const res = NextResponse.json({ ok: true });
    setTokens(res, (await upstream.json()) as Tokens);
    return res;
  }

  let access = req.cookies.get(AT)?.value;
  const refreshToken = req.cookies.get(RT)?.value;
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
    clearTokens(res);
  } else if (renewed) {
    setTokens(res, renewed);
  }
  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
