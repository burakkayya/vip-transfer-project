// K-83: backend'in log, olay ve yolculuk geçmişi kayıtları için istemci bilgisi (platform, uygulama, sürüm) ve
// istek kimliği. Kişisel veri içermez.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { VARIANT } from "./config";

export const APP_VERSION = (Constants.expoConfig?.version ?? "0.0.0").slice(0, 30);
// Web önizlemesi "web" olarak gider; backend yalnızca izin listesindeki değerleri kabul eder.
export const PLATFORM = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

export function newRequestId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientHeaders(requestId: string): Record<string, string> {
  return {
    "x-client-platform": PLATFORM,
    "x-client-app": VARIANT,
    "x-client-version": APP_VERSION,
    "x-request-id": requestId,
  };
}
