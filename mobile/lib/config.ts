import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: string; apiUrl?: string; webUrl?: string };

export const VARIANT: "customer" | "driver" = extra.variant === "driver" ? "driver" : "customer";
export const API_URL = (extra.apiUrl ?? "http://localhost:8000").replace(/\/$/, "");
export const WEB_URL = (extra.webUrl ?? "https://getawaytransfers.com").replace(/\/$/, "");

/**
 * Geliştirme: backend'in verdiği localhost adreslerini (sahte ödeme sayfası) uygulamanın eriştiği
 * API adresine çevirir. Android emülatörü bilgisayara 10.0.2.2 üzerinden ulaşır. PayTR adresleri değişmez.
 */
export function reachable(url: string): string {
  return url.replace(/^http:\/\/(localhost|127\.0\.0\.1):8000/, API_URL);
}
