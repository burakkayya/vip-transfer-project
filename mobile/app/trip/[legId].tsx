import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import type { LatLng } from "@/components/mapTypes";
import {
  Alert, Avatar, Badge, Button, Card, H2, IconButton, Info, Loading, ProgressSegments, RouteStops, Row, Screen, T, colors, s,
  shadow,
} from "@/components/ui";
import { api } from "@/lib/api";
import { LEG_STATUS, NEXT_STEP } from "@/lib/driverLabels";
import { clock, dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import { driverLiveProps, endLiveTrip, showLiveTrip } from "@/lib/liveTrip";
import { backgroundSupported, distanceM, navigationUrls, startBackgroundTracking, stopBackgroundTracking } from "@/lib/tracking";
import type { Approach, Trip } from "@/lib/types";

const SHARING = ["yolda", "vardi", "basladi"];
const OPEN = ["atandi", "yolda", "vardi", "basladi"];
const FLOW = ["atandi", "yolda", "vardi", "basladi", "bitti"];
const LOCATION_INTERVAL_MS = 10_000;
const APPROACH_REFRESH_MS = 60_000;
const APPROACH_MOVE_M = 1_000;
const UNREAD_REFRESH_MS = 10_000;

const STAGE_HINT: Record<string, string> = {
  atandi: "Yola çıkınca yolcuya bildirim gider ve canlı takip başlar.",
  yolda: "Alış noktasına gidiyorsunuz. Yolcu sizi canlı izliyor.",
  vardi: "Yolcuyu karşılayın. Havalimanında karşılama tabelasını kullanın.",
  basladi: "Yolcu araçta. Varış noktasına yaklaşınca yolculuğu bitirin.",
  bitti: "Yolculuk tamamlandı. Hakedişiniz Kazanç sekmesine eklendi.",
};

// K-60: uçuş takibi. Durum backend'den sade kod olarak gelir.
const FLIGHT_STATUS_TR: Record<string, string> = {
  planlandi: "Zamanında", rotarli: "Rötarlı", havada: "Havada", indi: "İndi",
  iptal: "İptal edildi", yonlendirildi: "Başka havalimanına yönlendirildi",
  bulunamadi: "Uçuş bulunamadı, numarayı yolcuyla teyit edin",
};

function driverFlightLine(no: string, status?: string | null, eta?: string | null) {
  const label = status ? FLIGHT_STATUS_TR[status] : undefined;
  if (!label) return no;
  if (status === "iptal" || status === "yonlendirildi" || status === "bulunamadi") return `${no} · ${label}`;
  return `${no} · ${label} · ${status === "indi" ? "iniş" : "tahmini iniş"} ${clock(eta)}`;
}

function fmtKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km` : `${m} m`;
}

/**
 * Sürücü yolculuk ekranı: aşamaya göre hedef (yolcu alınana kadar alış, sonra varış), uygulama içi rota,
 * telefonun harita uygulamasında yol tarifi, canlı konum paylaşımı (geliştirme/mağaza derlemesinde arka
 * planda da), yolcuyla mesajlaşma ve varışa yakınken yolculuğu bitirme (K-49).
 */
export default function TripScreen() {
  const { legId } = useLocalSearchParams<{ legId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [background, setBackground] = useState(false);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [approach, setApproach] = useState<Approach | null>(null);
  const [unread, setUnread] = useState(0);
  const [sign, setSign] = useState(false);
  const [simulated, setSimulated] = useState(0);
  const positionRef = useRef<LatLng | null>(null);

  const load = useCallback(async () => {
    try {
      setTrip(await api<Trip>(`driver/trips/${legId}`));
    } catch (e) {
      setError(errorTextTr(e));
    }
  }, [legId]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = trip?.status ?? "";
  const open = OPEN.includes(status);
  const sharing = SHARING.includes(status);
  // Arka plan hizmeti yalnızca paylaşım aşamasında geçerlidir.
  const bgActive = background && sharing;

  // Ekran açıkken konum izlenir (rota ve bitirme mesafesi için). Arka plan hizmeti yoksa paylaşım da buradan yapılır.
  useEffect(() => {
    if (!open) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm !== "granted") {
        setPermission("denied");
        return;
      }
      setPermission("granted");
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: LOCATION_INTERVAL_MS, distanceInterval: 20 },
        (pos) => {
          const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          positionRef.current = p;
          setPosition(p);
          if (sharing && !bgActive) {
            const heading = pos.coords.heading !== null && pos.coords.heading >= 0 ? pos.coords.heading : null;
            void api(`driver/trips/${legId}/location`, { body: { lat: p.latitude, lng: p.longitude, heading } }).catch(() => undefined);
          }
        },
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [open, sharing, bgActive, legId]);

  // Aktif yolculukta arka plan paylaşımı (uygulama kapatılsa da sürer); yolculuk bitince durur.
  useEffect(() => {
    if (!trip) return;
    if (sharing) {
      void startBackgroundTracking(legId).then(setBackground).catch(() => setBackground(false));
    } else if (status === "bitti" || status === "iptal") {
      void stopBackgroundTracking();
    }
  }, [trip, sharing, status, legId]);

  // Sürücüden hedefe rota (alış veya varış): dakikada bir, aşama değişince ve araç 1 km'den fazla
  // ilerleyince yenilenir (rota sağlayıcısı maliyeti için her konumda değil).
  const approachFrom = useRef<LatLng | null>(null);
  const refreshApproach = useCallback(async () => {
    const p = positionRef.current;
    if (!p || !open) return;
    approachFrom.current = p;
    try {
      const a = await api<Approach>(`driver/trips/${legId}/approach?lat=${p.latitude}&lng=${p.longitude}`);
      setApproach(a?.target ? a : null);
    } catch {
      // Rota yardımcı bilgidir; hata ekranı bozmaz.
    }
  }, [legId, open]);

  const hasPosition = position !== null;
  useEffect(() => {
    if (!hasPosition || !open) return;
    void refreshApproach();
    const id = setInterval(refreshApproach, APPROACH_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasPosition, open, status, refreshApproach]);

  useEffect(() => {
    const from = approachFrom.current;
    if (!position || !from || !open) return;
    if (distanceM(from.latitude, from.longitude, position.latitude, position.longitude) > APPROACH_MOVE_M) void refreshApproach();
  }, [position, open, refreshApproach]);

  // Okunmamış mesaj sayısı.
  // K-59: aktif iş bildirim ekranında sabit (iOS Canlı Etkinlik, Android kalıcı bildirim).
  useEffect(() => {
    if (!trip) return;
    if (trip.status === "iptal") {
      void endLiveTrip(trip.leg_id);
      return;
    }
    const toDropoff = trip.status === "basladi";
    const live = driverLiveProps({
      status: trip.status,
      // Kilit ekranında tam adres değil ilçe/havalimanı (K-59, KVKK).
      pickup: trip.pickup_region,
      dropoff: trip.dropoff_region,
      passenger: trip.passenger_name,
      pickupTime: dateTime(trip.pickup_at, "tr-TR"),
      pickupAt: trip.pickup_at,
      etaMinutes: approach && (toDropoff || trip.status === "yolda") ? approach.duration_minutes ?? null : null,
    });
    if (!live) return;
    if (live.done) void endLiveTrip(trip.leg_id, live.props);
    else void showLiveTrip(trip.leg_id, live.props, `getawaydriver://trip/${trip.leg_id}`);
  }, [trip, approach]);

  useEffect(() => {
    if (!trip) return;
    const tick = () => api<{ unread: number }>(`driver/trips/${legId}/messages/unread`).then((r) => setUnread(r.unread)).catch(() => undefined);
    void tick();
    const id = setInterval(tick, UNREAD_REFRESH_MS);
    return () => clearInterval(id);
  }, [trip, legId]);

  async function advance(event: string) {
    setBusy(true);
    setError(null);
    try {
      const p = positionRef.current;
      setTrip(await api<Trip>(`driver/trips/${legId}/events`, { body: p ? { event, lat: p.latitude, lng: p.longitude } : { event } }));
      setApproach(null);
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  async function openNavigation() {
    if (!trip) return;
    const lat = Number(status === "basladi" ? trip.dropoff_lat : trip.pickup_lat);
    const lng = Number(status === "basladi" ? trip.dropoff_lng : trip.pickup_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    for (const url of navigationUrls(lat, lng)) {
      if (url.startsWith("http") || (await Linking.canOpenURL(url).catch(() => false))) {
        await Linking.openURL(url).catch(() => undefined);
        return;
      }
    }
  }

  /** Yalnızca geliştirme: GPS olmadan hedefe yakın bir konum gönderir (emülatör ve web önizlemesi). */
  async function simulateLocation() {
    if (!trip) return;
    const toDropoff = status === "basladi";
    const lat = Number(toDropoff ? trip.dropoff_lat : trip.pickup_lat) + (Math.random() - 0.5) * 0.004;
    const lng = Number(toDropoff ? trip.dropoff_lng : trip.pickup_lng) + (Math.random() - 0.5) * 0.004;
    const p = { latitude: lat, longitude: lng };
    positionRef.current = p;
    setPosition(p);
    try {
      if (sharing) await api(`driver/trips/${legId}/location`, { body: { lat, lng, heading: null } });
      setSimulated((n) => n + 1);
      setError(null);
      void refreshApproach();
    } catch (e) {
      setError(errorTextTr(e));
    }
  }

  if (!trip) {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        {error ? <Alert text={error} /> : <Loading />}
      </Screen>
    );
  }

  const next = NEXT_STEP[status];
  const idx = FLOW.indexOf(status);
  const toDropoff = status === "basladi";
  const pickupPt = trip.pickup_lat ? { latitude: Number(trip.pickup_lat), longitude: Number(trip.pickup_lng) } : null;
  const dropoffPt = trip.dropoff_lat ? { latitude: Number(trip.dropoff_lat), longitude: Number(trip.dropoff_lng) } : null;

  // Bitirme kuralı (K-49): sunucunun yarıçapı, yerel konumla anlık mesafe.
  const radius = approach?.finish_radius_m ?? null;
  const finishDistance = toDropoff && position && dropoffPt
    ? distanceM(position.latitude, position.longitude, dropoffPt.latitude, dropoffPt.longitude)
    : approach?.finish_distance_m ?? null;
  const canFinish = !toDropoff || (finishDistance !== null && radius !== null && finishDistance <= radius);

  // Harita: konum varsa sürücüden hedefe rota (hedef işaretli), yoksa yolculuk rotası.
  const useApproach = open && approach?.polyline;
  const mapRoute = useApproach ? approach?.polyline : trip.route_polyline;
  const stops = useApproach ? (toDropoff ? { dropoff: dropoffPt } : { pickup: pickupPt }) : undefined;
  const etaText = approach && open
    ? `${toDropoff ? "Varışa" : "Alışa"} ${approach.duration_minutes ?? "—"} dk${approach.distance_km !== null ? ` · ${fmtKm(Math.round(Number(approach.distance_km) * 1000))}` : ""}`
    : null;

  return (
    <>
      <MapSheet
        map={<MapCanvas seed={trip.booking_code} mode={sharing ? "driver" : "route"} focusTop={0.55}
          route={mapRoute} stops={stops} driver={open ? position : null}
          accessibilitySummary={`Harita: ${trip.pickup_region} → ${trip.dropoff_region}${open && position ? ". Konumunuz haritada işaretli." : ""}${etaText ? ` ${etaText}.` : ""}`} />}
        mapRatio={0.46}
        refreshing={false}
        onRefresh={load}
        overlay={
          <>
            <IconButton icon="arrow-back" label="Geri" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
            {etaText ? (
              <View style={[{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", gap: 6, alignItems: "center" }, shadow.card]}>
                <Ionicons name={toDropoff ? "flag" : "person"} size={14} color={colors.accent} />
                <T style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{etaText}</T>
              </View>
            ) : null}
            {open ? <IconButton icon="navigate" label="Haritalarda aç" dark onPress={openNavigation} /> : null}
          </>
        }
        bottom={next ? (
          <View style={{ gap: 6 }}>
            {toDropoff && !canFinish ? (
              <T style={[s.hint, { textAlign: "center" }]}>
                {finishDistance !== null && radius !== null
                  ? `Varışa ${fmtKm(finishDistance)}. ${fmtKm(radius)} içinde bitirebilirsiniz.`
                  : "Konumunuz alınınca yolculuğu bitirebilirsiniz."}
              </T>
            ) : null}
            <Button title={next.label} iconRight="arrow-forward" busy={busy} disabled={!canFinish} onPress={() => advance(next.event)}
              variant={toDropoff ? "accent" : "primary"} />
          </View>
        ) : undefined}
      >
        <Animated.View entering={FadeInDown.duration(400)} style={{ gap: 10 }}>
          <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.7 }}>{LEG_STATUS[status] ?? status}</T>
              <T style={s.hint}>{STAGE_HINT[status] ?? ""}</T>
            </View>
            <Badge text={trip.booking_code} tone="dark" />
          </Row>
          {idx >= 0 ? <ProgressSegments total={FLOW.length - 1} done={idx} color={sharing ? colors.ok : colors.ink} /> : null}
        </Animated.View>

        <Alert text={error} />
        {sharing && permission === "denied" ? (
          <Alert tone="danger" text="Konum izni verilmedi. Yolcu sizi canlı takip edemez ve yolculuğu bitiremezsiniz; ayarlardan izin verin." />
        ) : sharing ? (
          <Alert tone="ok" text={bgActive
            ? "Konumunuz yolcuyla paylaşılıyor. Uygulamadan çıksanız da paylaşım bildirim çubuğundan sürer."
            : backgroundSupported
              ? "Konumunuz paylaşılıyor. Arka planda da sürmesi için konum iznini \"Her zaman\" yapın."
              : "Konumunuz paylaşılıyor. Bu önizlemede uygulama açıkken paylaşılır."} />
        ) : null}
        {status === "bitti" && <Alert tone="ok" text="Yolculuk tamamlandı. Hakedişiniz Kazanç sekmesine eklendi." />}

        {/* Navigasyon: aşamaya göre hedef */}
        {open && (
          <Card elevated delay={40}>
            <Row style={{ flexWrap: "nowrap" }} gap={12}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={toDropoff ? "flag" : "person-circle"} size={22} color="#fff" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={s.hint}>{toDropoff ? "Varış noktası" : "Alış noktası"}</T>
                <T style={{ fontWeight: "700" }} numberOfLines={2}>
                  {toDropoff ? trip.dropoff_address ?? trip.dropoff_region : trip.pickup_address ?? trip.pickup_region}
                </T>
              </View>
            </Row>
            <Button title={toDropoff ? "Varışa yol tarifi" : "Alışa yol tarifi"} icon="navigate" variant="secondary" onPress={openNavigation} />
          </Card>
        )}

        <Card elevated delay={80}>
          <Row style={{ flexWrap: "nowrap" }} gap={14}>
            <Avatar name={trip.passenger_name} size={52} dark={false} />
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontWeight: "700", fontSize: 17 }}>{trip.passenger_name}</T>
              <T style={s.hint}>{trip.passenger_count} yolcu · {trip.luggage_count} bagaj{trip.flight_no ? ` · ${trip.flight_no}` : ""}</T>
            </View>
          </Row>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Yolcuya yaz, ${unread} okunmamış mesaj` : "Yolcuya yaz"}
              onPress={() => router.push(`/chat/${legId}`)}
              style={({ pressed }) => [{ flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 13, backgroundColor: colors.canvas }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="chatbubble-ellipses" size={18} color={colors.ink} />
              <T style={{ fontWeight: "700" }}>Mesaj</T>
              {unread > 0 ? (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                  <T style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{unread}</T>
                </View>
              ) : null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Karşılama tabelası" onPress={() => setSign(true)}
              style={({ pressed }) => [{ flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 13, backgroundColor: colors.canvas }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="easel-outline" size={18} color={colors.ink} />
              <T style={{ fontWeight: "700" }}>Karşılama tabelası</T>
            </Pressable>
          </View>
          <T style={s.hint}>Yolcu bilgileri yalnızca bu iş için gösterilir; telefon numaraları paylaşılmaz.</T>
        </Card>

        <Card delay={120}>
          <H2>Rota</H2>
          <RouteStops from={trip.pickup_region} to={trip.dropoff_region} fromHint={trip.pickup_address ?? undefined} toHint={trip.dropoff_address ?? undefined} />
          <Info icon="calendar-outline">{dateTime(trip.pickup_at)}</Info>
          {trip.flight_no ? <Info icon="airplane-outline">{driverFlightLine(trip.flight_no, trip.flight_status, trip.flight_estimated_at)}</Info> : null}
          {trip.distance_km ? <Info icon="speedometer-outline">{Number(trip.distance_km).toFixed(0)} km{trip.duration_minutes ? ` · ~${trip.duration_minutes} dk` : ""}</Info> : null}
          <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 14 }}>
            <Row spread>
              <T style={s.hint}>Kazancınız</T>
              <T style={{ fontWeight: "800", fontSize: 20 }}>{money(trip.driver_amount, trip.currency)}</T>
            </Row>
          </View>
        </Card>

        {open && __DEV__ && (
          <Button title={`Geliştirme: hedefe yakın konum${simulated ? ` (${simulated})` : ""}`} variant="secondary" icon="locate-outline" small onPress={simulateLocation} />
        )}
      </MapSheet>

      {/* Havalimanı karşılama tabelası: yolcu adı tam ekran, büyük harf. */}
      <Modal visible={sign} animationType="fade" onRequestClose={() => setSign(false)} supportedOrientations={["portrait", "landscape"]}>
        <Pressable onPress={() => setSign(false)} style={{ flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 24, gap: 24 }}>
          <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: "center", gap: 18 }}>
            <T style={{ color: colors.accent, fontWeight: "800", letterSpacing: 5, fontSize: 14 }}>GETAWAY TRANSFERS</T>
            <T style={{ fontSize: 54, fontWeight: "800", letterSpacing: -1.5, textAlign: "center", lineHeight: 58 }} adjustsFontSizeToFit numberOfLines={3}>
              {trip.passenger_name.toUpperCase()}
            </T>
            {trip.flight_no ? <T style={{ fontSize: 20, fontWeight: "600", color: colors.muted }}>{trip.flight_no}</T> : null}
          </Animated.View>
          <Row gap={6}>
            <Ionicons name="close-circle-outline" size={18} color={colors.faint} />
            <T style={{ color: colors.faint }}>Kapatmak için dokunun</T>
          </Row>
        </Pressable>
      </Modal>
    </>
  );
}
