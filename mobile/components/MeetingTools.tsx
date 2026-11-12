/**
 * Buluşma deneyimi (K-62), müşteri uygulaması: sürücü kartı (fotoğraf, diller, renk), yolcu durumu
 * ("İndim / Bagajdayım / Çıkıyorum"), havalimanı buluşma rehberi, takip bağlantısı paylaşımı, puan ve bahşiş.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Image, Pressable, Share, TextInput, View } from "react-native";
import { Alert, Avatar, Button, Card, H2, Row, T, colors, s } from "@/components/ui";
import { API_URL, reachable } from "@/lib/config";
import { accessToken, api } from "@/lib/api";
import { money } from "@/lib/format";
import { LOCALE, errorText, t, type Key } from "@/lib/i18n";
import type { BookingLeg, DriverBrief, MeetingGuide, Rating } from "@/lib/types";

const LANG_NAMES: Record<string, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", ru: "Русский", fr: "Français", es: "Español", it: "Italiano",
  zh: "中文", ja: "日本語", ar: "العربية",
};
const STEPS = ["indi", "bagajda", "cikiyor"] as const;
const STEP_ICON = { indi: "airplane", bagajda: "briefcase", cikiyor: "walk" } as const;

/** Fotoğraf yetkili uçtan gelir; jeton başlıkta gider. Yoksa baş harfler. */
export function DriverAvatar(props: { code: string; driver: DriverBrief; size?: number }) {
  const [failed, setFailed] = useState(false);
  const size = props.size ?? 54;
  if (!props.driver.has_photo || failed) return <Avatar name={props.driver.first_name} size={size} />;
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: `${API_URL}/api/v1/me/bookings/${props.code}/driver-photo`, headers: { Authorization: `Bearer ${accessToken() ?? ""}` } }}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.canvas }}
    />
  );
}

export function driverSubline(d: DriverBrief): string {
  return `${d.color ? `${d.color} ` : ""}${d.vehicle}`;
}

export function DriverLanguages(props: { driver: DriverBrief }) {
  if (!props.driver.languages?.length) return null;
  return (
    <Row gap={6}>
      <Ionicons name="language-outline" size={14} color={colors.muted} />
      <T style={s.hint}>{t("meet.speaks", { languages: props.driver.languages.map((x) => LANG_NAMES[x] ?? x).join(", ") })}</T>
    </Row>
  );
}

export const showPassengerStatus = (leg: BookingLeg) =>
  leg.pickup_region.type === "havalimani" && ["atandi", "yolda", "vardi"].includes(leg.status) &&
  Date.now() >= new Date(leg.pickup_at).getTime() - 12 * 3600_000;

