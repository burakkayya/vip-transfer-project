import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { LOCALE, errorText, t } from "@/lib/i18n";
import type { Endpoint, PlaceSuggestion, PlaceDetails, Region } from "@/lib/types";
import { Alert, IconBubble, T, colors, s, tap } from "./ui";

type Option =
  | { kind: "region"; key: string; region: Region; title: string; subtitle: string }
  | { kind: "place"; key: string; place: PlaceSuggestion; title: string; subtitle: string };

const PROVINCE: Record<string, string> = { antalya: "Antalya", mugla: "Muğla" };
const fold = (v: string) =>
  v.replace(/ı/g, "i").replace(/İ/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export function regionEndpoint(r: Region): Endpoint {
  return { label: r.iata_code ? `${r.name} (${r.iata_code})` : r.name, region: r };
}

/** Arama ekranı: havalimanı ve ilçeler anında, otel ve adresler backend üzerinden aranır. */
export function AddressSearch(props: {
  open: boolean;
  title: string;
  regions: Region[];
  onClose: () => void;
  onPick: (e: Endpoint) => void;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(uuid());

  const options: Option[] = useMemo(() => {
    const q = fold(query.trim());
    const regionHits = (q
      ? props.regions.filter((r) => fold(`${r.name} ${r.iata_code ?? ""}`).includes(q))
      : props.regions.filter((r) => r.type === "havalimani")
    )
      .slice(0, 8)
      .map<Option>((r) => ({
        kind: "region",
        key: `r${r.id}`,
        region: r,
        title: r.iata_code ? `${r.name} (${r.iata_code})` : r.name,
        subtitle: r.type === "havalimani" ? `${t("book.airports")} · ${PROVINCE[r.province] ?? r.province}` : `${t("addr.districts")} · ${PROVINCE[r.province] ?? r.province}`,
      }));
    const shown = new Set(regionHits.map((o) => fold(o.title)));
    const placeHits = places
      .filter((p) => !shown.has(fold(p.title)))
      .map<Option>((p) => ({ kind: "place", key: p.place_id, place: p, title: p.title, subtitle: p.subtitle }));
    return [...regionHits, ...placeHits];
  }, [query, places, props.regions]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setPlaces([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = `q=${encodeURIComponent(q)}&session=${session.current}&lang=${LOCALE}`;
        setPlaces(await api<PlaceSuggestion[]>(`places/autocomplete?${qs}`));
        setError(null);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function choose(o: Option) {
    tap();
    setError(null);
    if (o.kind === "region") {
      props.onPick(regionEndpoint(o.region));
    } else {
      try {
        const d = await api<PlaceDetails>(`places/${encodeURIComponent(o.place.place_id)}?session=${session.current}&lang=${LOCALE}`);
        props.onPick({
          label: o.title,
          region: d.region,
          place_token: d.place_token,
          point: d.lat && d.lng ? { latitude: Number(d.lat), longitude: Number(d.lng) } : undefined,
        });
      } catch (e) {
        setError(errorText(e));
        return;
      }
    }
    props.onClose();
    setQuery("");
    setPlaces([]);
    session.current = uuid();
  }

  return (
    <Modal visible={props.open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
          <Pressable onPress={props.onClose} hitSlop={10} accessibilityLabel={t("back")}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <T style={{ fontSize: 18, fontWeight: "700" }}>{props.title}</T>
        </View>
        <View style={{ padding: 16 }}>
          <View style={[s.inputWrap, { borderColor: colors.ink, backgroundColor: "#fff" }]}>
            <Ionicons name="search" size={18} color={colors.ink} style={{ marginRight: 10 }} />
            <TextInput autoFocus value={query} onChangeText={setQuery} placeholder={t("addr.placeholder")}
              placeholderTextColor={colors.faint} style={s.inputText} autoCorrect={false} />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10}>
                <Ionicons name="close-circle" size={20} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          <Alert text={error} />
        </View>
        {!query.trim() ? <T style={s.section}>{t("home.popular")}</T> : null}
        <FlatList
          data={options}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(o) => o.key}
          ListFooterComponent={
            searching ? <T style={[s.hint, { padding: 16 }]}>{t("addr.searching")}</T>
              : query.trim().length >= 3 && options.length === 0 ? <T style={[s.hint, { padding: 16 }]}>{t("addr.noResults")}</T>
                : undefined
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(250).delay(index * 25)}>
              <Pressable style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 }, pressed && { backgroundColor: colors.brandSoft }]} onPress={() => choose(item)}>
                <IconBubble name={item.kind === "region" && item.region.type === "havalimani" ? "airplane" : item.kind === "place" ? "business" : "location"} size={40} />
                <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 12, marginBottom: -12 }}>
                  <T style={[s.p, { fontWeight: "600" }]} numberOfLines={1}>{item.title}</T>
                  <T style={s.hint} numberOfLines={1}>{item.subtitle}</T>
                </View>
              </Pressable>
            </Animated.View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

/** Rota kutusu: iki adres tek kutuda, solda nokta–çizgi–kare, sağda yön değiştirme. */
export function RouteBox(props: {
  regions: Region[];
  from: Endpoint | null;
  to: Endpoint | null;
  onFrom: (e: Endpoint | null) => void;
  onTo: (e: Endpoint | null) => void;
}) {
  const [open, setOpen] = useState<"from" | "to" | null>(null);
  const row = (which: "from" | "to") => {
    const v = which === "from" ? props.from : props.to;
    return (
      <Pressable onPress={() => setOpen(which)} style={{ height: 60, justifyContent: "center", paddingRight: 52 }}
        accessibilityRole="button" accessibilityLabel={which === "from" ? t("book.from") : t("book.to")}>
        {v ? (
          <>
            <T style={[s.p, { fontWeight: "600" }]} numberOfLines={1}>{v.label}</T>
            <T style={s.hint} numberOfLines={1}>{t("addr.region", { region: v.region.name })}</T>
          </>
        ) : (
          <T style={[s.p, { color: colors.faint, fontWeight: "500", fontSize: 16 }]}>{which === "from" ? t("book.from") : t("book.to")}</T>
        )}
      </Pressable>
    );
  };
  return (
    <View style={{ backgroundColor: colors.brandSoft, borderRadius: 18, paddingLeft: 44 }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 18, top: 25, height: 70, width: 10, alignItems: "center" }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink }} />
        <View style={{ flex: 1, width: 2, backgroundColor: colors.ink, marginVertical: 3, opacity: 0.85 }} />
        <View style={{ width: 10, height: 10, backgroundColor: colors.ink }} />
      </View>
      {row("from")}
      <View style={{ height: 1, backgroundColor: "#DEDCD5", marginRight: 0 }} />
      {row("to")}
      <Pressable
        onPress={() => {
          tap();
          props.onFrom(props.to);
          props.onTo(props.from);
        }}
        accessibilityLabel="⇅"
        style={{ position: "absolute", right: 12, top: 41, width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line }}
      >
        <Ionicons name="swap-vertical" size={18} color={colors.ink} />
      </Pressable>
      <AddressSearch
        open={open !== null}
        title={open === "from" ? t("book.from") : t("book.to")}
        regions={props.regions}
        onClose={() => setOpen(null)}
        onPick={(e) => (open === "from" ? props.onFrom(e) : props.onTo(e))}
      />
    </View>
  );
}

export default RouteBox;
