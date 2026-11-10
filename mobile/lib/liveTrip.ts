/**
 * Yolculuk durumunun bildirim ekranında sabit gösterimi (K-59), Uber/Lime tarzı:
 * - iOS 16.2+: Canlı Etkinlik (kilit ekranı afişi + Dynamic Island), `widgets/TripActivity`.
 * - Android: kaydırarak kapatılamayan, yerinde güncellenen bildirim, `widgets/TripNotification`.
 *
 * Uygulama açıkken (sürücüde arka plan konum görevi sürerken de) ekranlar durumu buraya bildirir.
 * Uygulama tamamen kapalıyken güncelleme için APNs/FCM ile uzaktan güncelleme gerekir (açık konu).
 * Expo Go'da ve web'de yerel modül yoktur: tüm çağrılar sessizce hiçbir şey yapmaz.
 */
import { Platform } from "react-native";
import { t } from "@/lib/i18n";
import { storage } from "@/lib/storage";
import type { LiveTripProps } from "@/widgets/types";

export type { LiveTripProps };

/** Aşama ilerlemesi: atandı → yolda → geldi → yolculukta → bitti. */
export const STAGE_PROGRESS: Record<string, number> = {
  beklemede: 0.08,
  atandi: 0.25,
  yolda: 0.5,
  vardi: 0.7,
  basladi: 0.85,
  bitti: 1,
};

const ANDROID_ID = "trip-live";
// Hangi yolculuğun etkinliği açık: uygulama yeniden başlasa da (bellek sıfırlanır) başka bir yolculuğun
// ekranı açık etkinliği kapatmasın diye cihazda saklanır.
const KEY_STORE = "ga_live_trip";
/** Planlı işte etkinlik alışa bu kadar kala başlar (günlerce bildirimde durmasın). */
export const SHOW_BEFORE_PICKUP_MS = 90 * 60 * 1000;
// Bitti afişi kilit ekranında bir süre kalır, sonra kendiliğinden kalkar.
const DONE_LINGER_MS = 15 * 60 * 1000;

type Activity = {
  update(props: LiveTripProps): Promise<void> | void;
  end(policy?: unknown, props?: LiveTripProps, contentDate?: Date): Promise<void>;
};

let current: { key: string; activity: Activity | null } | null = null;
let lastSent = "";

function iosFactory() {
  // Yerel modül yoksa (Expo Go, eski iOS) hata fırlatır; çağıran yakalar.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/widgets/TripActivity").default as {
    start(props: LiveTripProps, url?: string): Activity;
    getInstances(): Activity[];
  };
}

function androidFactory() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/widgets/TripNotification").default as {
    post(props: LiveTripProps, options?: Record<string, unknown>): Promise<unknown>;
    getActive(): Promise<unknown[]>;
    cancelAll(): Promise<void>;
  };
}

function iosSupported(): boolean {
  return Platform.OS === "ios" && Number.parseFloat(String(Platform.Version)) >= 16.2;
}

/**
 * Canlı etkinliği başlatır veya günceller. `key` yolculuğu tanımlar (rezervasyon kodu veya ayak);
 * başka bir yolculuğa geçilirse eskisi kapatılır. Aynı içerik tekrar gönderilmez.
 */
export async function showLiveTrip(key: string, props: LiveTripProps, url?: string): Promise<void> {
  const signature = `${key}|${JSON.stringify(props)}`;
  if (signature === lastSent) return;
  try {
    if (iosSupported()) {
      const factory = iosFactory();
      if (current && current.key !== key) {
        await current.activity?.end("immediate");
        current = null;
      }
      if (!current) {
        // Uygulama yeniden açıldıysa önceki etkinlik sürüyor olabilir: onu sürdür.
        const existing = factory.getInstances()[0] ?? null;
        current = { key, activity: existing ?? factory.start(props, url) };
        if (!existing) {
          lastSent = signature;
          return;
        }
      }
      await current.activity?.update(props);
    } else if (Platform.OS === "android") {
      await androidFactory().post(props, {
        id: ANDROID_ID,
        ongoing: true,
        title: props.title,
        text: [props.eta, props.detail].filter(Boolean).join(" · "),
        url,
        color: "#B8955A",
      });
      current = { key, activity: null };
    } else {
      return;
    }
    lastSent = signature;
    await storage.set(KEY_STORE, key).catch(() => undefined);
  } catch {
    // Canlı etkinlik yardımcı bir gösterim; başarısızlığı yolculuk akışını etkilemez.
  }
}

/**
 * Canlı etkinliği bitirir. `final` verilirse son durum (ör. "Tamamlandı") bir süre görünür kalır,
 * verilmezse (iptal) hemen kaldırılır.
 */
