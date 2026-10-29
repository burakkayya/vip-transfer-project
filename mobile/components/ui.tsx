import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export const colors = {
  ink: "#000000",
  bg: "#ffffff",
  surface: "#ffffff",
  text: "#000000",
  muted: "#6b6b6b",
  line: "#ececec",
  brand: "#000000",
  brandSoft: "#f3f3f3",
  accent: "#a8875a",
  accentInk: "#ffffff",
  danger: "#c0261d",
  ok: "#18794e",
  warn: "#8a6100",
};

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={props.name} size={props.size ?? 20} color={props.color ?? colors.brand} />;
}

export function Screen(props: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; header?: React.ReactNode }) {
  return (
    <SafeAreaView style={s.screen} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={[s.scroll, props.header ? { paddingTop: 0 } : null]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          props.onRefresh ? <RefreshControl refreshing={props.refreshing ?? false} onRefresh={props.onRefresh} /> : undefined
        }
      >
        {props.header}
        {props.children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Getaway logosu: monogram + harf aralıklı yazı. */
export function Logo(props: { inverted?: boolean; size?: number }) {
  const size = props.size ?? 34;
  const fg = props.inverted ? "#fff" : colors.ink;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: props.inverted ? "#fff" : colors.ink, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: props.inverted ? colors.ink : "#fff", fontWeight: "800", fontSize: size * 0.56, marginTop: -1 }}>G</Text>
      </View>
      <View>
        <Text style={{ color: fg, fontWeight: "800", letterSpacing: 4, fontSize: 16 }}>GETAWAY</Text>
        <Text style={{ color: props.inverted ? "rgba(255,255,255,0.6)" : colors.muted, letterSpacing: 5, fontSize: 9, marginTop: 2 }}>TRANSFERS</Text>
      </View>
    </View>
  );
}

/** Ekranın üst kısmındaki büyük başlık (Uber tarzı, beyaz zemin). */
export function Hero(props: { title: string; subtitle?: string; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.hero, { paddingTop: 22 + insets.top }]}>
      <Text style={s.heroTitle}>{props.title}</Text>
      {props.subtitle ? <Text style={s.heroSubtitle}>{props.subtitle}</Text> : null}
      {props.children}
    </View>
  );
}

export function Card(props: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; elevated?: boolean }) {
  return <View style={[s.card, props.elevated && s.elevated, props.style as ViewStyle]}>{props.children}</View>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}

export function P(props: { children: React.ReactNode; muted?: boolean; small?: boolean; bold?: boolean; center?: boolean }) {
  return (
    <Text style={[s.p, props.muted && s.muted, props.small && s.small, props.bold && { fontWeight: "700" }, props.center && { textAlign: "center" }]}>
      {props.children}
    </Text>
  );
}

export function Row(props: { children: React.ReactNode; spread?: boolean; style?: ViewStyle }) {
  return <View style={[s.row, props.spread && { justifyContent: "space-between" }, props.style]}>{props.children}</View>;
}

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "danger" | "accent";
  icon?: IconName;
}) {
  const v = props.variant ?? "primary";
  const fg = v === "secondary" ? colors.text : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.btn,
        v === "secondary" && s.btnSecondary,
        v === "danger" && s.btnDanger,
        v === "accent" && s.btnAccent,
        props.disabled && !props.busy && s.btnDisabled,
        props.busy && { opacity: 0.7 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={s.btnInner}>
          {props.icon ? <Ionicons name={props.icon} size={18} color={props.disabled ? "#a3a3a3" : fg} /> : null}
          <Text style={[s.btnText, { color: props.disabled ? "#a3a3a3" : fg }]}>{props.title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string; hint?: string; icon?: IconName }) {
  const { label, hint, style, icon, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={[s.inputWrap, focused && s.inputFocused]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.muted} style={{ marginRight: 8 }} /> : null}
        <TextInput
          placeholderTextColor="#9aa0a6"
          style={[s.inputText, style]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Pressable style={s.toggle} onPress={() => props.onChange(!props.value)}>
      <View style={{ flex: 1 }}>
        <Text style={s.p}>{props.label}</Text>
        {props.hint ? <Text style={s.hint}>{props.hint}</Text> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.ink, false: "#d9d9d9" }} thumbColor="#fff" />
    </Pressable>
  );
}

