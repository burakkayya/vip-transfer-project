import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Modal, Platform, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import {
  Alert, Avatar, Badge, Button, Card, H2, IconButton, Info, Loading, ProgressSegments, RouteStops, Row, Screen, T, colors, s,
  statusTone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { LEG_STATUS, NEXT_STEP } from "@/lib/driverLabels";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Trip } from "@/lib/types";

const SHARING = ["yolda", "vardi", "basladi"];
const FLOW = ["atandi", "yolda", "vardi", "basladi", "bitti"];
const LOCATION_INTERVAL_MS = 10_000;

const STAGE_HINT: Record<string, string> = {
  atandi: "Hazır olduğunuzda yola çıkın. Yolcu canlı takibi o an başlar.",
  yolda: "Alış noktasına gidiyorsunuz. Konumunuz yolcuyla paylaşılıyor.",
  vardi: "Yolcuyu karşılayın. Havalimanında karşılama tabelasını kullanın.",
  basladi: "Yolcu araçta. Varışta yolculuğu tamamlayın.",
  bitti: "Yolculuk tamamlandı. Hakedişiniz Kazanç sekmesine eklendi.",
};

/**
 * Sürücü ekranları 5, 6, 9: yolculuk akışı, navigasyon ve karşılama bilgisi, canlı konum paylaşımı.
 * Konum yalnızca aktif yolculukta ve bu ekran açıkken paylaşılır.
 */
export default function TripScreen() {
  const { legId } = useLocalSearchParams<{ legId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<"off" | "on" | "denied">("off");
  const [simulated, setSimulated] = useState(0);
  const [sign, setSign] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api<Trip[]>("driver/trips?include_past=true");
      setTrip(all.find((x) => x.leg_id === legId) ?? null);
    } catch (e) {
      setError(errorTextTr(e));
    }
  }, [legId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = trip ? SHARING.includes(trip.status) : false;

  useEffect(() => {
    if (!active) {
      setSharing("off");
      return;
    }
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setSharing("denied");
        return;
      }
      if (cancelled) return;
      setSharing("on");
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: LOCATION_INTERVAL_MS, distanceInterval: 25 },
        (pos) => {
          const heading = pos.coords.heading !== null && pos.coords.heading >= 0 ? pos.coords.heading : null;
          void api(`driver/trips/${legId}/location`, {
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude, heading },
          }).catch(() => undefined);
        },
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active, legId]);

  async function advance(event: string) {
    setBusy(true);
    setError(null);
    try {
      setTrip(await api<Trip>(`driver/trips/${legId}/events`, { body: { event } }));
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  /** Yalnızca geliştirme: GPS olmadan (ör. web önizlemesi) canlı takibi denemek için alış noktası çevresinde konum gönderir. */
  async function simulateLocation() {
    if (!trip?.pickup_lat || !trip.pickup_lng) return;
    const jitter = () => (Math.random() - 0.5) * 0.01;
    try {
      await api(`driver/trips/${legId}/location`, {
        body: { lat: Number(trip.pickup_lat) + jitter(), lng: Number(trip.pickup_lng) + jitter(), heading: null },
      });
      setError(null);
      setSimulated((n) => n + 1);
    } catch (e) {
      setError(errorTextTr(e));
    }
  }

  function navigate() {
    if (!trip?.pickup_lat || !trip.pickup_lng) return;
    const dest = `${trip.pickup_lat},${trip.pickup_lng}`;
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${dest}`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    void Linking.openURL(url);
  }

  if (!trip) {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        {error ? <Alert text={error} /> : <Loading />}
      </Screen>
    );
  }
  const next = NEXT_STEP[trip.status];
  const idx = FLOW.indexOf(trip.status);

  return (
    <>
      <MapSheet
        map={<MapCanvas seed={trip.booking_code} mode={active ? "driver" : "route"} progress={trip.status === "vardi" ? 0 : undefined} focusTop={0.55} />}
        mapRatio={0.4}
        refreshing={false}
        onRefresh={load}
        overlay={
          <>
            <IconButton icon="arrow-back" label="Geri" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
            {trip.pickup_lat ? <IconButton icon="navigate" label="Navigasyon" dark onPress={navigate} /> : null}
          </>
        }
        bottom={next ? (
          <Button title={next.label} iconRight="arrow-forward" busy={busy} onPress={() => advance(next.event)}
            variant={trip.status === "basladi" ? "accent" : "primary"} />
        ) : undefined}
      >
        <Animated.View entering={FadeInDown.duration(400)} style={{ gap: 10 }}>
          <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.7 }}>{LEG_STATUS[trip.status] ?? trip.status}</T>
              <T style={s.hint}>{STAGE_HINT[trip.status] ?? ""}</T>
            </View>
            <Badge text={trip.booking_code} tone="dark" />
          </Row>
          {idx >= 0 ? <ProgressSegments total={FLOW.length - 1} done={idx} color={active ? colors.ok : colors.ink} /> : null}
        </Animated.View>

        <Alert text={error} />
        {active && (
          <Alert
            tone={sharing === "denied" ? "danger" : "ok"}
            text={sharing === "denied"
              ? "Konum izni verilmedi. Yolcu sizi canlı takip edemez; ayarlardan izin verin."
              : "Konumunuz bu yolculuk boyunca yolcuyla paylaşılıyor. Ekranı açık tutun."}
          />
        )}
        {trip.status === "bitti" && <Alert tone="ok" text="Yolculuk tamamlandı. Hakedişiniz Kazanç sekmesine eklendi." />}

        <Card elevated delay={60}>
          <Row style={{ flexWrap: "nowrap" }} gap={14}>
            <Avatar name={trip.passenger_name} size={52} dark={false} />
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontWeight: "700", fontSize: 17 }}>{trip.passenger_name}</T>
              <T style={s.hint}>{trip.passenger_count} yolcu · {trip.luggage_count} bagaj</T>
            </View>
            {trip.flight_no ? (
              <View style={{ alignItems: "flex-end" }}>
                <T style={s.hint}>Uçuş</T>
                <T style={{ fontWeight: "800", letterSpacing: 0.5 }}>{trip.flight_no}</T>
              </View>
            ) : null}
          </Row>
          <Button title="Karşılama tabelasını aç" icon="easel-outline" variant="secondary" onPress={() => setSign(true)} />
          <T style={s.hint}>Yolcu bilgileri yalnızca bu iş için gösterilir.</T>
        </Card>

        <Card delay={120}>
          <H2>Rota</H2>
          <RouteStops from={trip.pickup_region} to={trip.dropoff_region} fromHint={trip.pickup_address ?? undefined} toHint={trip.dropoff_address ?? undefined} />
          <Info icon="calendar-outline">{dateTime(trip.pickup_at)}</Info>
          <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 14 }}>
            <Row spread>
              <T style={s.hint}>Kazancınız</T>
              <T style={{ fontWeight: "800", fontSize: 20 }}>{money(trip.driver_amount, trip.currency)}</T>
            </Row>
          </View>
          {trip.pickup_lat ? <Button title="Alış noktasına navigasyon" icon="navigate-outline" variant="secondary" onPress={navigate} /> : null}
        </Card>

        {active && __DEV__ && (
          <Button title={`Geliştirme: konum gönder${simulated ? ` (${simulated})` : ""}`} variant="secondary" icon="locate-outline" small onPress={simulateLocation} />
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