export async function endLiveTrip(key: string, final?: LiveTripProps): Promise<void> {
  // Başka bir yolculuğun etkinliği sürüyorsa ona dokunulmaz (uygulama yeniden başladıysa saklanan kimlik).
  const active = current?.key ?? (await storage.get(KEY_STORE).catch(() => null));
  if (active && active !== key) return;
  lastSent = "";
  try {
    if (iosSupported()) {
      const factory = iosFactory();
      const activities = current?.activity ? [current.activity] : factory.getInstances();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { after } = require("expo-widgets") as { after: (d: Date) => unknown };
      for (const a of activities) {
        await (final ? a.end(after(new Date(Date.now() + DONE_LINGER_MS)), final, new Date()) : a.end("immediate"));
      }
    } else if (Platform.OS === "android") {
      const factory = androidFactory();
      // Geçmişteki bir rezervasyona bakmak yeni bildirim açmasın: yalnızca etkin bildirim kapatılır.
      if ((await factory.getActive()).length === 0) {
        current = null;
        return;
      }
      if (final) {
        await factory.post(final, {
          id: ANDROID_ID, ongoing: false, autoCancel: true, timeoutAfter: DONE_LINGER_MS,
          title: final.title, text: final.detail, color: "#B8955A",
        });
      } else {
        await factory.cancelAll();
      }
    }
  } catch {
    // yok sayılır
  }
  current = null;
  await storage.remove(KEY_STORE).catch(() => undefined);
}

/** Yolculuk yakın mı: planlı işte etkinlik alışa 90 dk kala başlar. */
function soon(pickupAt: string | undefined, now: number): boolean {
  if (!pickupAt) return true;
  return new Date(pickupAt).getTime() - now <= SHOW_BEFORE_PICKUP_MS;
}

/** Kilit ekranında yolcunun yalnızca adı ve soyadının baş harfi (KVKK). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

// --- Ekran durumundan gösterime ------------------------------------------------

export interface CustomerLiveInput {
  bookingStatus: string;
  legStatus: string;
  from: string;
  to: string;
  driver: { first_name: string; vehicle: string; plate: string } | null;
  etaMinutes: number | null;
  /** "anlik" işte "sürücü aranıyor" hemen gösterilir; planlı işte alışa 90 dk kala. */
  bookingType?: string;
  pickupAt?: string;
  now?: number;
}

/**
 * Müşteri: ödeme bekleyen veya iptal edilen rezervasyonda gösterim yoktur (null);
 * tamamlanınca `done: true` döner, son durum kısa süre görünür kalır.
 */
export function customerLiveProps(x: CustomerLiveInput): { props: LiveTripProps; done: boolean } | null {
  if (["odeme_bekliyor", "odeme_basarisiz", "iptal"].includes(x.bookingStatus) || x.legStatus === "iptal") return null;
  const moving = ["yolda", "vardi", "basladi", "bitti"].includes(x.legStatus) || x.bookingStatus === "tamamlandi";
  if (!moving && x.bookingType !== "anlik" && !soon(x.pickupAt, x.now ?? Date.now())) return null;
  const route = `${x.from} → ${x.to}`;
  const car = x.driver ? [x.driver.first_name, x.driver.plate, x.driver.vehicle].filter(Boolean).join(" · ") : route;
  const min = x.etaMinutes ? t("live.min", { min: x.etaMinutes }) : "";
  const base = { role: "customer" as const, progress: STAGE_PROGRESS[x.legStatus] ?? 0.1 };
  if (x.bookingStatus === "tamamlandi" || x.legStatus === "bitti") {
    return { props: { ...base, progress: 1, title: t("leg.bitti"), detail: route, eta: t("live.done") }, done: true };
  }
  switch (x.legStatus) {
    case "beklemede":
      return { props: { ...base, title: t("live.searching"), detail: route, eta: "" }, done: false };
    case "yolda":
      return { props: { ...base, title: t("leg.yolda"), detail: car, eta: min }, done: false };
    case "vardi":
      return { props: { ...base, title: t("leg.vardi"), detail: car, eta: t("live.arrived") }, done: false };
    case "basladi":
      return { props: { ...base, title: t("track.onboard"), detail: `→ ${x.to}`, eta: min }, done: false };
    default:
      return { props: { ...base, title: t("leg.atandi"), detail: car, eta: "" }, done: false };
  }
}

export interface DriverLiveInput {
  status: string;
  pickup: string;
  dropoff: string;
  passenger: string;
  pickupTime: string;
  etaMinutes: number | null;
  pickupAt?: string;
  now?: number;
}

/**
 * Sürücü (yalnızca Türkçe): aktif iş boyunca aşama, hedef ve kalan süre. Kilit ekranında yolcunun
 * tam adı ve tam adresi gösterilmez (KVKK): ad + soyadın baş harfi, adres yerine ilçe.
 */
export function driverLiveProps(x: DriverLiveInput): { props: LiveTripProps; done: boolean } | null {
  if (x.status === "iptal") return null;
  if (x.status === "atandi" && !soon(x.pickupAt, x.now ?? Date.now())) return null;
  const min = x.etaMinutes ? `${x.etaMinutes} dk` : "";
  const base = { role: "driver" as const, progress: STAGE_PROGRESS[x.status] ?? 0.25 };
  switch (x.status) {
    case "yolda":
      return { props: { ...base, title: "Alışa gidiyorsunuz", detail: x.pickup, eta: min }, done: false };
    case "vardi":
      return { props: { ...base, title: "Alış noktasındasınız", detail: `Yolcu: ${shortName(x.passenger)}`, eta: "Geldi" }, done: false };
    case "basladi":
      return { props: { ...base, title: "Yolcu araçta", detail: `→ ${x.dropoff}`, eta: min }, done: false };
    case "bitti":
      return { props: { ...base, progress: 1, title: "Yolculuk tamamlandı", detail: `${x.pickup} → ${x.dropoff}`, eta: "Bitti" }, done: true };
    default:
      return { props: { ...base, title: "Yeni iş atandı", detail: `${x.pickup} · ${x.pickupTime}`, eta: "" }, done: false };
  }
}
