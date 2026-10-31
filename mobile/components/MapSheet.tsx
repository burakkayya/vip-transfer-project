// Harita + alt panel düzeni (Uber/Bolt): harita üstte, içerik yuvarlak köşeli panelde.
// Panel yukarı kaydırıldıkça haritanın üstüne çıkar; harita hafif paralaksla geride kalır.
import { RefreshControl, StyleSheet, View } from "react-native";
import Animated, { FadeInUp, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomBar, colors, shadow, useScreenHeight } from "./ui";

export default function MapSheet(props: {
  map: React.ReactNode;
  children: React.ReactNode;
  /** Haritanın ekran yüksekliğine oranı (panel bu noktadan başlar). */
  mapRatio?: number;
  /** Harita üstünde yüzen öğeler (geri düğmesi, durum etiketi). */
  overlay?: React.ReactNode;
  bottom?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  dark?: boolean;
}) {
  const height = useScreenHeight();
  const insets = useSafeAreaInsets();
  const mapH = Math.round(height * (props.mapRatio ?? 0.42));
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const mapStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(y.value, [0, mapH], [0, -mapH * 0.35], "clamp") }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, mapH * 0.5], [1, 0], "clamp") }));
  const bg = props.dark ? colors.ink : colors.bg;

  return (
    <View style={{ flex: 1, backgroundColor: bg, overflow: "hidden" }}>
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 0, height: mapH + 40 }, mapStyle]}>{props.map}</Animated.View>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: mapH - 26, minHeight: height + mapH * 0.5 }}
        refreshControl={props.onRefresh ? <RefreshControl refreshing={props.refreshing ?? false} onRefresh={props.onRefresh} progressViewOffset={mapH - 26} /> : undefined}
      >
        <Animated.View entering={FadeInUp.duration(500)} style={[st.sheet, { backgroundColor: bg, paddingBottom: (props.bottom ? 130 : 40) + insets.bottom }, shadow.float]}>
          <View style={[st.handle, props.dark && { backgroundColor: "rgba(255,255,255,0.2)" }]} />
          {props.children}
        </Animated.View>
      </Animated.ScrollView>
      {props.overlay ? (
        <Animated.View pointerEvents="box-none" style={[st.overlay, { top: insets.top + 10 }, overlayStyle]}>
          {props.overlay}
        </Animated.View>
      ) : null}
      {props.bottom ? <BottomBar>{props.bottom}</BottomBar> : null}
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, gap: 14, flexGrow: 1 },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 6 },
  overlay: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
