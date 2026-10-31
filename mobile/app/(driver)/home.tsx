import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, ZoomIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import { Alert, Avatar, Badge, Button, Card, H2, Loading, P, RouteStops, Row, Screen, T, colors, s, shadow, statusTone, tap } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { DOC_LABEL, DRIVER_STATUS, LEG_STATUS } from "@/lib/driverLabels";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { DriverMe, Earnings, Offer, Trip } from "@/lib/types";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const OFFER_SECONDS = 60;

/** Teklif süresini gösteren halka (Uber'deki geri sayım). */
function CountdownRing(props: { left: number; total: number }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const p = useSharedValue(props.left / props.total);
  useEffect(() => {
    p.value = withTiming(props.left / props.total, { duration: 950 });
  }, [props.left, props.total, p]);
  const anim = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - p.value) }));
  const urgent = props.left <= 10;
  return (
    <View style={{ width: 72, height: 72, alignItems: "center", justifyContent: "center" }}>
      <Svg width={72} height={72} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={36} cy={36} r={R} stroke="rgba(255,255,255,0.15)" strokeWidth={6} fill="none" />
        <AnimatedCircle cx={36} cy={36} r={R} stroke={urgent ? "#FF6B5E" : colors.accent} strokeWidth={6} fill="none" strokeLinecap="round"
          strokeDasharray={C} animatedProps={anim} />
      </Svg>
      <T style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>{props.left}</T>
    </View>
  );
}

/** Çevrimiçiyken teklif beklerken dönen radar halkaları. */
function Radar() {
  const a = useSharedValue(0);
  useEffect(() => {
    a.value = withRepeat(withTiming(1, { duration: 2000 }), -1, false);
  }, [a]);
  const r1 = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + a.value * 1.4 }], opacity: 0.5 * (1 - a.value) }));
  const r2 = useAnimatedStyle(() => {
    const v = (a.value + 0.5) % 1;
    return { transform: [{ scale: 0.4 + v * 1.4 }], opacity: 0.5 * (1 - v) };
  });
  return (
    <View style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ok }, r1]} />
      <Animated.View style={[{ position: "absolute", width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ok }, r2]} />
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.ok, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="radio" size={18} color="#fff" />
      </View>
    </View>
  );
}

