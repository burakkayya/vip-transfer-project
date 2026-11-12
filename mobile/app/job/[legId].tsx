import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import { Alert, Badge, Button, Card, IconButton, Info, Loading, RouteStops, Row, Screen, T, colors, s } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import { decodePolyline } from "@/lib/polyline";
import type { Job, Trip } from "@/lib/types";

function Chip(props: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.canvas, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
      <Ionicons name={props.icon} size={15} color={colors.ink} />
      <T style={{ fontSize: 13, fontWeight: "600" }}>{props.text}</T>
    </View>
  );
}

/**
 * İş ayrıntısı (K-47): sürücü kabul etmeden önce rota haritası, alış zamanı, mesafe, süre ve kazancı görür.
 * Kesin adres ve yolcu adı kabul sonrası açılır; haritada uçlar kırpılmıştır. Kabul et → yolculuk ekranı,
 * Reddet → iş bu sürücünün havuzundan kalkar.
 */
export default function JobScreen() {
  const { legId } = useLocalSearchParams<{ legId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      const q = pos ? `?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}` : "";
      setJob(await api<Job>(`driver/jobs/${legId}${q}`));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && ["already_taken", "not_found"].includes(e.code)) setGone(true);
      setError(errorTextTr(e));
    }
  }, [legId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!job?.offer_expires_at) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job?.offer_expires_at]);

  async function accept() {
    setBusy("accept");
    try {
      const trip = await api<Trip>(`driver/jobs/${legId}/accept`, { body: {} });
      router.replace(`/trip/${trip.leg_id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "already_taken") setGone(true);
      setError(errorTextTr(e));
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    try {
      await api(`driver/jobs/${legId}/decline`, { body: {} });
      router.back();
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(null);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  if (!job) {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        {error ? (
          <>
            <Alert text={gone ? "Bu iş artık havuzda değil: başka bir sürücü aldı veya iptal edildi." : error} tone={gone ? "warn" : "danger"} />
            <Button title="İşlere dön" variant="secondary" icon="arrow-back" onPress={back} />
          </>
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const points = job.preview_polyline ? decodePolyline(job.preview_polyline) : [];
  const left = job.offer_expires_at ? Math.max(0, Math.round((new Date(job.offer_expires_at).getTime() - now) / 1000)) : null;
  const instant = job.booking_type === "anlik";

  return (
    <MapSheet
      map={
        <MapCanvas seed={job.leg_id} mode="route" focusTop={0.5} route={job.preview_polyline}
          stops={{ pickup: points[0], dropoff: points.length > 1 ? points[points.length - 1] : null }}
          accessibilitySummary={`Harita: ${job.pickup_region} → ${job.dropoff_region}, yaklaşık ${Number(job.distance_km).toFixed(0)} km`} />
      }
      mapRatio={0.42}
      overlay={
        <>
          <IconButton icon="arrow-back" label="Geri" onPress={back} />
          <View style={{ backgroundColor: instant ? colors.accent : colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}>
            <T style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 0.5 }}>{instant ? "ANLIK İŞ" : "PLANLI İŞ"}</T>
          </View>
        </>
      }
      bottom={
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Reddet" variant="secondary" icon="close" onPress={decline} busy={busy === "decline"} disabled={busy !== null || gone} style={{ flex: 1 }} />
          <Button title="Kabul et" icon="checkmark" onPress={accept} busy={busy === "accept"}
            disabled={busy !== null || gone || left === 0} style={{ flex: 2 }} />
        </View>
      }
    >
      <Animated.View entering={FadeInDown.duration(400)} style={{ gap: 6 }}>
        <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={s.hint}>Kazancınız</T>
            <T style={{ fontSize: 34, fontWeight: "800", letterSpacing: -1 }}>{money(job.driver_amount, job.currency)}</T>
          </View>
          {left !== null ? (
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <T style={s.hint}>Teklif süresi</T>
              <T style={{ fontSize: 24, fontWeight: "800", color: left <= 10 ? colors.danger : colors.ink }}>{left} sn</T>
            </View>
          ) : (
            <Badge text={job.vehicle_type} tone="dark" />
          )}
        </Row>
        <T style={{ fontWeight: "700", fontSize: 16 }}>{dateTime(job.pickup_at)}</T>
      </Animated.View>

      <Alert text={error} tone={gone ? "warn" : "danger"} />

      <Card elevated delay={60}>
        <RouteStops from={job.pickup_region} to={job.dropoff_region}
          fromHint={job.pickup_distance_km !== null ? `Size ${Number(job.pickup_distance_km).toLocaleString("tr-TR")} km` : undefined} />
        <Row gap={8}>
          <Chip icon="speedometer-outline" text={`${Number(job.distance_km).toFixed(0)} km`} />
          {job.duration_minutes ? <Chip icon="time-outline" text={`~${job.duration_minutes} dk`} /> : null}
          <Chip icon="people-outline" text={`${job.passenger_count} yolcu`} />
          <Chip icon="briefcase-outline" text={`${job.luggage_count} bagaj`} />
          {job.has_flight ? <Chip icon="airplane-outline" text="Uçuş var" /> : null}
          {job.child_seat_count ? <Chip icon="happy-outline" text={`${job.child_seat_count} çocuk koltuğu`} /> : null}
          {job.market_stop ? <Chip icon="basket-outline" text="Market molası" /> : null}
        </Row>
      </Card>

      <Card flat delay={120}>
        <Info icon="person-outline" label="Yolcu">{job.passenger_initial} · ad ve kesin adres kabul sonrası görünür</Info>
        <Info icon="car-outline" label="Araç tipi">{job.vehicle_type}</Info>
        <Info icon="receipt-outline" label="Rezervasyon">{job.booking_code} · sabit fiyat, önceden ödendi</Info>
      </Card>
      <T style={[s.hint, { textAlign: "center" }]}>Haritada alış ve varış noktaları gizlilik için yaklaşık gösterilir.</T>
    </MapSheet>
  );
}
