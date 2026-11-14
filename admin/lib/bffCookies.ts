/**
 * BFF oturum çerezi adları ve Secure bayrağı (WEB-08). Saf fonksiyon; route.ts ve testler kullanır.
 *
 * - Secure: NODE_ENV=production ya da BFF_SECURE_COOKIES=1 (ör. `next dev` ile koşan bir staging) iken açık.
 * - Secure açıkken adlar `__Secure-` önekini taşır. Tarayıcı bu önekli çerezi yalnızca HTTPS'ten ve Secure
 *   bayrağıyla kabul eder; HTTP üzerinden ya da Secure'suz yazılamaz, üzerine yazılamaz.
 * - `__Host-` öneki kullanılmaz: çerezler `Path=/bff` ile sınırlıdır (jeton sayfa isteklerine gitmez), `__Host-`
 *   ise `Path=/` ister. `Domain` hiç ayarlanmaz (çerez ana makineye özeldir).
 * - Geçiş: önceki sürümün öneksiz adları (`legacyAt`, `legacyRt`) okunur. Yeni ad yoksa eski yenileme jetonuyla
 *   bir kez yenileme yapılır, jetonlar yeni adla yazılır ve eski çerezler silinir. Mevcut oturumlar düşmez.
 *
 * Bu dosya web/lib/bffCookies.ts ve admin/lib/bffCookies.ts olarak aynıdır (test denetler).
 */

export type BffCookieNames = { at: string; rt: string; legacyAt: string | null; legacyRt: string | null };

export function cookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || env.BFF_SECURE_COOKIES === "1";
}

/** @param base Uygulama öneki: web `ga`, admin `gaa`. */
export function bffCookieNames(base: string, env: Record<string, string | undefined> = process.env): BffCookieNames {
  const at = `${base}_at`;
  const rt = `${base}_rt`;
  if (!cookieSecure(env)) return { at, rt, legacyAt: null, legacyRt: null };
  return { at: `__Secure-${at}`, rt: `__Secure-${rt}`, legacyAt: at, legacyRt: rt };
}