/** Uber'deki büyük "GO" düğmesi: çevrimiçi olmak için. */
function GoButton(props: { onPress: () => void; busy: boolean }) {
  const a = useSharedValue(0);
  useEffect(() => {
    a.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
  }, [a]);
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: 1 + a.value * 0.35 }], opacity: 0.35 * (1 - a.value) }));
  return (
    <View style={{ alignItems: "center", justifyContent: "center", height: 150 }}>
      <Animated.View style={[{ position: "absolute", width: 116, height: 116, borderRadius: 58, backgroundColor: colors.accent }, halo]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Çevrimiçi ol"
        disabled={props.busy}
        onPress={() => {
          tap();
          props.onPress();
        }}
        style={({ pressed }) => [{ width: 116, height: 116, borderRadius: 58, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#fff" }, shadow.float, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <T style={{ color: "#fff", fontWeight: "800", fontSize: 26, letterSpacing: 1 }}>{props.busy ? "…" : "GO"}</T>
      </Pressable>
    </View>
  );
}

/**
 * Sürücü ekranları 2-4: onay bekleme, çevrimiçi/çevrimdışı geçişi, iş teklifleri, yaklaşan işler.
 * Push bildirimi (FCM) açılana kadar teklifler çevrimiçiyken kısa aralıklarla yoklanır.
 */
export default function DriverHome() {
  const { signOut } = useSession();
  const [me, setMe] = useState<DriverMe | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const m = await api<DriverMe>("driver/me");
      setMe(m);
      setTrips(await api<Trip[]>("driver/trips"));
      setOffers(m.is_online ? await api<Offer[]>("driver/offers") : []);
      api<Earnings>("driver/earnings").then(setEarnings).catch(() => undefined);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "driver_profile_missing") router.replace("/driver-register");
      else setError(errorTextTr(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!me?.is_online) return;
    const poll = setInterval(load, 8000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [me?.is_online, load]);

  async function setOnline(v: boolean) {
    setBusy(true);
    try {
      setMe(await api<DriverMe>("driver/me/online", { body: { is_online: v } }));
      await load();
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  async function respond(offer: Offer, accept: boolean) {
    setBusy(true);
    try {
      if (accept) {
        const trip = await api<Trip>(`driver/offers/${offer.offer_id}/accept`, { body: {} });
        router.push(`/trip/${trip.leg_id}`);
      } else {
        await api(`driver/offers/${offer.offer_id}/reject`, { body: {} });
      }
      await load();
    } catch (e) {
      setError(errorTextTr(e));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        {error ? <Alert text={error} /> : <Loading />}
      </Screen>
    );
  }

  const approved = me.status === "onayli";
  const offer = offers[0];
  const active = trips.find((x) => ["yolda", "vardi", "basladi"].includes(x.status));

  return (
    <MapSheet
      map={<MapCanvas seed={offer ? offer.offer_id : "driver"} mode={offer ? "route" : me.is_online ? "idle" : "idle"} focusTop={0.5} dark={!me.is_online} />}
      mapRatio={offer ? 0.3 : 0.44}
      refreshing={false}
      onRefresh={load}
      overlay={
        <>
          <Pressable onPress={() => router.push("/earnings")}
            style={[{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", gap: 8, alignItems: "center" }, shadow.card]}>
            <Ionicons name="wallet" size={16} color={colors.accent} />
            <T style={{ color: "#fff", fontWeight: "800" }}>{earnings ? money(earnings.pending_try, "TRY") : "—"}</T>
          </Pressable>
          <View style={[{ borderRadius: 999, backgroundColor: "#fff", padding: 3 }, shadow.card]}>
            <Avatar name={me.full_name} size={40} />
          </View>
        </>
      }
    >
      {/* Durum satırı */}
      <Row spread style={{ flexWrap: "nowrap" }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.6 }}>
            {!approved ? DRIVER_STATUS[me.status] ?? me.status : me.is_online ? "Çevrimiçisiniz" : "Çevrimdışısınız"}
          </T>
          <T style={s.hint}>
            {!approved
              ? me.status === "basvuru" ? "Belgeleriniz onaylanınca iş almaya başlarsınız." : "Hesabınız şu an iş alamaz. Operasyon ekibiyle iletişime geçin."
              : me.is_online ? "Size uygun teklifler anında gelir." : "İş almak için GO'ya dokunun."}
          </T>
        </View>
        <Badge text={DRIVER_STATUS[me.status] ?? me.status} tone={statusTone(me.status)} />
      </Row>

      <Alert text={error} />
      {me.missing_documents.length > 0 && (
        <Alert tone="warn" onPress={() => router.push("/documents")}
          text={`Eksik belgeler: ${me.missing_documents.map((d) => DOC_LABEL[d] ?? d).join(", ")}`} />
      )}

      {active && (
        <Pressable onPress={() => router.push(`/trip/${active.leg_id}`)}
          style={{ backgroundColor: colors.okSoft, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name="navigate-circle" size={28} color={colors.ok} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "700", color: colors.ok }}>Aktif yolculuk · {LEG_STATUS[active.status]}</T>
            <T style={[s.hint, { color: "#2D5A43" }]}>{active.pickup_region} → {active.dropoff_region}</T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ok} />
        </Pressable>
      )}

      {/* Teklif kartı */}
      {offer ? (
        (() => {
          const left = Math.max(0, Math.round((new Date(offer.expires_at).getTime() - now) / 1000));
          return (
            <Animated.View entering={ZoomIn.duration(350)} style={[{ backgroundColor: colors.ink, borderRadius: 26, padding: 20, gap: 16 }, shadow.float]}>
              <Row spread style={{ flexWrap: "nowrap" }}>
                <View style={{ gap: 4, flex: 1 }}>
                  <T style={{ color: colors.accent, fontWeight: "700", letterSpacing: 1.5, fontSize: 11 }}>YENİ İŞ TEKLİFİ</T>
                  <T style={{ color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -1 }}>{money(offer.trip.driver_amount, offer.trip.currency)}</T>
                  <T style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>{dateTime(offer.trip.pickup_at)}</T>
                </View>
                <CountdownRing left={left} total={Math.max(left, OFFER_SECONDS)} />
              </Row>
              <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 14 }}>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <View style={{ alignItems: "center", paddingVertical: 6 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" }} />
                    <View style={{ flex: 1, width: 2, backgroundColor: "rgba(255,255,255,0.5)", marginVertical: 3, minHeight: 14 }} />
                    <View style={{ width: 10, height: 10, backgroundColor: "#fff" }} />
                  </View>
                  <View style={{ flex: 1, gap: 14 }}>
                    <T style={{ color: "#fff", fontWeight: "600" }}>{offer.trip.pickup_region}</T>
                    <T style={{ color: "#fff", fontWeight: "600" }}>{offer.trip.dropoff_region}</T>
                  </View>
                </View>
              </View>
              <Row gap={8}>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Ionicons name="people" size={14} color="#fff" />
                  <T style={{ color: "#fff", fontSize: 13 }}>{offer.trip.passenger_count} yolcu</T>
                </View>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Ionicons name="briefcase" size={14} color="#fff" />
                  <T style={{ color: "#fff", fontSize: 13 }}>{offer.trip.luggage_count} bagaj</T>
                </View>
                {offer.trip.flight_no ? (
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="airplane" size={14} color="#fff" />
                    <T style={{ color: "#fff", fontSize: 13 }}>{offer.trip.flight_no}</T>
                  </View>
                ) : null}
              </Row>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button title="Reddet" variant="onDark" onPress={() => respond(offer, false)} disabled={busy} style={{ flex: 1 }} />
                <Button title="Kabul et" icon="checkmark" variant="light" busy={busy} disabled={left === 0} onPress={() => respond(offer, true)} style={{ flex: 2 }} />
              </View>
              {offers.length > 1 ? <T style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", fontSize: 12 }}>+{offers.length - 1} teklif daha</T> : null}
            </Animated.View>
          );
        })()
      ) : approved ? (
        me.is_online ? (
          <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: 10, paddingVertical: 12 }}>
            <Radar />
            <T style={{ fontWeight: "700", fontSize: 16 }}>Teklif bekleniyor…</T>
            <T style={[s.hint, { textAlign: "center" }]}>Uygulama açıkken yeni işler otomatik görünür.</T>
            <Button title="Çevrimdışı ol" variant="secondary" small icon="pause" onPress={() => setOnline(false)} busy={busy} />
          </Animated.View>
        ) : (
          <GoButton onPress={() => setOnline(true)} busy={busy} />
        )
      ) : (
        <Button title="Belgelerime git" icon="document-text" onPress={() => router.push("/documents")} />
      )}

      {/* Yaklaşan işler */}
      <Row spread>
        <H2>Yaklaşan işler</H2>
        {trips.length > 0 ? <Badge text={String(trips.length)} tone="dark" /> : null}
      </Row>
      {trips.length === 0 && (
        <Card flat>
          <Row gap={12} style={{ flexWrap: "nowrap" }}>
            <Ionicons name="calendar-clear-outline" size={22} color={colors.muted} />
            <P muted>Atanmış işiniz yok.</P>
          </Row>
        </Card>
      )}
      {trips.map((tr, i) => (
        <Animated.View key={tr.leg_id} entering={FadeInDown.duration(350).delay(i * 60)}>
          <Pressable onPress={() => { tap(); router.push(`/trip/${tr.leg_id}`); }}
            style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 16, gap: 12, backgroundColor: "#fff" }, pressed && { backgroundColor: colors.canvas }]}>
            <Row spread style={{ flexWrap: "nowrap" }}>
              <T style={{ fontWeight: "700" }}>{dateTime(tr.pickup_at)}</T>
              <Badge text={LEG_STATUS[tr.status] ?? tr.status} tone={statusTone(tr.status)} />
            </Row>
            <RouteStops from={tr.pickup_region} to={tr.dropoff_region} fromHint={tr.pickup_address ?? undefined} compact />
            <Row spread>
              <T style={s.hint}>{tr.booking_code} · {tr.passenger_name}</T>
              <T style={{ fontWeight: "800" }}>{money(tr.driver_amount, tr.currency)}</T>
            </Row>
          </Pressable>
        </Animated.View>
      ))}

      <Pressable style={{ alignSelf: "center", padding: 12, flexDirection: "row", gap: 6, alignItems: "center" }} onPress={async () => {
        if (me.is_online) await api("driver/me/online", { body: { is_online: false } }).catch(() => undefined);
        await signOut();
        router.replace("/login");
      }}>
        <Ionicons name="log-out-outline" size={16} color={colors.muted} />
        <T style={{ color: colors.muted, fontWeight: "600" }}>Çıkış yap</T>
      </Pressable>
    </MapSheet>
  );
}