/** Yolcu durumu: tek dokunuşla sürücüye bildirilir. Durum yalnızca ileri gider. */
export function PassengerStatus(props: { code: string; leg: BookingLeg; onChange: (st: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idx = props.leg.passenger_status ? STEPS.indexOf(props.leg.passenger_status as (typeof STEPS)[number]) : -1;

  async function send(status: string) {
    if (busy) return;
    setBusy(status);
    setError(null);
    try {
      const r = await api<{ passenger_status: string }>(`me/bookings/${props.code}/passenger-status`, { body: { status } });
      props.onChange(r.passenger_status);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <T style={{ fontWeight: "700" }}>{t("meet.statusTitle")}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {STEPS.map((st, i) => {
          const done = i <= idx;
          return (
            <Pressable key={st} accessibilityRole="button" accessibilityState={{ selected: done, busy: busy === st }}
              onPress={() => void send(st)} disabled={busy !== null || i <= idx}
              style={({ pressed }) => [{
                flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14,
                backgroundColor: done ? colors.ink : colors.canvas,
              }, pressed && { opacity: 0.8 }]}>
              <Ionicons name={done ? "checkmark-circle" : STEP_ICON[st]} size={20} color={done ? "#fff" : colors.ink} />
              <T style={{ fontWeight: "700", fontSize: 13, color: done ? "#fff" : colors.ink }}>{t(`meet.status.${st}` as Key)}</T>
            </Pressable>
          );
        })}
      </View>
      <T style={s.hint}>{idx >= 0 ? t("meet.statusSent") : t("meet.statusHint")}</T>
      <Alert text={error} />
    </View>
  );
}

/** Havalimanı buluşma rehberi: dokununca açılır, terminal sekmeleri ve fotoğraflı adımlar. */
export function MeetingGuideCard(props: { code: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MeetingGuide | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!open || data) return;
    api<MeetingGuide>(`me/bookings/${props.code}/meeting-guide?lang=${LOCALE}`).then(setData).catch(() => setData({ airport: null, guides: [] }));
  }, [open, data, props.code]);

  const guide = data?.guides[tab];
  return (
    <Card flat>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)}>
        <Row spread style={{ flexWrap: "nowrap" }}>
          <Row gap={10} style={{ flexWrap: "nowrap", flex: 1 }}>
            <Ionicons name="map-outline" size={20} color={colors.ink} />
            <T style={{ fontWeight: "700", flexShrink: 1 }}>{data?.airport ? t("meet.guideTitle", { airport: data.airport }) : t("meet.guideButton")}</T>
          </Row>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </Row>
      </Pressable>
      {open && !data ? <T style={s.hint}>{t("meet.loading")}</T> : null}
      {open && data && data.guides.length === 0 ? <T style={s.hint}>{t("meet.guideEmpty")}</T> : null}
      {open && data && data.guides.length > 1 ? (
        <Row gap={6}>
          {data.guides.map((g, i) => (
            <Pressable key={g.id} accessibilityRole="tab" accessibilityState={{ selected: i === tab }} onPress={() => setTab(i)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: i === tab ? colors.ink : colors.canvas }}>
              <T style={{ color: i === tab ? "#fff" : colors.ink, fontWeight: "600" }}>{g.terminal || t("meet.guideGeneral")}</T>
            </Pressable>
          ))}
        </Row>
      ) : null}
      {open && guide ? (
        <View style={{ gap: 14 }}>
          {guide.steps.map((st, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" }}>
                <T style={{ fontWeight: "800" }}>{i + 1}</T>
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                {st.photo_path ? (
                  <Image accessibilityIgnoresInvertColors source={{ uri: `${API_URL}${st.photo_path}` }}
                    style={{ width: "100%", height: 180, borderRadius: 12, backgroundColor: colors.canvas }} resizeMode="cover" />
                ) : null}
                <T style={{ lineHeight: 21 }}>{st.text}</T>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Takip bağlantısı: karşılayan yakın giriş yapmadan sürücüyü izler. Sistem paylaşım menüsü açılır. */
export function ShareTrip(props: { code: string }) {
  const [error, setError] = useState<string | null>(null);
  async function share() {
    setError(null);
    try {
      const r = await api<{ url: string }>(`me/bookings/${props.code}/share`, { body: {} });
      await Share.share({ message: `${t("meet.shareMessage")} ${r.url}`, url: r.url });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" onPress={() => void share()}
        style={({ pressed }) => [{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: colors.line }, pressed && { opacity: 0.8 }]}>
        <Ionicons name="share-social-outline" size={18} color={colors.ink} />
        <T style={{ fontWeight: "700" }}>{t("meet.shareTitle")}</T>
      </Pressable>
      <T style={[s.hint, { textAlign: "center" }]}>{t("meet.shareText")}</T>
      <Alert text={error} />
    </View>
  );
}

/** Yolculuk sonrası puan ve isteğe bağlı bahşiş. Bahşiş sağlayıcının ödeme sayfasında ödenir. */
export function RatingCard(props: { code: string; driverName: string }) {
  const [state, setState] = useState<Rating | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [tip, setTip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Rating>(`me/bookings/${props.code}/rating`).then(setState).catch(() => setState(null));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.code]);

  if (!state || !state.leg_id) return null;
  const fmt = (a: string) => money(a, state.currency, LOCALE);
  const tipOpen = !state.tip_status || state.tip_status === "yok" || state.tip_status === "basarisiz";

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = state!.rated
        ? await api<Rating>(`me/bookings/${props.code}/tip`, { body: { amount: tip } })
        : await api<Rating>(`me/bookings/${props.code}/rating`, { body: { stars, comment: comment.trim() || null, tip_amount: tip || null } });
      setState(r);
      if (r.iframe_url) {
        await WebBrowser.openBrowserAsync(reachable(r.iframe_url));
        await load();
      }
    } catch (e) {
      setError(errorText(e));
      void load();
    } finally {
      setBusy(false);
    }
  }

  if (state.rated && !tipOpen) {
    return (
      <Card>
        <Row gap={8}>
          <Ionicons name="star" size={18} color={colors.accent} />
          <T style={{ fontWeight: "700" }}>{t("meet.ratedTitle", { stars: state.stars ?? 0 })}</T>
        </Row>
        <T style={s.hint}>{state.tip_status === "odendi" ? t("meet.tipPaid", { amount: fmt(state.tip_amount ?? "0") }) : t("meet.tipPending")}</T>
      </Card>
    );
  }

  return (
    <Card elevated>
      <H2>{state.rated ? t("meet.tipTitle") : t("meet.rateTitle", { name: props.driverName })}</H2>
      {!state.rated ? (
        <>
          <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: stars === n }}
                accessibilityLabel={t("meet.starN", { n })} onPress={() => setStars(n)} hitSlop={6}>
                <Ionicons name={n <= stars ? "star" : "star-outline"} size={34} color={n <= stars ? colors.accent : colors.faint} />
              </Pressable>
            ))}
          </View>
          <TextInput value={comment} onChangeText={setComment} placeholder={t("meet.comment")} multiline maxLength={500}
            placeholderTextColor={colors.faint}
            style={{ minHeight: 60, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, color: colors.ink, fontSize: 15 }} />
        </>
      ) : null}
      <T style={{ fontWeight: "700" }}>{t("meet.tipLegend")}</T>
      <Row gap={8}>
        {["", ...state.tip_suggestions].map((v) => (
          <Pressable key={v || "none"} accessibilityRole="button" accessibilityState={{ selected: tip === v }} onPress={() => setTip(v)}
            style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: tip === v ? colors.ink : colors.canvas }}>
            <T style={{ fontWeight: "700", color: tip === v ? "#fff" : colors.ink }}>{v ? fmt(v) : t("meet.noTip")}</T>
          </Pressable>
        ))}
      </Row>
      <T style={s.hint}>{t("meet.tipHint")}</T>
      <Alert text={error} />
      <Button
        title={state.rated ? t("meet.tipPay") : tip ? t("meet.rateAndTip") : t("meet.rateSend")}
        icon={tip ? "card" : "star"}
        busy={busy}
        disabled={(!state.rated && stars === 0) || (state.rated && !tip)}
        onPress={() => void submit()}
      />
    </Card>
  );
}
