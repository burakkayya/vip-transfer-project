// MOB-02: rota parametreleri (derin bağlantı, bildirim verisi) güvenilmez girdidir. API yoluna eklenmeden
// önce biçimi doğrulanır (parse*) ve yol yalnızca `apiPath` ile kurulur (her değer encodeURIComponent ile).

// Rezervasyon kodu backend'de "GA" + 6 karakter (backend/app/services/bookings.py `new_booking_code`).
// Biçim değişirse kırılmasın diye uzunluk aralığı geniş tutulur; izin verilen karakterler yalnızca A-Z ve 0-9.
const BOOKING_CODE_RE = /^[A-Z0-9]{6,16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParam = string | string[] | undefined | null;

function single(raw: RawParam): string | null {
  return typeof raw === "string" ? raw : null;
}

/** Geçerli rezervasyon kodu ya da null. */
export function parseBookingCode(raw: RawParam): string | null {
  const v = single(raw);
  return v !== null && BOOKING_CODE_RE.test(v) ? v : null;
}

/** Geçerli bacak kimliği (UUID) ya da null. */
export function parseLegId(raw: RawParam): string | null {
  const v = single(raw);
  return v !== null && UUID_RE.test(v) ? v : null;
}

/** Sohbet kimliği: sürücüde bacak kimliği (UUID), müşteride rezervasyon kodu. */
export function parseChatId(raw: RawParam, variant: "customer" | "driver"): string | null {
  return variant === "driver" ? parseLegId(raw) : parseBookingCode(raw);
}

/**
 * API yolu kurar: şablondaki sabit parçalar olduğu gibi kalır, her değer `encodeURIComponent` ile kodlanır.
 * Boş, "." veya ".." değer yol yapısını değiştirebileceği için hata fırlatır.
 * Örnek: apiPath`me/bookings/${code}/eta`
 */
export function apiPath(strings: TemplateStringsArray, ...values: (string | number)[]): string {
  let out = strings[0];
  values.forEach((value, i) => {
    const v = String(value);
    if (v === "" || v === "." || v === "..") throw new Error("Geçersiz yol parçası");
    out += encodeURIComponent(v) + strings[i + 1];
  });
  return out;
}

// `pay=1` yerine: otomatik ödeme yalnızca uygulama içi akıştan (rezervasyon oluşturma) istenebilir.
// Derin bağlantıyla gelen sorgu parametresi yan etki tetiklemez (F2-17 "deep link pay=1 ignored").
let autoPayCode: string | null = null;

/** Rezervasyon oluşturulduktan hemen sonra, ekrana geçmeden önce çağrılır. */
export function requestAutoPay(code: string): void {
  autoPayCode = code;
}

/** Bu kod için uygulama içinden otomatik ödeme istendiyse bir kez true döner. */
export function consumeAutoPay(code: string): boolean {
  if (autoPayCode === null || autoPayCode !== code) return false;
  autoPayCode = null;
  return true;
}
