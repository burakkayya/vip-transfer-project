// Getaway tasarım sistemi (mobil): siyah-beyaz zemin, sıcak altın vurgu, Inter yazı tipi.
import { palette } from "@/lib/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

/** K-38: anlamsal renkler ortak token kaynağından (kök DESIGN.md → lib/tokens.ts) gelir; burada sabit renk yazılmaz. */
export const colors = {
  ink: palette.lacquerBlack,
  ink2: palette.lacquerBlackRaised,
  bg: palette.paper,
  canvas: palette.harborCanvas,
  surface: palette.paper,
  text: palette.lacquerBlack,
  muted: palette.slateText,
  // Metin olabilecek en açık gri (The Text Floor Rule); süs çizgileri için `line`.
  faint: palette.slateFaint,
  line: palette.hairline,
  lineStrong: palette.hairlineStrong,
  brand: palette.lacquerBlack,
  brandSoft: palette.limestone,
  accent: palette.champagneBrass,
  accentInk: palette.champagneBrassInk,
  accentSoft: palette.champagneSoft,
  onAccent: palette.paper,
  danger: palette.signalRed,
  dangerSoft: palette.signalRedSoft,
  dangerOnDark: palette.signalRedOnDark,
  ok: palette.pineGreen,
  okSoft: palette.pineGreenSoft,
  okOnDark: palette.pineGreenOnDark,
  warn: palette.amberInk,
  warnSoft: palette.amberSoft,
};

export const radius = { sm: 12, md: 16, lg: 22, xl: 28 };

export const shadow = {
  card: Platform.select<ViewStyle>({
    web: { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" } as ViewStyle,
    default: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  }),
  float: Platform.select<ViewStyle>({
    web: { boxShadow: "0 12px 40px rgba(0,0,0,0.16)" } as ViewStyle,
    default: { shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  }),
};

// --- Yazı ----------------------------------------------------------------

const FAMILY: Record<string, string> = {
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  bold: "Inter_700Bold",
  "800": "Inter_800ExtraBold",
  "900": "Inter_800ExtraBold",
};

export const fonts = {
  regular: FAMILY["400"],
  medium: FAMILY["500"],
  semibold: FAMILY["600"],
  bold: FAMILY["700"],
  heavy: FAMILY["800"],
};

/** Metin: kalınlığa göre Inter ailesini seçer (Android'de fontWeight özel yazı tipiyle çalışmaz). */
export function T(props: TextProps & { style?: TextStyle | (TextStyle | false | null | undefined)[] }) {
  const flat = StyleSheet.flatten(props.style) ?? {};
  const weight = String(flat.fontWeight ?? "400");
  return <Text {...props} style={[{ color: colors.text, fontSize: 15 }, flat, { fontFamily: FAMILY[weight] ?? fonts.regular, fontWeight: undefined }]} />;
}

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={props.name} size={props.size ?? 20} color={props.color ?? colors.ink} />;
}

/** Ekran yüksekliği. Web önizlemesinde telefon çerçevesinin iç yüksekliği (en fazla 822) döner. */
export function useScreenHeight() {
  const { height } = useWindowDimensions();
  return Platform.OS === "web" ? Math.min(height - 54, 822) : height;
}

export function tap() {
  if (Platform.OS !== "web") void Haptics.selectionAsync();
}

// --- Yerleşim --------------------------------------------------------------

export function Screen(props: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; header?: React.ReactNode; canvas?: boolean; bottom?: React.ReactNode }) {
  return (
    <SafeAreaView style={[s.screen, props.canvas && { backgroundColor: colors.canvas }]} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={[s.scroll, props.header ? { paddingTop: 0 } : null, props.bottom ? { paddingBottom: 120 } : null]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          props.onRefresh ? <RefreshControl refreshing={props.refreshing ?? false} onRefresh={props.onRefresh} /> : undefined
        }
      >
        {props.header}
        {props.children}
      </ScrollView>
      {props.bottom ? <BottomBar>{props.bottom}</BottomBar> : null}
    </SafeAreaView>
  );
}

