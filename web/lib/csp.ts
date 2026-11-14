/**
 * İçerik Güvenlik Politikası (WEB-04). Sayfa yanıtlarında middleware istek başına nonce üretir; Next kendi inline
 * script'lerine bu nonce'ı istek başlığındaki CSP'den okuyarak ekler. `'strict-dynamic'` sayesinde nonce'lı
 * script'in yüklediği script'ler (Next parçaları, Google Maps yükleyicisi) çalışır; host listesi yalnızca
 * `'strict-dynamic'` bilmeyen eski tarayıcılar içindir. `'unsafe-inline'` script için kullanılmaz.
 *
 * Middleware dışında kalan yollar (bff, _next, statik dosyalar) next.config.ts'teki nonce'suz politikayı alır.
 */

const isDev = process.env.NODE_ENV === "development";

// Ödeme iFrame'i PayTR'den (geliştirmede backend'in sahte sayfasından) yüklenir.
const frameSrc = ["'self'", "https://www.paytr.com", process.env.GETAWAY_API_URL ?? "http://localhost:8000"];

export function buildCsp(nonce?: string): string {
  const script = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://maps.googleapis.com`
    : "script-src 'self' https://maps.googleapis.com";
  return [
    "default-src 'self'",
    // Google Maps JavaScript API (rezervasyon sayfası rota haritası). Geliştirmede React hata ayıklama eval kullanır.
    script + (isDev ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com",
    "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com",
    "worker-src 'self' blob:",
    `frame-src ${frameSrc.join(" ")}`,
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Edge çalışma ortamında da çalışan, 128 bit rastgele nonce (base64). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Middleware yanıtına istek başlığı ekler (Next'in `x-middleware-override-headers` sözleşmesi). next-intl kendi
 * yanıtını ürettiği için `NextResponse.next({ request })` doğrudan kullanılamaz; mevcut geçersiz kılma listesi korunur.
 */
export function addRequestHeaders(res: Response, req: Request, extra: Record<string, string>): void {
  const OVERRIDE = "x-middleware-override-headers";
  const existing = res.headers.get(OVERRIDE);
  const names = new Set(existing ? existing.split(",").map((n) => n.trim()).filter(Boolean) : [...req.headers.keys()]);
  for (const [name, value] of Object.entries(extra)) {
    const key = name.toLowerCase();
    names.add(key);
    res.headers.set(`x-middleware-request-${key}`, value);
  }
  // Önceden geçersiz kılınmamış başlıkların asıl değerleri korunur.
  if (!existing) {
    for (const [key, value] of req.headers) {
      if (!(key in extra) && !res.headers.has(`x-middleware-request-${key}`)) res.headers.set(`x-middleware-request-${key}`, value);
    }
  }
  res.headers.set(OVERRIDE, [...names].join(","));
}
