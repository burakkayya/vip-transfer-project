// Bildirimler (K-51). Backend olayları `trip_updates` akışına yazar; uygulama akışı yoklayıp yerel
// bildirim gösterir. Push sağlayıcısı (FCM) açılınca cihaz jetonu backend'e kaydedilir ve uygulama
// tamamen kapalıyken de aynı metin push olarak gelir. Expo Go'da uzak push yoktur; yerel bildirim çalışır.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { VARIANT } from "./config";

export const TRIP_CHANNEL = "trip";
let configured = false;
let channelReady = false;

/** Bildirim izni ve Android kanalı. Uygulama açıkken de bildirim üstte görünür. */
export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!configured) {
    configured = true;
    Notifications.setNotificationHandler({
      // Uygulama açıkken aynı olay yoklamadan yerel bildirim olarak gösterilir; ön plana gelen FCM
      // push'u (yolculuk akışı olayı) ikinci kez gösterilmez. Teklif gibi akışta olmayan push'lar gösterilir.
      handleNotification: async (n) => {
        const trigger = n.request.trigger as { type?: string } | null;
        const remoteDuplicate = trigger?.type === "push" && Boolean(n.request.content.data?.update_id);
        return {
          shouldShowBanner: !remoteDuplicate,
          shouldShowList: !remoteDuplicate,
          shouldPlaySound: !remoteDuplicate,
          shouldSetBadge: false,
        };
      },
    });
    // Expo Go Android'de özel kanal oluşturmayı reddediyor (yerel NPE); orada varsayılan kanal kullanılır.
    if (Platform.OS === "android" && Constants.executionEnvironment !== "storeClient") {
      // Kanal oluşturulamazsa (ör. Expo Go'da bazı alanlar reddedilir) varsayılan kanal kullanılır.
      try {
        // import/namespace TS enum'larını çözemiyor; değerler expo-notifications tiplerinde tanımlı.
        /* eslint-disable import/namespace */
        await Notifications.setNotificationChannelAsync(TRIP_CHANNEL, {
          name: VARIANT === "driver" ? "Yolculuk ve mesajlar" : "Trip updates",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 150, 250],
        });
        /* eslint-enable import/namespace */
        channelReady = true;
      } catch {
        channelReady = false;
      }
    }
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * `id` olay kimliğidir (trip_updates.id). Android'de bildirim etiketi olur; aynı olay FCM push'u olarak da
 * geldiyse (backend `tag` = aynı kimlik) biri diğerinin yerine geçer, kullanıcı tek bildirim görür.
 */
export async function showLocal(title: string, body: string, data: Record<string, unknown> = {}, id?: string) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    ...(id ? { identifier: id } : {}),
    // Android'de ses kanaldan gelir; `sound` verilirse "default" adlı özel ses dosyası aranır.
    content: { title, body, data, ...(Platform.OS === "ios" ? { sound: true } : {}) },
    trigger: Platform.OS === "android" && channelReady ? { channelId: TRIP_CHANNEL } : null,
  });
}

let deviceToken: string | null = null;
/** Bu cihazın kayıtlı push jetonu; çıkışta backend'e verilir, hesaptan silinir. */
export function registeredPushToken(): string | null {
  return deviceToken;
}
export function clearRegisteredPushToken(): void {
  deviceToken = null;
}

/** Cihaz push jetonunu backend'e kaydeder. FCM yapılandırılmamışsa (Expo Go, google-services yok) sessizce geçer. */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === "web" || Constants.executionEnvironment === "storeClient") return;
  // iOS'ta cihaz jetonu APNs jetonudur, FCM kabul etmez (Firebase iOS/APNs kurulumu açık konu, K-56).
  // Kaydedilirse her olayda geçersiz sayılıp silinirdi; iOS şimdilik uygulama içi bildirimle çalışır.
  if (Platform.OS !== "android") return;
  try {
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== "string" || !token) return;
    await api(VARIANT === "driver" ? "driver/me/push-token" : "me/push-token", { body: { token } });
    deviceToken = token;
  } catch {
    // FCM projesi henüz yok (docs/acik_konular.md): yerel bildirimler çalışmaya devam eder.
  }
}

/**
 * Bildirim çekmecesinde zaten duran olay kimlikleri (FCM push'u ya da daha önce gösterilen yerel bildirim).
 * Uygulama ön plana dönünce yoklama aynı olayı yeniden çeker; bunlar ikinci kez çalmasın diye atlanır.
 */
export async function presentedUpdateIds(): Promise<Set<string>> {
  if (Platform.OS === "web") return new Set();
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const ids = new Set<string>();
    for (const n of shown) {
      ids.add(n.request.identifier);
      const id = n.request.content.data?.update_id;
      if (typeof id === "string") ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/** Açık sohbet (sürücüde bacak kimliği, müşteride rezervasyon kodu): o sohbetin mesaj bildirimi gösterilmez. */
let activeChat: string | null = null;
export function setActiveChat(id: string | null) {
  activeChat = id;
}
export function isActiveChat(data: { leg_id?: string; booking_code?: string }): boolean {
  return activeChat !== null && (data.leg_id === activeChat || data.booking_code === activeChat);
}
