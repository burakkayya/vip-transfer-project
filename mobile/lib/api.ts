// Mobil API istemcisi. Jetonlar cihazın güvenli deposunda (Keychain / Keystore) tutulur.
import { API_URL } from "./config";
import { clientHeaders, newRequestId } from "./clientInfo";
import { storage } from "./storage";
import { toWsBase } from "./urlPolicy";

const AT = "ga_access";
const RT = "ga_refresh";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** 429 durumunda tekrar denemeden önce beklenecek saniye (backend `error.retry_after`). */
    public retryAfter?: number,
    /** Backend `error.details` (ör. toplu kabulde uygun olmayan günler). */
    public details?: unknown,
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

/** Erişim jetonunu yeniler (canlı konum soketi 4401 aldığında). Diğer isteklerle aynı tek yenilemeyi paylaşır. */
export function refreshAccessToken(): Promise<boolean> {
  return refreshOnce();
}

/** Oturum düştü (yenileme başarısız): yerel jetonlar silinir, oturum kapanmış sayılır. */
export async function expireSession(): Promise<void> {
  await clearTokens();
  onSignedOut?.();
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  // K-83: platform, uygulama, sürüm ve istek kimliği (backend log, olay ve yolculuk geçmişi).
  for (const [name, value] of Object.entries(clientHeaders(newRequestId()))) headers.set(name, value);
  if (access) headers.set("authorization", `Bearer ${access}`);
  try {
    return await fetch(`${API_URL}/api/v1/${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "network");
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  const data = await res.json().catch(() => null);
  const retry = typeof data?.error?.retry_after === "number" ? data.error.retry_after : undefined;
  throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? String(res.status), retry,
    data?.error?.details);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith("auth/otp")) {
    if (await refreshOnce()) res = await send(path, init);
    else await expireSession();
  }
  await ensureOk(res);
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

/** Seçilen yerel dosyayı forma ekler (React Native {uri, name, type} dosya parçası). */
export function appendFile(form: FormData, field: string, asset: { uri: string; name: string; mimeType?: string | null }) {
  form.append(field, { uri: asset.uri, name: asset.name, type: asset.mimeType ?? mimeFromName(asset.name) } as unknown as Blob);
}

/** Bazı Android seçicileri MIME türü döndürmez; uzantıdan çıkarılır. */
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
}

/**
 * Çok parçalı form XMLHttpRequest ile gönderilir: Expo'nun fetch'i React Native dosya parçasını desteklemez
 * ("Unsupported FormDataPart implementation"), React Native'in ağ katmanı ise destekler.
 */
function sendForm(path: string, form: FormData): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/v1/${path}`);
    xhr.setRequestHeader("accept", "application/json");
    if (access) xhr.setRequestHeader("authorization", `Bearer ${access}`);
    xhr.timeout = 60_000;
    const fail = () => reject(new ApiError(0, "network", "network"));
    xhr.onload = () => {
      // Durum 0 ağ hatasıdır; Response 200-599 dışını kabul etmez.
      if (xhr.status < 200 || xhr.status > 599) return fail();
      try {
        resolve(new Response(xhr.responseText, { status: xhr.status }));
      } catch {
        fail();
      }
    };
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    xhr.send(form);
  });
}

/** Çok parçalı form ile dosya yükler (belge yükleme). 401'de oturum bir kez yenilenip yeniden denenir. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  let res = await sendForm(path, form);
  if (res.status === 401) {
    if (await refreshOnce()) res = await sendForm(path, form);
    else await expireSession();
  }
  await ensureOk(res);
  return (await res.json()) as T;
}

/**
 * Yetkili uçtan görüntüyü data URI olarak döndürür. React Native Image, Android'de kaynak başlıklarını
 * (Authorization) göndermediği için görüntü jetonla fetch edilip gösterilir; 401'de jeton yenilenir.
 */
export async function imageDataUri(path: string): Promise<string> {
  const res = await request(path, { method: "GET" });
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** MOB-04: https tabanı her zaman wss olur (lib/urlPolicy.ts). `path` apiPath ile kurulmalıdır. */
export function wsUrl(path: string): string {
  return `${toWsBase(API_URL)}/api/v1/${path}`;
}