/** Ekranın altına sabitlenen eylem çubuğu (Uber'deki "Onayla" alanı). */
export function BottomBar(props: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>{props.children}</View>;
}

/** Getaway logosu: yol çizgisi monogramı + harf aralıklı yazı. */
export function Logo(props: { inverted?: boolean; size?: number; sub?: string }) {
  const size = props.size ?? 34;
  const fg = props.inverted ? "#fff" : colors.ink;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: props.inverted ? "#fff" : colors.ink, alignItems: "center", justifyContent: "center" }}>
        <T style={{ color: props.inverted ? colors.ink : "#fff", fontWeight: "800", fontSize: size * 0.54, marginTop: -1 }}>G</T>
        <View style={{ position: "absolute", right: size * 0.16, bottom: size * 0.16, width: size * 0.14, height: size * 0.14, borderRadius: 99, backgroundColor: colors.accent }} />
      </View>
      <View>
        <T style={{ color: fg, fontWeight: "800", letterSpacing: 4, fontSize: 15 }}>GETAWAY</T>
        <T style={{ color: props.inverted ? "rgba(255,255,255,0.6)" : colors.muted, letterSpacing: 4.5, fontSize: 9, marginTop: 2 }}>{props.sub ?? "TRANSFERS"}</T>
      </View>
    </View>
  );
}

/** Büyük başlık (Uber tarzı, beyaz zemin). */
export function Hero(props: { title: string; subtitle?: string; children?: React.ReactNode; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.hero, { paddingTop: 18 + insets.top }]}>
      <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={s.heroTitle}>{props.title}</T>
          {props.subtitle ? <T style={s.heroSubtitle}>{props.subtitle}</T> : null}
        </View>
        {props.right}
      </Row>
      {props.children}
    </View>
  );
}

export function Card(props: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; elevated?: boolean; delay?: number; flat?: boolean }) {
  return (
    <Animated.View
      entering={props.delay !== undefined ? FadeInDown.duration(420).delay(props.delay) : undefined}
      style={[s.card, props.elevated && s.elevated, props.flat && s.flat, props.style as ViewStyle]}
    >
      {props.children}
    </Animated.View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <T style={s.h1}>{children}</T>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <T style={s.h2}>{children}</T>;
}

export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <T style={[s.eyebrow, color ? { color } : null]}>{children}</T>;
}

export function P(props: { children: React.ReactNode; muted?: boolean; small?: boolean; bold?: boolean; center?: boolean; color?: string; numberOfLines?: number }) {
  return (
    <T
      numberOfLines={props.numberOfLines}
      style={[s.p, props.muted && s.muted, props.small && s.small, props.bold && { fontWeight: "700" }, props.center && { textAlign: "center" }, props.color ? { color: props.color } : null]}
    >
      {props.children}
    </T>
  );
}

export function Row(props: { children: React.ReactNode; spread?: boolean; style?: ViewStyle; gap?: number }) {
  return <View style={[s.row, props.spread && { justifyContent: "space-between" }, props.gap !== undefined && { gap: props.gap }, props.style]}>{props.children}</View>;
}

