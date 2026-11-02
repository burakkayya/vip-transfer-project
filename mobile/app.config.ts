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
      infoPlist: isDriver
        ? { NSLocationWhenInUseUsageDescription: "Aktif yolculukta konumunuz yalnızca yolcuyla paylaşılır." }
        : {},
    },
    android: {
      package: isDriver ? "com.getawaytransfers.driver" : "com.getawaytransfers.app",
      permissions: isDriver ? ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"] : [],
      ...(isDriver
        ? {}
        : { blockedPermissions: ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"] }),
      ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-web-browser",
      "expo-localization",
      "@react-native-community/datetimepicker",
      ...(isDriver
        ? [["expo-location", { locationWhenInUsePermission: "Aktif yolculukta konumunuz yalnızca yolcuyla paylaşılır." }] as [string, object]]
        : []),
    ],
    web: { bundler: "metro", output: "single" },
    experiments: { typedRoutes: false },
    extra: { variant, apiUrl, webUrl },
  };
  return isDriver ? app : withoutLocationUsage(app);
};
