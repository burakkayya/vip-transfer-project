import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/components/ui";
import { VARIANT } from "@/lib/config";
import { SessionProvider } from "@/lib/session";

/** Web önizlemesi (VS Code içinde): uygulama telefon boyutunda bir çerçevede gösterilir. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: "#dcd8ce", alignItems: "center", justifyContent: "center", paddingVertical: 16 }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
        {VARIANT === "driver" ? "Sürücü uygulaması" : "Müşteri uygulaması"} · web önizleme
      </Text>
      <View
        style={{
          width: 390,
          maxWidth: "100%",
          height: 844,
          maxHeight: "100%",
          borderRadius: 36,
          overflow: "hidden",
          borderWidth: 10,
          borderColor: "#111",
          backgroundColor: colors.bg,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PhoneFrame>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontWeight: "700" },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(customer)" options={{ headerShown: false }} />
            <Stack.Screen name="(driver)" options={{ headerShown: false }} />
            <Stack.Screen name="booking/[code]" options={{ title: "" }} />
            <Stack.Screen name="trip/[legId]" options={{ title: "Yolculuk" }} />
            <Stack.Screen name="driver-register" options={{ title: "Sürücü kaydı" }} />
          </Stack>
        </PhoneFrame>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
