/**
 * Admin backend vekili. Jetonlar httpOnly çerezde tutulur; yalnızca personel giriş uçları ve /admin/* iletilir.
 * Durum değiştiren isteklerde Origin kontrol edilir (CSRF).
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBffPath } from "@/lib/bffPath";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const AT = "gaa_at";
const RT = "gaa_rt";
// Personel oturumu en çok 12 saat yenilenebilir; backend süresinden kısa tutulur.
const REFRESH_SECONDS = 12 * 3600;

const ALLOWED: RegExp[] = [/^auth\/staff\/(login|2fa|password)$/, /^auth\/(logout|me)$/, /^admin\/.+$/];
const PASS_HEADERS = ["content-type", "content-disposition", "cache-control"];

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Params = { params: Promise<{ path: string[] }> };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/bff",
    maxAge,
  };
}

function setTokens(res: NextResponse, t: Tokens) {
  res.cookies.set(AT, t.access_token, cookieOptions(t.expires_in));
  res.cookies.set(RT, t.refresh_token, cookieOptions(REFRESH_SECONDS));
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

async function callApi(req: NextRequest, upstream: URL, body: string | undefined, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const ua = req.headers.get("user-agent");
  if (ua) headers["user-agent"] = ua;
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (ip) headers["cf-connecting-ip"] = ip;
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(upstream, {
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
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  const headers: Record<string, string> = { "cache-control": "no-store" };
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
  if (req.method !== "GET" && !sameOrigin(req)) {
    return NextResponse.json({ error: { code: "forbidden", message: "köken reddedildi" } }, { status: 403 });
  }
  const body = req.method === "GET" ? undefined : await req.text();

  if (path === "auth/staff/2fa") {
    const upstream = await callApi(req, target, body);
    if (!upstream.ok) return relay(upstream);
    const res = NextResponse.json({ ok: true });
    setTokens(res, (await upstream.json()) as Tokens);
    return res;
  }
  if (path === "auth/staff/login") return relay(await callApi(req, target, body));

  let access = req.cookies.get(AT)?.value;
  const refreshToken = req.cookies.get(RT)?.value;
  let renewed: Tokens | null = null;
  if (!access && refreshToken) {
    renewed = await refresh(refreshToken);
    access = renewed?.access_token;
  }
  let upstream = await callApi(req, target, body, access);
  if (upstream.status === 401 && refreshToken && !renewed) {
    renewed = await refresh(refreshToken);
    if (renewed) upstream = await callApi(req, target, body, renewed.access_token);
  }

  const res = await relay(upstream);
  if (path === "auth/logout" || (upstream.status === 401 && refreshToken)) clearTokens(res);
  else if (renewed) setTokens(res, renewed);
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
