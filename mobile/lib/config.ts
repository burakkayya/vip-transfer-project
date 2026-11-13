import Constants from "expo-constants";
import { assertSecureApiUrl } from "./urlPolicy";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  variant?: string; apiUrl?: string; webUrl?: string; googleMapsIos?: boolean; googleMapsAndroid?: boolean;
  allowLocalHttp?: boolean;
};

export const VARIANT: "customer" | "driver" = extra.variant === "driver" ? "driver" : "customer";
export const API_URL = (extra.apiUrl ?? "http://localhost:8000").replace(/\/$/, "");
export const WEB_URL = (extra.webUrl ?? "https://getawaytransfers.com").replace(/\/$/, "");

// MOB-04: üretim derlemesi düz HTTP ile jeton taşımaz; uygulama açılışta açıkça hata verir.
// Mağaza profilleri derleme zamanında da durdurulur (app.config.ts).
assertSecureApiUrl(API_URL, { dev: __DEV__, allowLocalHttp: extra.allowLocalHttp === true });

/**
 * Geliştirme: backend'in verdiği localhost adreslerini (sahte ödeme sayfası) uygulamanın eriştiği
 * API adresine çevirir. Android emülatörü bilgisayara 10.0.2.2 üzerinden ulaşır. PayTR adresleri değişmez.
 */
export function reachable(url: string): string {
  return url.replace(/^http:\/\/(localhost|127\.0\.0\.1):8000/, API_URL);
}
export const GOOGLE_MAPS_IOS = extra.googleMapsIos === true;
export const GOOGLE_MAPS_ANDROID = extra.googleMapsAndroid === true;
