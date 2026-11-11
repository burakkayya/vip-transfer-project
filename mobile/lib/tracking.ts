// Sürücü konum paylaşımı (K-52). Aktif yolculukta (yola çıktım → bitti) konum yolcuyla paylaşılır.
// Geliştirme/mağaza derlemesinde uygulama arka plandayken de sürer: Android'de "Yolculuk sürüyor"
// kalıcı bildirimli ön plan hizmeti, iOS'ta arka plan konum modu. Expo Go arka plan konumunu
// desteklemez; orada ekran açıkken ön plan izlemesi kullanılır (trip/[legId].tsx).
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api, loadSession } from "./api";
import { endLiveTrip } from "./liveTrip";
import { storage } from "./storage";

export const LOCATION_TASK = "getaway-trip-location";
const LEG_KEY = "ga_tracking_leg";

/** Arka plan konumu bu ortamda kullanılabilir mi (Expo Go ve web'de hayır). */
export const backgroundSupported = Platform.OS !== "web" && Constants.executionEnvironment !== "storeClient";

type LocationTaskData = { locations?: Location.LocationObject[] };

if (backgroundSupported) {
  TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const legId = await storage.get(LEG_KEY);
    if (!legId) return;
    const pos = data.locations[data.locations.length - 1];
    // Süreç arka planda yeniden başlamış olabilir: jeton önce güvenli depodan okunur.
    await loadSession();
    const heading = pos.coords.heading !== null && pos.coords.heading >= 0 ? pos.coords.heading : null;
    await api(`driver/trips/${legId}/location`, {
      body: { lat: pos.coords.latitude, lng: pos.coords.longitude, heading },
    }).catch(async (e: { code?: string }) => {
      // Yolculuk bittiyse (veya iptal edildiyse) paylaşım kendiliğinden durur.
      // Canlı etkinlik de kapanır (uygulama kapalıyken iptal edilen yolculuk kilit ekranında kalmasın).
      if (e?.code === "trip_not_active" || e?.code === "not_found") {
        await stopBackgroundTracking();
        await endLiveTrip(legId);
      }
    });
  });
}

/** Arka plan izni ister ve paylaşımı başlatır. İzin yoksa false döner (ön plan izlemesi sürer). */
export async function startBackgroundTracking(legId: string): Promise<boolean> {
  if (!backgroundSupported) return false;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return false;
  await storage.set(LEG_KEY, legId);
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return true;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Yolculuk sürüyor",
      notificationBody: "Konumunuz bu yolculuk boyunca yolcuyla paylaşılıyor.",
      notificationColor: "#0B0B0C",
      killServiceOnDestroy: false,
    },
  });
  return true;
}

export async function stopBackgroundTracking(): Promise<void> {
  await storage.remove(LEG_KEY);
  if (!backgroundSupported) return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}

/** Telefonun harita uygulamasında hedefe yol tarifi (Android: Google Haritalar navigasyonu, iOS: Apple Haritalar). */
export function navigationUrls(lat: number, lng: number): string[] {
  const dest = `${lat},${lng}`;
  if (Platform.OS === "ios") {
    return [`maps://?daddr=${dest}&dirflg=d`, `https://maps.apple.com/?daddr=${dest}&dirflg=d`];
  }
  return [`google.navigation:q=${dest}&mode=d`, `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`];
}

/** Kuş uçuşu mesafe (metre). */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}
