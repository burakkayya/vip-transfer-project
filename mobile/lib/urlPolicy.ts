// MOB-04: API adresi taşıma güvenliği. Saf işlevler (React Native içe aktarımı yok): hem `app.config.ts`
// (derleme zamanı) hem `lib/config.ts` (çalışma zamanı) aynı kuralı kullanır.

/** Geliştirme/CI test adresleri: loopback, Android emülatörü (10.0.2.2) ve özel ağ (RFC 1918). */
export function isLocalDevHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "[::1]") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`Geçersiz API adresi: ${url}`);
  }
}

/**
 * Üretim derlemesinde (`dev=false`) API adresi `https://` olmalıdır (WebSocket bundan `wss://` türer).
 * `allowLocalHttp` yalnızca mağaza dışı derlemede (`app.config.ts`) verilir ve yalnızca yerel/özel ağ
 * adreslerini kapsar (CI emülatörü `http://10.0.2.2:8000`). Geliştirmede (`__DEV__`) http serbesttir.
 */
export function assertSecureApiUrl(url: string, opts: { dev: boolean; allowLocalHttp: boolean }): void {
  const u = parse(url);
  if (u.protocol === "https:") return;
  if (u.protocol !== "http:") throw new Error(`API adresi http(s) olmalı: ${u.protocol}`);
  if (opts.dev) return;
  if (opts.allowLocalHttp && isLocalDevHost(u.hostname)) return;
  throw new Error(
    "Üretim derlemesinde API adresi https:// olmalı (MOB-04). GETAWAY_API_URL değerini https ile verin.",
  );
}

/** http(s) tabanını WebSocket tabanına çevirir: https -> wss, http -> ws. */
export function toWsBase(apiUrl: string): string {
  // Şema büyük/küçük harfe duyarsızdır (assertSecureApiUrl `HTTPS://` adresini kabul eder).
  const m = /^(https?):\/\//i.exec(apiUrl);
  if (!m) throw new Error("API adresi http(s) olmalı");
  return `${m[1].toLowerCase() === "https" ? "wss" : "ws"}://${apiUrl.slice(m[0].length)}`;
}