// --- Düğmeler --------------------------------------------------------------

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "danger" | "accent" | "light" | "ghost" | "onDark";
  icon?: IconName;
  iconRight?: IconName;
  small?: boolean;
  style?: ViewStyle;
}) {
  const v = props.variant ?? "primary";
  const fg = v === "secondary" || v === "light" || v === "ghost" ? colors.text : "#fff";
  // onDark: koyu kart üstünde çerçeveli, beyaz yazılı ikincil düğme.
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const off = props.disabled && !props.busy;
  return (
    <Animated.View style={[anim, props.style]}>
      <Pressable
        accessibilityRole="button"
        // Etiket yalnızca başlık: iOS aksi halde simge glifini de etikete katar (VoiceOver anlamsız karakter okur).
        accessibilityLabel={props.title}
        accessibilityState={{ disabled: !!(props.disabled || props.busy), busy: !!props.busy }}
        disabled={props.disabled || props.busy}
        onPressIn={() => (scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 20, stiffness: 400 }))}
        onPress={() => {
          tap();
          props.onPress();
        }}
        style={[
          s.btn,
          props.small && s.btnSmall,
          v === "secondary" && s.btnSecondary,
          v === "danger" && s.btnDanger,
          v === "accent" && s.btnAccent,
          v === "light" && s.btnLight,
          v === "ghost" && s.btnGhost,
          v === "onDark" && s.btnOnDark,
          off && s.btnDisabled,
          props.busy && { opacity: 0.75 },
        ]}
      >
        {props.busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={s.btnInner}>
            {props.icon ? <Ionicons name={props.icon} size={props.small ? 16 : 19} color={off ? colors.faint : fg} /> : null}
            <T style={[s.btnText, props.small && { fontSize: 14 }, { color: off ? colors.faint : fg }]}>{props.title}</T>
            {props.iconRight ? <Ionicons name={props.iconRight} size={props.small ? 16 : 19} color={off ? colors.faint : fg} /> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Yuvarlak ikon düğmesi (harita üstü geri, menü vb.). */
export function IconButton(props: { icon: IconName; onPress: () => void; label: string; dark?: boolean; size?: number; style?: ViewStyle }) {
  const size = props.size ?? 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      onPress={() => {
        tap();
        props.onPress();
      }}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: props.dark ? colors.ink : "#fff" },
        shadow.card,
        pressed && { transform: [{ scale: 0.94 }] },
        props.style,
      ]}
    >
      <Ionicons name={props.icon} size={size * 0.46} color={props.dark ? "#fff" : colors.ink} />
    </Pressable>
  );
}

// --- Form ------------------------------------------------------------------

export function Input(props: TextInputProps & { label: string; hint?: string; icon?: IconName }) {
  const { label, hint, style, icon, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      {label ? <T style={s.label}>{label}</T> : null}
      <View style={[s.inputWrap, focused && s.inputFocused]}>
        {icon ? <Ionicons name={icon} size={18} color={focused ? colors.ink : colors.muted} style={{ marginRight: 10 }} /> : null}
        <TextInput
          placeholderTextColor={colors.faint}
          style={[s.inputText, style]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
      </View>
      {hint ? <T style={s.hint}>{hint}</T> : null}
    </View>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; icon?: IconName }) {
  return (
    <Pressable style={s.toggle} onPress={() => props.onChange(!props.value)}>
      {props.icon ? <IconBubble name={props.icon} /> : null}
      <View style={{ flex: 1 }}>
        <T style={[s.p, { fontWeight: "600" }]}>{props.label}</T>
        {props.hint ? <T style={s.hint}>{props.hint}</T> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.ink, false: colors.lineStrong }} thumbColor="#fff" />
    </Pressable>
  );
}

