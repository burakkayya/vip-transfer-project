import type { ConfigContext, ExpoConfig } from "expo/config";
import { type ConfigPlugin, withInfoPlist } from "expo/config-plugins";

// Tek kod tabanından iki uygulama: müşteri (varsayılan) ve sürücü (APP_VARIANT=driver).
const variant = process.env.APP_VARIANT === "driver" ? "driver" : "customer";
const isDriver = variant === "driver";

// Geliştirmede telefonun backend'e ulaşabilmesi için bilgisayarın yerel ağ IP'si yazılır (ör. http://192.168.1.20:8000).
const apiUrl = process.env.GETAWAY_API_URL ?? "http://localhost:8000";
// Yasal metinler ve ödeme dönüşü için müşteri web sitesi. Mağaza derlemesinde https://getawaytransfers.com verilir.
const webUrl = process.env.GETAWAY_WEB_URL ?? "http://localhost:3000";
// Android Google Maps SDK anahtarı (react-native-maps). Yalnızca ortam değişkeninden okunur; tanımsızsa alan eklenmez.
// iOS varsayılan sağlayıcı Apple Maps'tir, anahtar gerekmez. Expo prebuild react-native-maps için yerleşik
// eklentiyi (android.config.googleMaps.apiKey) kendisi uygular; plugins listesine ayrıca eklenmez.
const googleMapsAndroidKey = process.env.GETAWAY_GOOGLE_MAPS_ANDROID_KEY;
const DRIVER_LOCATION_TEXT = "Aktif yolculukta konumunuz yalnızca yolcuyla paylaşılır.";
const DRIVER_BACKGROUND_TEXT =
  "Yolculuk sürerken uygulamadan çıksanız da konumunuz yolcuyla paylaşılır. Yolculuk bitince paylaşım durur.";
// iOS Google Maps SDK anahtarı (isteğe bağlı). Tanımlıysa iOS de Google Haritalar kullanır (MapCanvas, `extra.googleMapsIos`);
// tanımsızsa Apple Maps. Backend'in sunucu anahtarı buraya konmaz: bu anahtar uygulama paketinde taşınır, bundle ID ile kısıtlanır.
const googleMapsIosKey = process.env.GETAWAY_GOOGLE_MAPS_IOS_KEY;
// Firebase (FCM push): Firebase Console'dan indirilen google-services.json'un yolu (repo dışında durur).
// Tanımsızsa push jetonu alınmaz, uygulama içi bildirimler (yoklama) çalışmaya devam eder.
const googleServicesFile = process.env.GETAWAY_GOOGLE_SERVICES_FILE;

// Müşteri uygulaması konum kullanmaz (mobile/PRODUCT.md). Expo prebuild kurulu `react-native-maps` ve
// `expo-location` (sürücü için kurulu) paketlerinin yerleşik eklentileriyle iki çeşide de konum izni ve
// İngilizce varsayılan iOS açıklaması ekler. Müşteri çeşidinde Android izinleri `blockedPermissions` ile,
// iOS açıklamaları bu yerel eklentiyle kaldırılır. Bu eklentinin mod'u yerleşik eklentilerden önce
// kaydedildiği için en son çalışır.
const IOS_LOCATION_KEYS = [
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSLocationTemporaryUsageDescriptionDictionary",
];
const withoutLocationUsage: ConfigPlugin = (cfg) =>
  withInfoPlist(cfg, (mod) => {
    for (const key of IOS_LOCATION_KEYS) delete mod.modResults[key];
    return mod;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const app: ExpoConfig = {
    ...config,
    name: isDriver ? "Getaway Sürücü" : "Getaway Transfers",
    slug: isDriver ? "getaway-driver" : "getaway-transfers",
    scheme: isDriver ? "getawaydriver" : "getaway",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    ios: {
      bundleIdentifier: isDriver ? "com.getawaytransfers.driver" : "com.getawaytransfers.app",
      supportsTablet: false,
      // K-52: sürücü konumu yalnızca aktif yolculukta, uygulama arka plandayken de paylaşılır.
      infoPlist: isDriver
        ? {
            NSLocationWhenInUseUsageDescription: DRIVER_LOCATION_TEXT,
            NSLocationAlwaysAndWhenInUseUsageDescription: DRIVER_BACKGROUND_TEXT,
            NSLocationAlwaysUsageDescription: DRIVER_BACKGROUND_TEXT,
            UIBackgroundModes: ["location", "remote-notification"],
          }
        : { UIBackgroundModes: ["remote-notification"] },
    },
    android: {
      package: isDriver ? "com.getawaytransfers.driver" : "com.getawaytransfers.app",
      permissions: isDriver
        ? [
            "ACCESS_FINE_LOCATION",
            "ACCESS_COARSE_LOCATION",
            "ACCESS_BACKGROUND_LOCATION",
            "FOREGROUND_SERVICE",
            "FOREGROUND_SERVICE_LOCATION",
            "POST_NOTIFICATIONS",
          ]
        : ["POST_NOTIFICATIONS"],
      ...(isDriver
        ? {}
        : { blockedPermissions: ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"] }),
      ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-web-browser",
      "expo-localization",
      "@react-native-community/datetimepicker",
      "expo-task-manager",
      // defaultChannel: FCM bildirimi kanal belirtmeden ya da kanal henüz oluşturulmadan gelirse.
      ["expo-notifications", { color: "#0B0B0C", defaultChannel: "trip" }] as [string, object],
      // K-59: yolculuk durumu canlı etkinliği. iOS'ta Canlı Etkinlik uzantı hedefi (kilit ekranı,
      // Dynamic Island), Android'de özel bildirim modülü. Uzaktan (APNs) güncelleme şimdilik kapalı.
      ["expo-widgets", { frequentUpdates: true }] as [string, object],
      ...(isDriver
        ? [
            [
              "expo-location",
              {
                locationWhenInUsePermission: DRIVER_LOCATION_TEXT,
                locationAlwaysAndWhenInUsePermission: DRIVER_BACKGROUND_TEXT,
                locationAlwaysPermission: DRIVER_BACKGROUND_TEXT,
                isAndroidBackgroundLocationEnabled: true,
                isAndroidForegroundServiceEnabled: true,
                isIosBackgroundLocationEnabled: true,
              },
            ] as [string, object],
          ]
        : []),
    ],
    web: { bundler: "metro", output: "single" },
    experiments: { typedRoutes: false },
    extra: { variant, apiUrl, webUrl, googleMapsIos: Boolean(googleMapsIosKey) },
  };
  return isDriver ? app : withoutLocationUsage(app);
};
