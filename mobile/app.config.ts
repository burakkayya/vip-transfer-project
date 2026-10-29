import type { ConfigContext, ExpoConfig } from "expo/config";

// Tek kod tabanından iki uygulama: müşteri (varsayılan) ve sürücü (APP_VARIANT=driver).
const variant = process.env.APP_VARIANT === "driver" ? "driver" : "customer";
const isDriver = variant === "driver";

// Geliştirmede telefonun backend'e ulaşabilmesi için bilgisayarın yerel ağ IP'si yazılır (ör. http://192.168.1.20:8000).
const apiUrl = process.env.GETAWAY_API_URL ?? "http://localhost:8000";
// Yasal metinler ve ödeme dönüşü için müşteri web sitesi. Mağaza derlemesinde https://getawaytransfers.com verilir.
const webUrl = process.env.GETAWAY_WEB_URL ?? "http://localhost:3000";

export default ({ config }: ConfigContext): ExpoConfig => ({
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
});