/** Seçim kartı (onay kutusu yerine dokunmatik dostu). */
export function CheckCard(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; link?: { title: string; onPress: () => void } }) {
  return (
    <Pressable style={[s.checkCard, props.checked && s.checkCardOn]} onPress={() => props.onChange(!props.checked)} accessibilityRole="checkbox" accessibilityState={{ checked: props.checked }}>
      <Ionicons name={props.checked ? "checkbox" : "square-outline"} size={22} color={props.checked ? colors.brand : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.p}>{props.label}</Text>
        {props.hint ? <Text style={s.hint}>{props.hint}</Text> : null}
        {props.link ? (
          <Text style={s.link} onPress={props.link.onPress}>{props.link.title} ›</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Badge(props: { text: string; tone?: "ok" | "warn" | "danger" }) {
  const c = props.tone ? colors[props.tone] : colors.muted;
  const bg = props.tone === "ok" ? "#e1f2e8" : props.tone === "warn" ? "#fbf0d4" : props.tone === "danger" ? "#fbe2df" : "#eeebe4";
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: c }]}>{props.text}</Text>
    </View>
  );
}

export function Alert(props: { text: string | null; tone?: "ok" | "danger" | "warn"; onPress?: () => void }) {
  if (!props.text) return null;
  const tone = props.tone ?? "danger";
  const bg = tone === "ok" ? "#edf7f1" : tone === "warn" ? "#fdf7e8" : "#fdf0ef";
  const icon: IconName = tone === "ok" ? "checkmark-circle" : tone === "warn" ? "alert-circle" : "close-circle";
  return (
    <Pressable onPress={props.onPress} style={[s.alert, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color={colors[tone]} />
      <Text style={{ color: colors[tone], flex: 1 }}>{props.text}</Text>
    </Pressable>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4 }} />;
}

/** Etiket ve değer satırı (ikonlu). */
export function Info(props: { icon: IconName; children: React.ReactNode }) {
  return (
    <View style={s.info}>
      <Ionicons name={props.icon} size={18} color={colors.muted} />
      <Text style={[s.p, { flex: 1 }]}>{props.children}</Text>
    </View>
  );
}

/** Adım göstergesi. */
export function Steps(props: { steps: string[]; current: number }) {
  return (
    <View style={s.steps}>
      {props.steps.map((label, i) => (
        <View key={label} style={s.stepItem}>
          <View style={[s.stepDot, i <= props.current && s.stepDotOn]}>
            {i < props.current ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Text style={[s.stepNum, i <= props.current && { color: "#fff" }]}>{i + 1}</Text>}
          </View>
          <Text style={[s.stepLabel, i === props.current && { color: colors.ink, fontWeight: "700" }]} numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Yolculuk durum çizelgesi. */
export function Timeline(props: { steps: { key: string; label: string }[]; current: string }) {
  const idx = props.steps.findIndex((x) => x.key === props.current);
  return (
    <View style={{ gap: 0 }}>
      {props.steps.map((st, i) => (
        <View key={st.key} style={s.tlRow}>
          <View style={{ alignItems: "center", width: 22 }}>
            <View style={[s.tlDot, i <= idx && s.tlDotOn, i === idx && s.tlDotCurrent]} />
            {i < props.steps.length - 1 ? <View style={[s.tlLine, i < idx && { backgroundColor: colors.brand }]} /> : null}
          </View>
          <Text style={[s.p, { paddingBottom: 14 }, i > idx && s.muted, i === idx && { fontWeight: "700" }]}>{st.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Açılır liste: seçenekler tam ekran listede gösterilir. */
export function Picker<T extends string | number>(props: {
  label: string;
  placeholder: string;
  value: T | null;
  options: { value: T; label: string; section?: string }[];
  onChange: (v: T) => void;
  icon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <View style={s.field}>
      {props.label ? <Text style={s.label}>{props.label}</Text> : null}
      <Pressable style={s.inputWrap} onPress={() => setOpen(true)}>
        {props.icon ? <Ionicons name={props.icon} size={18} color={colors.muted} style={{ marginRight: 8 }} /> : null}
        <Text style={[s.inputText, { color: current ? colors.text : "#9aa0a6" }]} numberOfLines={1}>{current?.label ?? props.placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <Row spread style={{ padding: 16 }}>
            <H2>{props.label || props.placeholder}</H2>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </Row>
          <FlatList
            data={props.options}
            keyExtractor={(o) => String(o.value)}
            renderItem={({ item, index }) => (
              <View>
                {item.section && item.section !== props.options[index - 1]?.section ? <Text style={s.section}>{item.section}</Text> : null}
                <Pressable
                  style={[s.option, item.value === props.value && { backgroundColor: colors.brandSoft }]}
                  onPress={() => {
                    props.onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Text style={s.p}>{item.label}</Text>
                  {item.value === props.value ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
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
  scroll: { padding: 16, gap: 14, paddingBottom: 56 },
  hero: { backgroundColor: colors.bg, marginHorizontal: -16, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8, gap: 6 },
  heroTitle: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.8 },
  heroSubtitle: { color: colors.muted, fontSize: 15 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 },
  elevated: { borderColor: colors.line, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  h1: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  h2: { fontSize: 17, fontWeight: "700", color: colors.ink },
  p: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.muted },
  small: { fontSize: 13, lineHeight: 18 },
  link: { color: colors.brand, fontWeight: "600", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  btn: { backgroundColor: colors.brand, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: "center", borderWidth: 1, borderColor: colors.brand },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnSecondary: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnAccent: { backgroundColor: colors.ink, borderColor: colors.ink },
  btnText: { fontWeight: "700", fontSize: 16 },
  btnDisabled: { backgroundColor: "#ececec", borderColor: "#ececec" },
  field: { gap: 6 },
  label: { fontWeight: "600", fontSize: 13, color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.brandSoft, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, backgroundColor: colors.brandSoft },
  inputFocused: { borderColor: colors.ink, backgroundColor: "#fff" },
  inputText: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 12 },
  // Eski ekranlarla uyum için düz giriş stili.
  input: { borderWidth: 1.5, borderColor: colors.brandSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: colors.brandSoft, fontSize: 15, color: colors.text },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12 },
  checkCard: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, backgroundColor: "#fff" },
  checkCardOn: { borderColor: colors.ink },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "700" },
  alert: { flexDirection: "row", gap: 10, alignItems: "center", borderRadius: 12, padding: 12 },
  info: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, fontWeight: "700", color: colors.muted, fontSize: 12, textTransform: "uppercase" },
  option: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface },
  price: { fontSize: 22, fontWeight: "800", color: colors.ink },
  steps: { flexDirection: "row", gap: 6 },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  stepDotOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  stepNum: { fontSize: 12, fontWeight: "700", color: colors.muted },
  stepLabel: { fontSize: 11, color: colors.muted },
  tlRow: { flexDirection: "row", gap: 10 },
  tlDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: "#d6d6d6", backgroundColor: "#fff", marginTop: 4 },
  tlDotOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  tlDotCurrent: { shadowColor: colors.brand, shadowOpacity: 0.4, shadowRadius: 6, elevation: 3 },
  tlLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
});

export function statusTone(status: string): "ok" | "warn" | "danger" | undefined {
  if (["iptal", "odeme_basarisiz", "reddedildi", "suresi_doldu", "askida", "pasif"].includes(status)) return "danger";
  if (["odeme_bekliyor", "beklemede", "basvuru"].includes(status)) return "warn";
  if (["onaylandi", "atandi", "yolculukta", "tamamlandi", "onayli", "aktif", "odendi", "bitti", "yolda", "vardi", "basladi"].includes(status)) return "ok";
  return undefined;
}