/** Seçim kartı (onay kutusu yerine dokunmatik dostu). */
export function CheckCard(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; link?: { title: string; onPress: () => void } }) {
  return (
    <Pressable
      style={[s.checkCard, props.checked && s.checkCardOn]}
      onPress={() => {
        tap();
        props.onChange(!props.checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
    >
      <View style={[s.checkBox, props.checked && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
        {props.checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={[s.p, { fontSize: 14 }]}>{props.label}</T>
        {props.hint ? <T style={s.hint}>{props.hint}</T> : null}
        {props.link ? (
          <T style={s.link} onPress={props.link.onPress}>{props.link.title} ›</T>
        ) : null}
      </View>
    </Pressable>
  );
}

/** İki-üç seçenekli bölümlü düğme. */
export function Segmented<V extends string>(props: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; dark?: boolean }) {
  return (
    <View style={[s.segmented, props.dark && { backgroundColor: "rgba(255,255,255,0.1)" }]}>
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              tap();
              props.onChange(o.value);
            }}
            style={[s.segment, on && { backgroundColor: props.dark ? "#fff" : colors.ink }]}
          >
            <T style={{ fontWeight: "600", fontSize: 14, color: on ? (props.dark ? colors.ink : "#fff") : props.dark ? "rgba(255,255,255,0.7)" : colors.muted }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Gösterim --------------------------------------------------------------

export function Badge(props: { text: string; tone?: "ok" | "warn" | "danger" | "dark" | "accent" }) {
  const map = {
    ok: [colors.okSoft, colors.ok],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    dark: [colors.ink, "#fff"],
    accent: [colors.accentSoft, colors.accentInk],
  } as const;
  const [bg, fg] = props.tone ? map[props.tone] : [colors.brandSoft, colors.muted];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      {props.tone === "ok" ? <View style={[s.badgeDot, { backgroundColor: fg }]} /> : null}
      <T style={[s.badgeText, { color: fg }]}>{props.text}</T>
    </View>
  );
}

export function Alert(props: { text: string | null; tone?: "ok" | "danger" | "warn"; onPress?: () => void }) {
  if (!props.text) return null;
  const tone = props.tone ?? "danger";
  const bg = tone === "ok" ? colors.okSoft : tone === "warn" ? colors.warnSoft : colors.dangerSoft;
  const icon: IconName = tone === "ok" ? "checkmark-circle" : tone === "warn" ? "alert-circle" : "close-circle";
  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <Pressable onPress={props.onPress} style={[s.alert, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={20} color={colors[tone]} />
        <T style={{ color: colors[tone], flex: 1, fontSize: 14, fontWeight: "500" }}>{props.text}</T>
        {props.onPress ? <Ionicons name="chevron-forward" size={18} color={colors[tone]} /> : null}
      </Pressable>
    </Animated.View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 32 }} color={colors.ink} />;
}

/** Yükleme iskeleti (gri yanıp sönen blok). */
export function Skeleton(props: { height?: number; width?: number | `${number}%`; radius?: number; style?: ViewStyle }) {
  return <View style={[{ height: props.height ?? 16, width: props.width ?? "100%", borderRadius: props.radius ?? 8, backgroundColor: colors.brandSoft }, props.style]} />;
}

export function Divider(props: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4, marginLeft: props.inset ?? 0 }} />;
}

export function IconBubble(props: { name: IconName; dark?: boolean; size?: number; color?: string; bg?: string }) {
  const size = props.size ?? 40;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: props.bg ?? (props.dark ? colors.ink : colors.brandSoft) }}>
      <Ionicons name={props.name} size={size * 0.48} color={props.color ?? (props.dark ? "#fff" : colors.ink)} />
    </View>
  );
}

/** Etiket ve değer satırı (ikonlu). */
export function Info(props: { icon: IconName; children: React.ReactNode; label?: string }) {
  return (
    <View style={s.info}>
      <Ionicons name={props.icon} size={18} color={colors.muted} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {props.label ? <T style={s.hint}>{props.label}</T> : null}
        <T style={[s.p, { fontWeight: props.label ? "600" : "400" }]}>{props.children}</T>
      </View>
    </View>
  );
}

/** Menü satırı (profil, ayarlar). */
export function ListRow(props: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => [s.listRow, pressed && { backgroundColor: colors.brandSoft }]}
    >
      <IconBubble name={props.icon} size={38} color={props.danger ? colors.danger : undefined} bg={props.danger ? colors.dangerSoft : undefined} />
      <View style={{ flex: 1 }}>
        <T style={[s.p, { fontWeight: "600" }, props.danger && { color: colors.danger }]}>{props.title}</T>
        {props.subtitle ? <T style={s.hint} numberOfLines={1}>{props.subtitle}</T> : null}
      </View>
      {props.right ?? (props.onPress ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null)}
    </Pressable>
  );
}

