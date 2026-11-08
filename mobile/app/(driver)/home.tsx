import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
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
import type { DriverMe, Earnings, Job, Trip } from "@/lib/types";

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

/** Havuz kartı: kazanç, zaman, rota, mesafe. Dokununca kabul öncesi ayrıntı ekranı açılır. */
function JobCard(props: { job: Job; index: number }) {
  const j = props.job;
  return (
    <Animated.View entering={FadeInDown.duration(350).delay(props.index * 50)}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${j.pickup_region} → ${j.dropoff_region}, ${money(j.driver_amount, j.currency)}`}
        onPress={() => { tap(); router.push(`/job/${j.leg_id}`); }}
        style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 16, gap: 12, backgroundColor: "#fff" }, pressed && { backgroundColor: colors.canvas }]}>
        <Row spread style={{ flexWrap: "nowrap" }}>
          <View style={{ gap: 2, flex: 1 }}>
            <T style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.6 }}>{money(j.driver_amount, j.currency)}</T>
            <T style={s.hint}>{dateTime(j.pickup_at)}</T>
          </View>
          <Badge text={j.booking_type === "anlik" ? "Anlık" : "Planlı"} tone={j.booking_type === "anlik" ? "accent" : "dark"} />
        </Row>
        <RouteStops from={j.pickup_region} to={j.dropoff_region} compact />
        <Row spread>
          <T style={s.hint}>
            {Number(j.distance_km).toFixed(0)} km{j.duration_minutes ? ` · ~${j.duration_minutes} dk` : ""} · {j.passenger_count} yolcu
            {j.pickup_distance_km !== null ? ` · size ${Number(j.pickup_distance_km).toLocaleString("tr-TR")} km` : ""}
          </T>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Row>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Sürücü ekranları 2-4: onay bekleme, çevrimiçi/çevrimdışı geçişi, iş havuzu (K-47), yaklaşan işler.
 * Havuz: aracına ve belgelerine uyan, sürücüsü olmayan anlık (çevrimiçiyken) ve planlı işler.
 * Push bildirimi (FCM) açılana kadar havuz ekran açıkken kısa aralıklarla yoklanır.
 */
export default function DriverHome() {
  const { signOut } = useSession();
  const [me, setMe] = useState<DriverMe | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const m = await api<DriverMe>("driver/me");
      setMe(m);
      setTrips(await api<Trip[]>("driver/trips"));
      if (m.status === "onayli") {
        // Alışa uzaklık için son bilinen konum (izin yoksa uzaklık gösterilmez).
        const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
        const pos = perm?.granted ? await Location.getLastKnownPositionAsync().catch(() => null) : null;
        const q = pos ? `?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}` : "";
        setJobs(await api<Job[]>(`driver/jobs${q}`));
      } else setJobs([]);
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

  // Ekran açıkken havuz yoklanır: çevrimiçiyken sık (anlık işler), değilse seyrek (planlı işler).
  const meStatus = me?.status;
  const meOnline = me?.is_online ?? false;
  useFocusEffect(
    useCallback(() => {
      if (meStatus !== "onayli") return;
      const poll = setInterval(load, meOnline ? 8000 : 30000);
      const tick = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        clearInterval(poll);
        clearInterval(tick);
      };
    }, [meStatus, meOnline, load]),
  );

  async function setOnline(v: boolean) {
    setBusy(true);
    try {
      if (v) await Location.requestForegroundPermissionsAsync().catch(() => undefined);
      setMe(await api<DriverMe>("driver/me/online", { body: { is_online: v } }));
      await load();
    } catch (e) {
      setError(errorTextTr(e));
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
  // Bu sürücüye gönderilmiş, süresi dolmamış anlık teklif öne çıkarılır.
  const offer = jobs.find((j) => j.offer_expires_at && new Date(j.offer_expires_at).getTime() > now);
  const pool = jobs.filter((j) => j !== offer);
  const active = trips.find((x) => ["yolda", "vardi", "basladi"].includes(x.status));

  return (
    <MapSheet
      map={<MapCanvas seed={offer ? offer.leg_id : "driver"} mode={offer ? "route" : me.is_online ? "idle" : "idle"} focusTop={0.5} dark={!me.is_online} />}
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
          const left = Math.max(0, Math.round((new Date(offer.offer_expires_at as string).getTime() - now) / 1000));
          return (
            <Animated.View entering={ZoomIn.duration(350)}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Yeni iş teklifi, ${money(offer.driver_amount, offer.currency)}. Ayrıntıyı aç`}
                onPress={() => { tap(); router.push(`/job/${offer.leg_id}`); }}
                style={[{ backgroundColor: colors.ink, borderRadius: 26, padding: 20, gap: 16 }, shadow.float]}>
                <Row spread style={{ flexWrap: "nowrap" }}>
                  <View style={{ gap: 4, flex: 1 }}>
                    <T style={{ color: colors.accent, fontWeight: "700", letterSpacing: 1.5, fontSize: 11 }}>YENİ İŞ TEKLİFİ</T>
                    <T style={{ color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -1 }}>{money(offer.driver_amount, offer.currency)}</T>
                    <T style={{ color: "rgba(255,255,255,0.65)", fontSize: 13 }}>{dateTime(offer.pickup_at)}</T>
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
                      <T style={{ color: "#fff", fontWeight: "600" }}>{offer.pickup_region}</T>
                      <T style={{ color: "#fff", fontWeight: "600" }}>{offer.dropoff_region}</T>
                    </View>
                  </View>
                </View>
                <Row spread>
                  <T style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                    {Number(offer.distance_km).toFixed(0)} km · {offer.passenger_count} yolcu · {offer.luggage_count} bagaj
                  </T>
                  <Row gap={6}>
                    <T style={{ color: "#fff", fontWeight: "700" }}>İncele</T>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                  </Row>
                </Row>
              </Pressable>
            </Animated.View>
          );
        })()
      ) : null}
      {approved ? (
        me.is_online ? (
          !offer && (
            <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: 10, paddingVertical: 12 }}>
              <Radar />
              <T style={{ fontWeight: "700", fontSize: 16 }}>{pool.length ? "İşler aşağıda" : "Teklif bekleniyor…"}</T>
              <T style={[s.hint, { textAlign: "center" }]}>Yeni anlık işler ve teklifler burada görünür.</T>
              <Button title="Çevrimdışı ol" variant="secondary" small icon="pause" onPress={() => setOnline(false)} busy={busy} />
            </Animated.View>
          )
        ) : (
          <GoButton onPress={() => setOnline(true)} busy={busy} />
        )
      ) : (
        <Button title="Belgelerime git" icon="document-text" onPress={() => router.push("/documents")} />
      )}

      {/* İş havuzu (K-47) */}
      {approved && (
        <>
          <Row spread>
            <H2>İş havuzu</H2>
            {pool.length > 0 ? <Badge text={String(pool.length)} tone="accent" /> : null}
          </Row>
          {pool.length === 0 ? (
            <Card flat>
              <Row gap={12} style={{ flexWrap: "nowrap" }}>
                <Ionicons name="file-tray-outline" size={22} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <P muted>{me.is_online ? "Şu an size uygun açık iş yok." : "Şu an size uygun planlı iş yok. Anlık işler için çevrimiçi olun."}</P>
                </View>
              </Row>
            </Card>
          ) : (
            pool.map((j, i) => <JobCard key={j.leg_id} job={j} index={i} />)
          )}
        </>
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
