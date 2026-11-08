import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaInsetsContext, SafeAreaProvider } from "react-native-safe-area-context";
import { T, colors, fonts } from "@/components/ui";
import UpdatesWatcher from "@/components/UpdatesWatcher";
import { VARIANT } from "@/lib/config";
import { SessionProvider } from "@/lib/session";
// Arka plan konum görevi modül yüklenirken tanımlanmalı (uygulama arka planda yeniden başlatılabilir).
import "@/lib/tracking";

/** Web önizlemesi: uygulama gerçek telefon oranında (390×844) bir çerçevede gösterilir. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: "#E9E6DF", alignItems: "center", justifyContent: "center", paddingVertical: 16 }}>
      <T style={{ color: colors.muted, fontSize: 12, marginBottom: 10, letterSpacing: 1.5, fontWeight: "600" }}>
        {VARIANT === "driver" ? "GETAWAY SÜRÜCÜ" : "GETAWAY MÜŞTERİ"} · WEB ÖNİZLEME
      </T>
      <View
        style={{
          width: 390,
          maxWidth: "100%",
          height: 844,
          maxHeight: "100%",
          borderRadius: 52,
          overflow: "hidden",
          borderWidth: 11,
          borderColor: "#0B0B0C",
          backgroundColor: colors.bg,
          boxShadow: "0 40px 80px rgba(0,0,0,0.25)",
        } as object}
      >
        {/* Gerçek telefondaki çentik ve alt çubuk payı (web'de güvenli alan 0 gelir). */}
        <SafeAreaInsetsContext.Provider value={{ top: 44, bottom: 22, left: 0, right: 0 }}>{children}</SafeAreaInsetsContext.Provider>
        <View pointerEvents="none" style={{ position: "absolute", top: 10, alignSelf: "center", width: 112, height: 32, borderRadius: 20, backgroundColor: "#0B0B0C" }} />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <PhoneFrame>
            <StatusBar style="dark" />
            <UpdatesWatcher />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.ink,
                headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17 },
                headerShadowVisible: false,
                headerBackButtonDisplayMode: "minimal",
                contentStyle: { backgroundColor: colors.bg },
                animation: "slide_from_right",
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
              <Stack.Screen name="(customer)" options={{ headerShown: false }} />
              <Stack.Screen name="(driver)" options={{ headerShown: false }} />
              <Stack.Screen name="booking/[code]" options={{ headerShown: false }} />
              <Stack.Screen name="trip/[legId]" options={{ headerShown: false }} />
              <Stack.Screen name="job/[legId]" options={{ headerShown: false, animation: "slide_from_bottom" }} />
              <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="driver-register" options={{ title: "Sürücü kaydı" }} />
            </Stack>
          </PhoneFrame>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
