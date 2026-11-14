// MOB-07: sunucu çıkışı (oturum iptali + bu cihazın push jetonunun hesaptan silinmesi).
// Başarısızlık sessizce yutulmaz: geçici hatada bir kez yeniden denenir ve sonuç çağırana döner.
import { ApiError } from "./api";

export type ServerLogoutResult = "ok" | "already_invalid" | "failed";

type ApiCall = (path: string, init: { method: string; body?: unknown }) => Promise<unknown>;

const RETRY_DELAY_MS = 1_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ağ hatası, 5xx ve 429 geçicidir; diğer 4xx yeniden denemeyle düzelmez. */
function transient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 429 || e.status >= 500;
}

export async function serverLogout(
  call: ApiCall,
  pushToken: string | null,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<ServerLogoutResult> {
  const init = { method: "POST", ...(pushToken ? { body: { push_token: pushToken } } : {}) };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await call("auth/logout", init);
      return "ok";
    } catch (e) {
      // 401/403: sunucu oturumu zaten geçersiz (iptal edilmiş ya da süresi dolmuş); yenileme de başarısız oldu.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return "already_invalid";
      if (attempt === 0 && transient(e)) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
      return "failed";
    }
  }
  return "failed";
}
