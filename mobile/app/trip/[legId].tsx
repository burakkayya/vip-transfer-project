import * as Location from "expo-location";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { Alert, Badge, Button, Card, H2, Loading, P, Row, Screen, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { LEG_STATUS, NEXT_STEP } from "@/lib/driverLabels";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Trip } from "@/lib/types";

const SHARING = ["yolda", "vardi", "basladi"];
const LOCATION_INTERVAL_MS = 10_000;

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

  /** Yalnızca geliştirme: GPS olmadan (ör. VS Code web önizlemesi) canlı takibi denemek için alış noktası çevresinde konum gönderir. */
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

  if (!trip) return <Screen>{error ? <Alert text={error} /> : <Loading />}</Screen>;
  const next = NEXT_STEP[trip.status];

  return (
    <Screen refreshing={false} onRefresh={load}>
      <Stack.Screen options={{ title: trip.booking_code }} />
      <Alert text={error} />
      <Card>
        <Row spread>
          <H2>{dateTime(trip.pickup_at)}</H2>
          <Badge text={LEG_STATUS[trip.status] ?? trip.status} tone={statusTone(trip.status)} />
        </Row>
        <P bold>{trip.pickup_region} → {trip.dropoff_region}</P>
        {trip.pickup_address && <P>Alış: {trip.pickup_address}</P>}
        {trip.dropoff_address && <P>Bırakış: {trip.dropoff_address}</P>}
      </Card>

      <Card>
        <H2>Karşılama</H2>
        <P>Yolcu: {trip.passenger_name}</P>
        <P>{trip.passenger_count} yolcu · {trip.luggage_count} bagaj</P>
        {trip.flight_no && <P>Uçuş: {trip.flight_no}</P>}
        <P muted small>Karşılama tabelasında yolcu adını kullanın. Yolcu bilgileri yalnızca bu iş için gösterilir.</P>
      </Card>

      <Card>
        <P>Kazancınız: {money(trip.driver_amount, trip.currency)}</P>
        <Button title="Alış noktasına navigasyon" variant="secondary" onPress={navigate} />
      </Card>

      {active && (
        <Alert
          tone={sharing === "denied" ? "danger" : "ok"}
          text={sharing === "denied"
            ? "Konum izni verilmedi. Yolcu sizi canlı takip edemez; ayarlardan izin verin."
            : "Konumunuz bu yolculuk boyunca yolcuyla paylaşılıyor. Ekranı açık tutun."}
        />
      )}

      {active && __DEV__ && (
        <Button title={`Geliştirme: konum gönder${simulated ? ` (${simulated})` : ""}`} variant="secondary" icon="locate-outline" onPress={simulateLocation} />
      )}
      {next && <Button title={next.label} icon="arrow-forward-circle" busy={busy} onPress={() => advance(next.event)} />}
      {trip.status === "bitti" && <Alert tone="ok" text="Yolculuk tamamlandı. Hakedişiniz Kazanç sekmesine eklendi." />}
    </Screen>
  );
}
