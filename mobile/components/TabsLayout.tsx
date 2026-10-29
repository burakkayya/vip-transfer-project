import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VARIANT } from "@/lib/config";
import { useSession } from "@/lib/session";
import { IconName, colors } from "./ui";

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
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.line, paddingTop: 8, paddingBottom: bottom + 6, height: 60 + bottom },
        tabBarLabelStyle: { fontWeight: "600", fontSize: 11 },
      }}
    >
      {props.tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            // Başlık bandı (Hero) olan ekranlarda üst çubuk tekrar etmesin.
            headerShown: !tab.hero,
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={size} color={String(color)} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
