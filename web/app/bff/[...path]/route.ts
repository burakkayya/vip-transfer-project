/**
 * Backend vekili (BFF). Tarayıcı backend'e doğrudan gitmez:
 * - Erişim ve yenileme jetonları httpOnly çerezde tutulur, JavaScript'e açılmaz.
 * - Yalnızca müşteri sitesinin ihtiyaç duyduğu uçlar iletilir (admin ve sürücü uçları kapalı).
 * - Durum değiştiren isteklerde Origin kontrolü yapılır (CSRF).
 */
import { NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const AT = "ga_at";
const RT = "ga_rt";
const REFRESH_DAYS = 30;

const ALLOWED: RegExp[] = [
  /^regions$/,
  /^vehicle-types$/,
  /^quotes$/,
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

function clientIp(req: NextRequest): string | null {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
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

async function callApi(req: NextRequest, path: string, body: string | undefined, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ua = req.headers.get("user-agent");
  if (ua) headers["user-agent"] = ua;
  const ip = clientIp(req);
  if (ip) headers["cf-connecting-ip"] = ip;
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API_URL}/api/v1/${path}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  });
}

async function refresh(refreshToken: string): Promise<Tokens | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const path = (await params).path.join("/");
  if (!ALLOWED.some((re) => re.test(path))) {
    return errorResponse(404, "not_found", "not found");
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return errorResponse(403, "forbidden", "origin not allowed");
  }

  const body = req.method === "GET" ? undefined : await req.text();

  // Giriş: jetonlar çereze yazılır, yanıtta tarayıcıya dönmez.
  if (path === "auth/otp/verify") {
    const upstream = await callApi(req, path, body);
    if (!upstream.ok) return relay(upstream);
    const res = NextResponse.json({ ok: true });
    setTokens(res, (await upstream.json()) as Tokens);
    return res;
  }

  let access = req.cookies.get(AT)?.value;
  const refreshToken = req.cookies.get(RT)?.value;
  let renewed: Tokens | null = null;

  if (!access && refreshToken) {
    renewed = await refresh(refreshToken);
    access = renewed?.access_token;
  }

  let upstream = await callApi(req, path, body, access);
  if (upstream.status === 401 && refreshToken && !renewed) {
    renewed = await refresh(refreshToken);
    if (renewed) upstream = await callApi(req, path, body, renewed.access_token);
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
