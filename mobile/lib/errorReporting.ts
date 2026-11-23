// K-83: yakalanmamış JavaScript hataları backend'e olay olarak bildirilir (`POST /client-errors`, kimliksiz,
// backend IP başına sınırlar). Kişisel veri gönderilmez; ileti ve yığın izi backend'de ayrıca maskelenir.
// Oturum başına en fazla 10 rapor; aynı hata bir kez.
import { Platform } from "react-native";
import { API_URL, VARIANT } from "./config";
import { APP_VERSION, clientHeaders, newRequestId } from "./clientInfo";

const MAX_REPORTS = 10;
let sent = 0;
const seen = new Set<string>();
let installed = false;

/** Backend yalnızca `uncaught|unhandled|fatal` + `_HarfAdı` biçimini kabul eder. */
function codeOf(kind: string, name: string | undefined): string {
  const clean = (name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 40);
  return clean ? `${kind}_${clean}` : kind;
}

export function reportError(error: unknown, code: "uncaught" | "unhandled" | "fatal" = "uncaught",
                            screen?: string): void {
  const err = error instanceof Error ? error : null;
  const message = (err?.message ?? String(error ?? "")).slice(0, 500) || "bilinmeyen hata";
  const key = code + message;
  if (sent >= MAX_REPORTS || seen.has(key)) return;
  seen.add(key);
  sent += 1;
  void fetch(`${API_URL}/api/v1/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json", ...clientHeaders(newRequestId()) },
    body: JSON.stringify({
      source: VARIANT === "driver" ? "mobile_driver" : "mobile_customer",
      code: codeOf(code, err?.name),
      message,
      stack: err?.stack?.slice(0, 4000),
      screen,
      app_version: APP_VERSION,
    }),
  }).catch(() => undefined);
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };

/** Uygulama açılışında bir kez: yerel (iOS/Android) genel hata işleyicisi ya da web'de pencere olayları. */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (Platform.OS !== "web" && utils) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, isFatal) => {
      reportError(error, isFatal ? "fatal" : "uncaught");
      previous(error, isFatal);
    });
    return;
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("error", (e: ErrorEvent) => reportError(e.error ?? e.message, "uncaught"));
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => reportError(e.reason, "unhandled"));
  }
}