/** Rota özeti: nokta–kesikli çizgi–kare (web formu ve harita ile aynı dil). */
export function RouteStops(props: { from: string; to: string; fromHint?: string; toHint?: string; compact?: boolean }) {
  const gap = props.compact ? 10 : 16;
  return (
    <View style={{ flexDirection: "row", gap: 14 }}>
      <View style={{ alignItems: "center", paddingTop: 6, paddingBottom: 6 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink }} />
        <View style={{ flex: 1, width: 0, borderLeftWidth: 2, borderStyle: "dashed", borderColor: colors.ink, marginVertical: 3, minHeight: gap }} />
        <View style={{ width: 10, height: 10, backgroundColor: colors.ink }} />
      </View>
      <View style={{ flex: 1, gap }}>
        <View>
          <T style={[s.p, { fontWeight: "600" }]} numberOfLines={1}>{props.from}</T>
          {props.fromHint ? <T style={s.hint} numberOfLines={1}>{props.fromHint}</T> : null}
        </View>
        <View>
          <T style={[s.p, { fontWeight: "600" }]} numberOfLines={1}>{props.to}</T>
          {props.toHint ? <T style={s.hint} numberOfLines={1}>{props.toHint}</T> : null}
        </View>
      </View>
    </View>
  );
}

/** Baş harfli yuvarlak avatar. */
export function Avatar(props: { name: string; size?: number; dark?: boolean }) {
  const size = props.size ?? 48;
  const initials = props.name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("") || "G";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: props.dark === false ? colors.accentSoft : colors.ink, alignItems: "center", justifyContent: "center" }}>
      <T style={{ color: props.dark === false ? colors.accentInk : "#fff", fontWeight: "700", fontSize: size * 0.38 }}>{initials}</T>
    </View>
  );
}

/** Adım göstergesi: ince ilerleme çubukları. */
export function Steps(props: { steps: string[]; current: number }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {props.steps.map((label, i) => (
          <View key={label} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= props.current ? colors.ink : colors.line }} />
        ))}
      </View>
      <T style={s.hint}>{`${props.current + 1}/${props.steps.length} · ${props.steps[props.current]}`}</T>
    </View>
  );
}

/** Yolculuk durum çizelgesi (dikey). */
export function Timeline(props: { steps: { key: string; label: string }[]; current: string }) {
  const idx = props.steps.findIndex((x) => x.key === props.current);
  return (
    <View>
      {props.steps.map((st, i) => (
        <View key={st.key} style={s.tlRow}>
          <View style={{ alignItems: "center", width: 22 }}>
            <View style={[s.tlDot, i <= idx && s.tlDotOn, i === idx && s.tlDotCurrent]}>
              {i < idx ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
            </View>
            {i < props.steps.length - 1 ? <View style={[s.tlLine, i < idx && { backgroundColor: colors.ink }]} /> : null}
          </View>
          <T style={[s.p, { paddingBottom: 16, fontSize: 14 }, i > idx && s.muted, i === idx && { fontWeight: "700" }]}>{st.label}</T>
        </View>
      ))}
    </View>
  );
}

/** Yatay ilerleme çubuğu (durum takibi). */
export function ProgressSegments(props: { total: number; done: number; color?: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: props.total }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < props.done ? props.color ?? colors.ink : colors.line }} />
      ))}
    </View>
  );
}

