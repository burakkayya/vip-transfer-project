// Rezervasyon ekranlarının (ödeme, detay, liste, ödeme sonucu) ortak kuralları. Saf işlevler; fiyat hesaplanmaz.
import { ApiError } from "./api";
import type { BookingStatus } from "./types";

/** Rezervasyon kodu biçimi (sayfalar 404'ü aynı kuralla verir). */
export const BOOKING_CODE_RE = /^GA[A-Z0-9]{6}$/;

/** Ödemesi alınmış durumlar. */
export const PAID = new Set<BookingStatus>(["onaylandi", "atandi", "yolculukta", "tamamlandi"]);

/** Yeniden denemenin anlamsız olduğu hatalar: rezervasyon yok veya bu müşterinin değil. */
export const isFinal = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);

/** Oturum düştü (BFF yenilemesi de başarısız). İptal ve süre aşımı hiçbir zaman buraya düşmez. */
export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/** Durum rozetinin rengi. */
export function statusClass(s: BookingStatus) {
  if (s === "iptal" || s === "odeme_basarisiz") return "danger";
  if (s === "odeme_bekliyor") return "warn";
  return "ok";
}

/** Sağlayıcı dönüşünde ödeme ekranına geri dönmek için saklanan rezervasyon kodu (`sessionStorage`). */
export const PENDING_KEY = "ga_pending_booking";

/** Ödeme sayfası açıkken oturum düştüyse saklanır: yeniden girişte yeni ödeme açılmaz, aynı rezervasyon yoklanır (K-45). */
export const RESUME_KEY = "ga_resume_checkout";

/** `sessionStorage` erişimi: depolama kapalı veya engelliyse sessizce başarısız olur, ekran çökmez. */
export const session = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Depolama yoksa yalnızca sağlayıcı dönüşündeki kısayol kaybolur (sonuç ekranı listeye gider).
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // yok sayılır
    }
  },
};
