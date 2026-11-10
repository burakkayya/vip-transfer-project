import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VARIANT } from "@/lib/config";
import { useSession } from "@/lib/session";
import { IconName, colors, fonts, tap } from "./ui";

/** Müşteri ve sürücü sekmeleri: çeşit ve oturum kontrolü ortak. */
export default function TabsLayout(props: {
  variant: "customer" | "driver";
  tabs: { name: string; title: string; icon: IconName; iconActive: IconName; hero?: boolean }[];
}) {
  const { ready, signedIn } = useSession();
  // Kenardan kenara çizimde sekme çubuğu sistem hareket alanının üstünde kalsın.
  const bottom = Math.max(useSafeAreaInsets().bottom, 8);
  if (VARIANT !== props.variant) return <Redirect href="/" />;
  if (ready && !signedIn) return <Redirect href="/login" />;
  return (
    <Tabs
      screenListeners={{ tabPress: () => tap() }}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17 },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { borderTopColor: colors.line, backgroundColor: "#fff", paddingTop: 6, paddingBottom: bottom, height: 72 + bottom },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, marginTop: 2 },
        // İkon kutusu varsayılanda iOS'ta 31x28, Android'de 24x24: seçili hap (yatay dolgulu) sığmayınca ikon
        // ince bir çizgiye eziliyordu (iOS simülatöründe görüldü). Kutu hap boyutuna büyütülür.
        tabBarIconStyle: { width: 56, height: 30 },
      }}
    >
      {props.tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            // Başlık bandı (Hero) veya harita olan ekranlarda üst çubuk tekrar etmesin.
            headerShown: !tab.hero,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ width: 56, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: focused ? colors.brandSoft : "transparent" }}>
                <Ionicons name={focused ? tab.iconActive : tab.icon} size={22} color={String(color)} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
