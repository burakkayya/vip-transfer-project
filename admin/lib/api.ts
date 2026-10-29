// Tarayıcı tarafı API istemcisi. İstekler /bff vekiline gider, yollar /api/v1 sonrasıdır.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, q?: Query): string {
  if (!q) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

async function request(path: string, init: { method?: string; body?: unknown }): Promise<Response> {
  const res = await fetch(`/bff/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 401 && !path.startsWith("auth/staff")) {
    window.location.href = "/login";
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? res.statusText, err?.details);
  }
  return res;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await request(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** İkili yanıtı (belge, CSV) indirir. */
export async function download(path: string, filename: string): Promise<void> {
  const blob = await (await request(path, {})).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function blobUrl(path: string): Promise<{ url: string; type: string }> {
  const blob = await (await request(path, {})).blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "validation_error" && Array.isArray(e.details)) {
      return (e.details as { loc: string[]; msg: string }[])
        .map((x) => `${x.loc.slice(1).join(".")}: ${x.msg}`)
        .join("; ");
    }
    if (e.status === 403) return "Bu işlem için yetkiniz yok.";
    return e.message;
  }
  return "Sunucuya ulaşılamadı.";
}
