// Mobil API istemcisi. Jetonlar cihazın güvenli deposunda (Keychain / Keystore) tutulur.
import { API_URL } from "./config";
import { storage } from "./storage";

const AT = "ga_access";
const RT = "ga_refresh";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Tokens = { access_token: string; refresh_token: string };

let access: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

/** Oturum düştüğünde (yenileme başarısız) çağrılır. */
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export async function loadSession(): Promise<boolean> {
  access = await storage.get(AT);
  return access !== null || (await storage.get(RT)) !== null;
}

export async function saveTokens(t: Tokens) {
  access = t.access_token;
  await storage.set(AT, t.access_token);
  await storage.set(RT, t.refresh_token);
}

export async function clearTokens() {
  access = null;
  await storage.remove(AT);
  await storage.remove(RT);
}

export function accessToken(): string | null {
  return access;
}

async function refresh(): Promise<boolean> {
  const rt = await storage.get(RT);
  if (!rt) return false;
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  }).catch(() => null);
  if (!res?.ok) {
    if (res && res.status === 401) await clearTokens();
    return false;
  }
  await saveTokens((await res.json()) as Tokens);
  return true;
}

/** Aynı anda gelen 401'lerde tek yenileme yapılır (yenileme jetonu her kullanımda değişir). */
function refreshOnce(): Promise<boolean> {
  refreshing ??= refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (access) headers.set("authorization", `Bearer ${access}`);
  try {
    return await fetch(`${API_URL}/api/v1/${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "network");
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith("auth/otp")) {
    if (await refreshOnce()) res = await send(path, init);
    else {
      await clearTokens();
      onSignedOut?.();
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? String(res.status));
  }
  return res;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await request(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Çok parçalı form ile dosya yükler (belge yükleme). */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await request(path, { method: "POST", body: form });
  return (await res.json()) as T;
}

export function wsUrl(path: string): string {
  return `${API_URL.replace(/^http/, "ws")}/api/v1/${path}`;
}
