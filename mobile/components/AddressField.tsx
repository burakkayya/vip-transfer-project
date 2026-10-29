import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { LOCALE, errorText, t } from "@/lib/i18n";
import type { Endpoint, PlaceSuggestion, PlaceDetails, Region } from "@/lib/types";
import { Alert, colors, s } from "./ui";

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

/** Adres seçimi: havalimanı ve ilçeler anında, otel ve adresler backend üzerinden aranır. Fiyat ilçeye göre. */
export default function AddressField(props: {
  label: string;
  icon: "airplane-outline" | "location-outline";
  regions: Region[];
  value: Endpoint | null;
  onChange: (e: Endpoint | null) => void;
}) {
  const [open, setOpen] = useState(false);
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
        subtitle: r.type === "havalimani" ? t("book.airports") : `${t("addr.districts")} · ${PROVINCE[r.province] ?? r.province}`,
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
    setError(null);
    if (o.kind === "region") {
      props.onChange(regionEndpoint(o.region));
    } else {
      try {
        const d = await api<PlaceDetails>(`places/${encodeURIComponent(o.place.place_id)}?session=${session.current}&lang=${LOCALE}`);
        props.onChange({ label: o.title, region: d.region, place_token: d.place_token });
      } catch (e) {
        setError(errorText(e));
        return;
      }
    }
    setOpen(false);
    setQuery("");
    setPlaces([]);
    session.current = uuid();
  }

  return (
    <View style={s.field}>
      <Text style={s.label}>{props.label}</Text>
      <Pressable style={[s.inputWrap, props.value && { borderColor: colors.brand, backgroundColor: colors.brandSoft }]} onPress={() => setOpen(true)}>
        <Ionicons name={props.value?.region.type === "havalimani" ? "airplane-outline" : props.icon} size={20} color={colors.brand} style={{ marginRight: 10 }} />
        <View style={{ flex: 1, paddingVertical: 10 }}>
          <Text style={[s.p, !props.value && { color: "#9aa0a6" }]} numberOfLines={1}>
            {props.value?.label ?? t("addr.placeholder")}
          </Text>
          {props.value ? <Text style={s.hint}>{t("addr.region", { region: props.value.region.name })}</Text> : null}
        </View>
        {props.value ? (
          <Pressable hitSlop={10} onPress={() => props.onChange(null)}>
            <Ionicons name="close-circle" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </Pressable>

      <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16 }}>
            <View style={[s.inputWrap, { flex: 1, borderColor: colors.brand }]}>
              <Ionicons name="search" size={18} color={colors.muted} style={{ marginRight: 8 }} />
              <TextInput autoFocus value={query} onChangeText={setQuery} placeholder={t("addr.placeholder")}
                placeholderTextColor="#9aa0a6" style={s.inputText} autoCorrect={false} />
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: 16 }}>
            <Alert text={error} />
          </View>
          <FlatList
            data={options}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(o) => o.key}
            ListFooterComponent={
              searching ? <Text style={[s.hint, { padding: 16 }]}>{t("addr.searching")}</Text>
                : query.trim().length >= 3 && options.length === 0 ? <Text style={[s.hint, { padding: 16 }]}>{t("addr.noResults")}</Text>
                  : undefined
            }
            renderItem={({ item }) => (
              <Pressable style={[s.option, { justifyContent: "flex-start", gap: 12 }]} onPress={() => choose(item)}>
                <Ionicons name={item.kind === "region" && item.region.type === "havalimani" ? "airplane" : "location"} size={20} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.p, { fontWeight: "600" }]}>{item.title}</Text>
                  <Text style={s.hint}>{item.subtitle}</Text>
                </View>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
