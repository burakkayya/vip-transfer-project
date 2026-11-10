import type { ConfigContext, ExpoConfig } from "expo/config";
import { type ConfigPlugin, withAndroidManifest, withAppDelegate, withInfoPlist, withPodfile } from "expo/config-plugins";

// Tek kod tabanından iki uygulama: müşteri (varsayılan) ve sürücü (APP_VARIANT=driver).
const variant = process.env.APP_VARIANT === "driver" ? "driver" : "customer";
const isDriver = variant === "driver";

// Geliştirmede telefonun backend'e ulaşabilmesi için bilgisayarın yerel ağ IP'si yazılır (ör. http://192.168.1.20:8000).
const apiUrl = process.env.GETAWAY_API_URL ?? "http://localhost:8000";
// Yasal metinler ve ödeme dönüşü için müşteri web sitesi. Mağaza derlemesinde https://getawaytransfers.com verilir.
const webUrl = process.env.GETAWAY_WEB_URL ?? "http://localhost:3000";
// Haritayla ilgili her şey Google (K-58, 2026-11-10 kullanıcı kararı; yedek harita yok): iOS ve Android
// Google Maps SDK kullanır (react-native-maps PROVIDER_GOOGLE). Anahtarlar yalnızca ortam değişkeninden okunur,
// repoya yazılmaz; yerli derleme (prebuild/run/EAS) anahtar olmadan başlamaz.
// Android Google Maps SDK anahtarı (paket adı + SHA-1 kısıtlı).
const googleMapsAndroidKey = process.env.GETAWAY_GOOGLE_MAPS_ANDROID_KEY;
const DRIVER_LOCATION_TEXT = "Aktif yolculukta konumunuz yalnızca yolcuyla paylaşılır.";
const DRIVER_BACKGROUND_TEXT =
  "Yolculuk sürerken uygulamadan çıksanız da konumunuz yolcuyla paylaşılır. Yolculuk bitince paylaşım durur.";
// iOS Google Maps SDK anahtarı (bundle ID kısıtlı). MapCanvas iOS'ta da Google Haritalar kullanır (`extra.googleMapsIos`);
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

// Yalnızca CI/emülatör testi: Android sürüm (release) derlemesi düz HTTP'yi engeller; emülatördeki uygulama
// bilgisayardaki backend'e http://10.0.2.2:8000 ile ulaşır. Mağaza derlemesinde bu değişken verilmez.
const allowCleartext = process.env.GETAWAY_ANDROID_CLEARTEXT === "1";
const withCleartext: ConfigPlugin = (cfg) =>
  withAndroidManifest(cfg, (mod) => {
    const appNode = mod.modResults.manifest.application?.[0];
    if (appNode) appNode.$["android:usesCleartextTraffic"] = "true";
    return mod;
  });

// iOS'ta Google Maps SDK (K-58). react-native-maps'in kendi Expo eklentisi bu Expo sürümünde kaldırılmış bir
// iç modülü (`@expo/config-plugins/build/plugins/ios-plugins`) istediği için çalışmıyor; aynı üç adım burada:
// Podfile'a GoogleMaps alt podu, Info.plist'e anahtar, AppDelegate'te GMSServices başlatması.
const withGoogleMapsIos = (cfg: ExpoConfig, apiKey: string): ExpoConfig => {
  let out = withInfoPlist(cfg, (mod) => {
    mod.modResults.GMSApiKey = apiKey;
    return mod;
  });
  out = withPodfile(out, (mod) => {
    const marker = "# getaway: react-native-maps/Google";
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /^(\s*)(config = use_native_modules)/m,
        `$1${marker}\n$1rn_maps_path = File.dirname(\`node --print "require.resolve('react-native-maps/package.json')"\`)\n` +
          `$1pod 'react-native-maps/Google', :path => rn_maps_path\n$1$2`,
      );
    }
    return mod;
  });
  out = withAppDelegate(out, (mod) => {
    let src = mod.modResults.contents;
    if (!src.includes("import GoogleMaps")) {
      src = src.replace(/^(@main|@UIApplicationMain)/m, "#if canImport(GoogleMaps)\nimport GoogleMaps\n#endif\n$1");
    }
    if (!src.includes("GMSServices.provideAPIKey")) {
      src = src.replace(
        /^(\s*)(return super\.application\(\w+, didFinishLaunchingWithOptions: \w+\))/m,
        `$1#if canImport(GoogleMaps)\n$1GMSServices.provideAPIKey("${apiKey}")\n$1#endif\n$1$2`,
      );
    }
    mod.modResults.contents = src;
    return mod;
  });
  return out;
};

// Yerli derleme Google Maps anahtarı olmadan başlamaz (sahte/boş harita yerine açık hata).
const cli = process.argv.slice(1).join(" ");
const nativeBuild = Boolean(process.env.EAS_BUILD_PLATFORM) || /\b(prebuild|run:android|run:ios)\b/.test(cli);
if (nativeBuild) {
  const target = process.env.EAS_BUILD_PLATFORM ?? (/\bios\b/.test(cli) ? "ios" : /\bandroid\b/.test(cli) ? "android" : "all");
  if ((target === "android" || target === "all") && !googleMapsAndroidKey) {
    throw new Error("GETAWAY_GOOGLE_MAPS_ANDROID_KEY tanımlı değil: Android derlemesi Google Haritalar anahtarı ister.");
  }
  if ((target === "ios" || target === "all") && !googleMapsIosKey) {
    throw new Error("GETAWAY_GOOGLE_MAPS_IOS_KEY tanımlı değil: iOS derlemesi Google Haritalar anahtarı ister.");
  }
}

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
      ...(googleServicesFile ? { googleServicesFile } : {}),
      // Google Maps SDK anahtarı: Expo'nun yerleşik eklentisi manifeste yazar (react-native-maps).
      ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
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
    extra: {
      variant, apiUrl, webUrl,
      googleMapsIos: Boolean(googleMapsIosKey),
      googleMapsAndroid: Boolean(googleMapsAndroidKey),
    },
  };
  const withVariant = isDriver ? app : withoutLocationUsage(app);
  const withMaps = googleMapsIosKey ? withGoogleMapsIos(withVariant, googleMapsIosKey) : withVariant;
  return allowCleartext ? withCleartext(withMaps) : withMaps;
};
