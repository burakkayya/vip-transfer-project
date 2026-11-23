/**
 * K-83: istek kimliği. Tarayıcıdan gelen `x-request-id` biçime uyuyorsa korunur, yoksa BFF üretir; aynı tarayıcı
 * isteğinin backend'e giden tüm çağrıları (yenileme sonrası tekrar dahil) aynı kimliği taşır. Backend, istek
 * kimliğini log satırlarına, olay kayıtlarına ve yolculuk geçmişine yazar; hata yanıtında "hata kodu" olarak döner.
 */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const ids = new WeakMap<object, string>();

export function requestIdFor(req: object, header: string | null): string {
  let id = ids.get(req);
  if (!id) {
    id = header && REQUEST_ID.test(header) ? header : crypto.randomUUID();
    ids.set(req, id);
  }
  return id;
}