/** Açılır liste: seçenekler tam ekran listede gösterilir. */
export function Picker<T2 extends string | number>(props: {
  label: string;
  placeholder: string;
  value: T2 | null;
  options: { value: T2; label: string; section?: string }[];
  onChange: (v: T2) => void;
  icon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <View style={s.field}>
      {props.label ? <T style={s.label}>{props.label}</T> : null}
      <Pressable style={s.inputWrap} onPress={() => setOpen(true)}>
        {props.icon ? <Ionicons name={props.icon} size={18} color={colors.muted} style={{ marginRight: 10 }} /> : null}
        <T style={[s.inputText, { color: current ? colors.text : colors.faint }]} numberOfLines={1}>{current?.label ?? props.placeholder}</T>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <Row spread style={{ padding: 16 }}>
            <H2>{props.label || props.placeholder}</H2>
            <IconButton icon="close" label="Kapat" onPress={() => setOpen(false)} size={40} />
          </Row>
          <FlatList
            data={props.options}
            keyExtractor={(o) => String(o.value)}
            renderItem={({ item, index }) => (
              <View>
                {item.section && item.section !== props.options[index - 1]?.section ? <T style={s.section}>{item.section}</T> : null}
                <Pressable
                  style={[s.option, item.value === props.value && { backgroundColor: colors.brandSoft }]}
                  onPress={() => {
                    tap();
                    props.onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <T style={[s.p, item.value === props.value && { fontWeight: "600" }]}>{item.label}</T>
                  {item.value === props.value ? <Ionicons name="checkmark-circle" size={22} color={colors.ink} /> : null}
                </Pressable>
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 14, paddingBottom: 56 },
  hero: { backgroundColor: colors.bg, marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6, gap: 6 },
  heroTitle: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  heroSubtitle: { color: colors.muted, fontSize: 15 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 12 },
  elevated: { borderColor: "transparent", ...shadow.card },
  flat: { backgroundColor: colors.canvas, borderColor: "transparent" },
  h1: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.7 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase", color: colors.accent },
  p: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.muted },
  small: { fontSize: 13, lineHeight: 18 },
  link: { color: colors.ink, fontWeight: "600", marginTop: 2, textDecorationLine: "underline" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  btn: { backgroundColor: colors.ink, borderRadius: 14, minHeight: 56, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  btnSmall: { minHeight: 42, paddingHorizontal: 14, borderRadius: 12 },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnSecondary: { backgroundColor: colors.brandSoft },
  btnDanger: { backgroundColor: colors.danger },
  btnAccent: { backgroundColor: colors.ink },
  btnLight: { backgroundColor: "#fff" },
  btnGhost: { backgroundColor: "transparent" },
  btnOnDark: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
  btnText: { fontWeight: "700", fontSize: 16, letterSpacing: -0.2 },
  btnDisabled: { backgroundColor: palette.limestoneDeep },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  field: { gap: 7 },
  label: { fontWeight: "600", fontSize: 13, color: colors.text },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 17 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.brandSoft, borderRadius: 14, paddingHorizontal: 14, minHeight: 54, backgroundColor: colors.brandSoft },
  inputFocused: { borderColor: colors.ink, backgroundColor: "#fff" },
  inputText: { flex: 1, fontSize: 15.5, color: colors.text, paddingVertical: 13, fontFamily: fonts.medium, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}) },
  input: { borderWidth: 1.5, borderColor: colors.brandSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: colors.brandSoft, fontSize: 15, color: colors.text, fontFamily: fonts.medium },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
  checkCard: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: "#fff" },
  checkCardOn: { borderColor: colors.ink },
  checkBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center", marginTop: 1 },
  segmented: { flexDirection: "row", backgroundColor: colors.brandSoft, borderRadius: 999, padding: 4, alignSelf: "flex-start" },
  segment: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  alert: { flexDirection: "row", gap: 10, alignItems: "center", borderRadius: 14, padding: 13 },
  info: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 14 },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, fontWeight: "700", color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  option: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface },
  price: { fontSize: 22, fontWeight: "800", color: colors.ink, letterSpacing: -0.5 },
  tlRow: { flexDirection: "row", gap: 10 },
  tlDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.lineStrong, backgroundColor: "#fff", marginTop: 2, alignItems: "center", justifyContent: "center" },
  tlDotOn: { borderColor: colors.ink, backgroundColor: colors.ink },
  tlDotCurrent: { borderColor: colors.accent, backgroundColor: colors.accent },
  tlLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
});

export function statusTone(status: string): "ok" | "warn" | "danger" | undefined {
  if (["iptal", "odeme_basarisiz", "reddedildi", "suresi_doldu", "askida", "pasif"].includes(status)) return "danger";
  if (["odeme_bekliyor", "beklemede", "basvuru"].includes(status)) return "warn";
  if (["onaylandi", "atandi", "yolculukta", "tamamlandi", "onayli", "aktif", "odendi", "bitti", "yolda", "vardi", "basladi"].includes(status)) return "ok";
  return undefined;
}
