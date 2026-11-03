// Tarayıcı tarafı API istemcisi. Tüm istekler aynı kökenli /bff vekiline gider.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Varsayılan istek süresi: asılı backend'de yükleniyor durumu sonsuza dek dönmez, hata ve "Tekrar dene" çıkar. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** İstek iptal edildi veya süresi doldu (ağ hatası sayılır; hiçbir zaman 401 değildir). */
export const isAbort = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  // Süre sınırı ve çağıranın sinyali tek denetleyicide birleşir; gövde okunana kadar geçerlidir.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const outer = init.signal;
  const forward = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", forward, { once: true });
  try {
    const res = await fetch(`/bff/${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch((e) => {
      if (ctrl.signal.aborted) throw e;
      return null;
    });
    if (!res.ok) {
      const err = data?.error;
      throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? res.statusText, err?.details ?? {});
    }
    return data as T;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

/**
 * Müşteri oturumu var mı? Yalnızca gerçek 401 "oturum yok" demektir (`false`).
 * Ağ hatası, süre aşımı veya 5xx oturumun durumunu bilinmez kılar: hata fırlatılır, çağıran hata ve "Tekrar dene" gösterir.
 */
export async function checkSession(): Promise<boolean> {
  try {
    const me = await api<{ kind: string }>("auth/me");
    return me.kind === "customer";
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return false;
    throw e;
  }
}
