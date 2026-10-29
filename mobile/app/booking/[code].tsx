import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Alert, Badge, Button, Card, H2, Info, Loading, P, Row, Screen, Timeline, colors, s, statusTone } from "@/components/ui";
import { accessToken, api, wsUrl } from "@/lib/api";
import { reachable } from "@/lib/config";
import { dateTime, money } from "@/lib/format";
import { LOCALE, errorText, statusLabel, t } from "@/lib/i18n";
import type { Booking, DriverLocation, RefundQuote } from "@/lib/types";

const TRACKABLE = ["yolda", "vardi", "basladi"];
const CANCELLABLE = ["odeme_bekliyor", "onaylandi", "atandi"];
const LEG_FLOW = ["beklemede", "atandi", "yolda", "vardi", "basladi", "bitti"];

/** Müşteri ekranları 2, 4, 5: rezervasyon detayı, ödeme, canlı takip, iptal. */
export default function BookingScreen() {
  const { code, pay } = useLocalSearchParams<{ code: string; pay?: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refund, setRefund] = useState<RefundQuote | null>(null);
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingPayment, setWaitingPayment] = useState(false);
  const autoPay = useRef(pay === "1");

  const load = useCallback(async () => {
    try {
      const b = await api<Booking>(`me/bookings/${code}`);
      setBooking(b);
      return b;
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, [code]);

  const startPayment = useCallback(async () => {
    setError(null);
    try {
      const c = await api<{ iframe_url: string }>(`me/bookings/${code}/payments`, { body: {} });
      setWaitingPayment(true);
      // Kart bilgisi sağlayıcının sayfasında girilir; uygulama kart verisine erişmez.
      await WebBrowser.openBrowserAsync(reachable(c.iframe_url));
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }, [code, load]);

  useEffect(() => {
    load().then((b) => {
      if (b && autoPay.current && b.status === "odeme_bekliyor") {
        autoPay.current = false;
        void startPayment();
      }
    });
  }, [load, startPayment]);

  // Ödeme bildirimi gelene kadar durum yoklanır.
  useEffect(() => {
    if (!waitingPayment || booking?.status !== "odeme_bekliyor") return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [waitingPayment, booking?.status, load]);

  // Atama ve yolculuk adımları için durum periyodik yenilenir.
  useEffect(() => {
    if (!booking || ["iptal", "tamamlandi"].includes(booking.status)) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [booking, load]);

  const tracking = booking?.legs.some((l) => TRACKABLE.includes(l.status)) ?? false;

  // Canlı konum WebSocket ile gelir; jeton URL'de değil ilk mesajda gönderilir.
  useEffect(() => {
    if (!tracking) return;
    const ws = new WebSocket(wsUrl(`ws/bookings/${code}/location`));
    ws.onopen = () => ws.send(JSON.stringify({ token: accessToken() }));
    ws.onmessage = (m) => {
      const data = JSON.parse(String(m.data)) as { location: DriverLocation | null };
      setLocation(data.location);
    };
    return () => ws.close();
  }, [tracking, code]);

  async function previewCancel() {
    try {
      setRefund(await api<RefundQuote>(`me/bookings/${code}/cancellation`));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      setBooking(await api<Booking>(`me/bookings/${code}/cancel`, { body: {} }));
      setRefund(null);
      setNotice(t("bookings.cancelled"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!booking) return <Screen>{error ? <Alert text={error} /> : <Loading />}</Screen>;
  const fmt = (a: string) => money(a, booking.currency, LOCALE);

  return (
    <Screen refreshing={false} onRefresh={load}>
      <Stack.Screen options={{ title: booking.booking_code }} />
      <Alert text={error} />
      <Alert text={notice} tone="ok" />
      <Card elevated>
        <Row spread>
          <View>
            <Text style={s.hint}>{booking.vehicle_type.name} · {booking.passenger_count} · {booking.luggage_count}</Text>
            <Text style={[s.h1, { letterSpacing: 2 }]}>{booking.booking_code}</Text>
          </View>
          <Badge text={statusLabel("status", booking.status)} tone={statusTone(booking.status)} />
        </Row>
        <Row spread>
          <P muted>{booking.passenger_name}</P>
          <Text style={s.price}>{fmt(booking.total_amount)}</Text>
        </Row>
      </Card>

      {booking.status === "odeme_bekliyor" && (
        <Card style={{ borderColor: colors.ink, borderWidth: 1.5 }}>
          {waitingPayment && <Alert tone="warn" text={t("bookings.paymentWaiting")} />}
          <Button title={t("bookings.payNow")} icon="card-outline" variant="accent" onPress={startPayment} />
        </Card>
      )}

      {booking.legs.map((leg) => (
        <Card key={leg.id}>
          <H2>{leg.pickup_region.name} → {leg.dropoff_region.name}</H2>
          <Info icon="calendar-outline">{dateTime(leg.pickup_at, LOCALE)}</Info>
          {(leg.pickup_address || leg.dropoff_address) && (
            <Info icon="location-outline">{[leg.pickup_address, leg.dropoff_address].filter(Boolean).join(" → ")}</Info>
          )}
          {leg.flight && <Info icon="airplane-outline">{t("bookings.flight")}: {leg.flight.flight_no}</Info>}
          {leg.driver ? (
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.brandSoft, borderRadius: 12, padding: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{leg.driver.first_name.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <P bold>{leg.driver.first_name}</P>
                <P muted small>{leg.driver.vehicle} · {leg.driver.plate}</P>
              </View>
            </View>
          ) : (
            <Info icon="time-outline">{t("bookings.driverPending")}</Info>
          )}
          {TRACKABLE.includes(leg.status) && (
            <View style={{ backgroundColor: "#edf7f1", borderRadius: 12, padding: 12, gap: 6 }}>
              <Row>
                <Ionicons name="radio" size={18} color={colors.ok} />
                <P bold>{t("bookings.live")}</P>
              </Row>
              {location ? (
                <>
                  <P small>{t("bookings.liveUpdated", { time: dateTime(location.at, LOCALE) })}</P>
                  <Text style={{ color: colors.brand, fontWeight: "600" }}
                    onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=16/${location.lat}/${location.lng}`)}>
                    {t("bookings.openMap")} ›
                  </Text>
                </>
              ) : (
                <P muted small>{t("bookings.liveNone")}</P>
              )}
            </View>
          )}
          {leg.status !== "iptal" && (
            <Timeline current={leg.status} steps={LEG_FLOW.map((k) => ({ key: k, label: statusLabel("leg", k) }))} />
          )}
        </Card>
      ))}

      {CANCELLABLE.includes(booking.status) && !refund && (
        <Button title={t("bookings.cancel")} variant="secondary" icon="close-circle-outline" onPress={previewCancel} />
      )}
      {refund && (
        <Card>
          <P>
            {booking.status === "odeme_bekliyor"
              ? t("bookings.cancelNoPay")
              : t("bookings.cancelPreview", { percent: refund.refund_percent, amount: fmt(refund.refund_amount) })}
            {refund.guarantee_applied ? ` ${t("bookings.cancelGuarantee")}` : ""}
          </P>
          <Button title={t("bookings.cancelConfirm")} variant="danger" busy={busy} onPress={cancel} />
          <Button title={t("bookings.keep")} variant="secondary" onPress={() => setRefund(null)} />
        </Card>
      )}
      {booking.status !== "iptal" && booking.status !== "tamamlandi" && <P muted small>{t("bookings.change")}</P>}
    </Screen>
  );
}
