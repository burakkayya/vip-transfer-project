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
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
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

export async function showLocal(title: string, body: string, data: Record<string, unknown> = {}) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: true },
    trigger: Platform.OS === "android" && channelReady ? { channelId: TRIP_CHANNEL } : null,
  });
}

/** Cihaz push jetonunu backend'e kaydeder. FCM yapılandırılmamışsa (Expo Go, google-services yok) sessizce geçer. */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === "web" || Constants.executionEnvironment === "storeClient") return;
  try {
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== "string" || !token) return;
    await api(VARIANT === "driver" ? "driver/me/push-token" : "me/push-token", { body: { token } });
  } catch {
    // FCM projesi henüz yok (docs/acik_konular.md): yerel bildirimler çalışmaya devam eder.
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
