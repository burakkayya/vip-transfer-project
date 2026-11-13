/**
 * Panel İçerik Güvenlik Politikası (WEB-04). Sayfa yanıtlarında middleware istek başına nonce üretir; Next kendi
 * inline script'lerine bu nonce'ı istek başlığındaki CSP'den okuyarak ekler. `'strict-dynamic'` nonce'lı script'in
 * yüklediği Next parçalarına izin verir. `'unsafe-inline'` script için kullanılmaz.
 *
 * Middleware dışında kalan yollar (bff, _next, statik dosyalar) next.config.ts'teki nonce'suz politikayı alır.
 */

const isDev = process.env.NODE_ENV === "development";

export function buildCsp(nonce?: string): string {
  const script = nonce ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` : "script-src 'self'";
  return [
    "default-src 'self'",
    // Geliştirmede React hata ayıklama eval kullanır.
    script + (isDev ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
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
