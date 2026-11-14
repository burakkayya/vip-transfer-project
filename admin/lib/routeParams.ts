/**
 * Dinamik rota parametresi doğrulaması (WEB-06). Saf fonksiyon; sayfalar ve testler kullanır.
 *
 * URL'den gelen `[id]`, `[code]` ya da `?leg=` değeri BFF yoluna (`/bff/admin/bookings/${id}/cancel`) eklenmeden
 * önce biçim denetiminden geçer. `..%2F..%2Fusers` gibi hazırlanmış bir değer, tarayıcının isteği başka bir uca
 * yönlendirmesine (istemci tarafı yol geçişi, CSPT) yol açabilirdi. Geçersiz değer `null` döner; sayfa
 * `notFound()` çağırır. Geçerli değer kanonik biçime getirilir ve `encodeURIComponent` ile kodlanır (BFF'nin
 * kendi yol denetimi, WEB-01, ikinci katmandır).
 *
 * Bu dosya web/lib/routeParams.ts ve admin/lib/routeParams.ts olarak aynıdır (test denetler).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Rezervasyon kodu: "GA" + 6 büyük harf/rakam (backend services/bookings.py).
const BOOKING_CODE_RE = /^GA[A-Z0-9]{6}$/i;

/** Geçerli UUID ise küçük harfli ve kodlanmış hali, değilse `null`. */
export function parseUuid(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value)) return null;
  return encodeURIComponent(value.toLowerCase());
}

/** Geçerli rezervasyon kodu ise büyük harfli ve kodlanmış hali, değilse `null`. */
export function parseBookingCode(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !BOOKING_CODE_RE.test(value)) return null;
  return encodeURIComponent(value.toUpperCase());
}
