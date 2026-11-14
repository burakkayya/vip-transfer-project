/**
 * BFF yol doğrulaması (WEB-01). Saf fonksiyon; route.ts ve testler kullanır.
 *
 * Next, `[...path]` parçalarını `decodeURIComponent` ile çözülmüş verir: `/bff/me/..%2Fdriver%2Fme` isteği
 * `["me", "../driver/me"]` olarak gelir. Parçalar birleştirilip doğrudan upstream URL'ye yazılırsa fetch `..`'yı
 * normalize eder ve istek izin listesi dışındaki bir uca gider. Bu yüzden:
 * 1. Her parça çözülmüş haliyle tek tek denetlenir; boş, `.`, `..` ya da `/ \ % ? #` veya kontrol karakteri
 *    içeren parça reddedilir (400).
 * 2. İzin listesi, çözülmüş parçaların birleşimi olan normalize yola uygulanır (404).
 * 3. Upstream URL parçalar `encodeURIComponent` ile yeniden kodlanarak `new URL()` ile kurulur; kanonik
 *    `pathname` önek altında kalmalı ve çözüldüğünde aynı yolu vermelidir.
 *
 * Bu dosya web/lib/bffPath.ts ile aynıdır; biri değişirse diğeri de değişir.
 */

export type BffPathResult =
  | { ok: true; path: string; upstream: URL }
  | { ok: false; status: 400 | 404 };

// Çözülmüş parçada bulunmaması gereken karakterler: yol ayırıcıları, kaçış, sorgu/parça başlangıcı, kontrol karakterleri.
const BAD_CHARS = /[/\\%?#\u0000-\u001f\u007f]/;

export function isSafeSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false;
  return !BAD_CHARS.test(segment);
}

/**
 * @param segments Next'in verdiği (çözülmüş) yol parçaları.
 * @param allowed İzin listesi; normalize yolun tamamına uygulanır.
 * @param apiUrl Backend kök adresi (sondaki `/` olmadan).
 * @param search İstek sorgu dizgisi (`?` ile ya da boş).
 */
export function resolveBffPath(segments: string[], allowed: RegExp[], apiUrl: string, search = ""): BffPathResult {
  if (segments.length === 0 || !segments.every(isSafeSegment)) return { ok: false, status: 400 };
  const path = segments.join("/");
  if (!allowed.some((re) => re.test(path))) return { ok: false, status: 404 };

  let base: URL;
  let upstream: URL;
  try {
    base = new URL(`${apiUrl}/api/v1/`);
    upstream = new URL(segments.map(encodeURIComponent).join("/"), base);
  } catch {
    return { ok: false, status: 400 };
  }
  // İkinci katman: kanonik pathname önek altında kalmalı ve çözüldüğünde aynı izinli yolu vermeli.
  if (upstream.origin !== base.origin || !upstream.pathname.startsWith(base.pathname)) return { ok: false, status: 400 };
  let canonical: string;
  try {
    canonical = upstream.pathname.slice(base.pathname.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return { ok: false, status: 400 };
  }
  if (canonical !== path || !allowed.some((re) => re.test(canonical))) return { ok: false, status: 404 };

  upstream.search = search;
  return { ok: true, path, upstream };
}
