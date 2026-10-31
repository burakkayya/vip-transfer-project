import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import {
  Alert, Avatar, Badge, Button, Card, H2, IconButton, Info, Loading, P, ProgressSegments, RouteStops, Row, Screen, T,
  Timeline, colors, s, statusTone,
} from "@/components/ui";
import { accessToken, api, wsUrl } from "@/lib/api";
import { reachable } from "@/lib/config";
import { dateTime, money } from "@/lib/format";
import { LOCALE, errorText, statusLabel, t } from "@/lib/i18n";
import type { Booking, DriverLocation, RefundQuote } from "@/lib/types";
import { VEHICLE_IMAGE } from "@/lib/vehicles";

const TRACKABLE = ["yolda", "vardi", "basladi"];
const CANCELLABLE = ["odeme_bekliyor", "onaylandi", "atandi"];
const LEG_FLOW = ["beklemede", "atandi", "yolda", "vardi", "basladi", "bitti"];

/** Sürücü aranırken dönen halka. */
function Searching() {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
  }, [r]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 0.6 + r.value * 0.8 }], opacity: 1 - r.value }));
  return (
    <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent }, st]} />
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="car" size={16} color="#fff" />
      </View>
    </View>
  );
}

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

  if (!booking) {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        {error ? <Alert text={error} /> : <Loading />}
      </Screen>
    );
  }

  const fmt = (a: string) => money(a, booking.currency, LOCALE);
  const leg = booking.legs.find((l) => !["bitti", "iptal"].includes(l.status)) ?? booking.legs[0];
  const legIdx = LEG_FLOW.indexOf(leg.status);
  // Sürücü atanana kadar rezervasyon durumu, sonra yolculuk adımı başlık olur.
  const headline = leg.status === "beklemede" || ["odeme_bekliyor", "iptal", "tamamlandi"].includes(booking.status)
    ? statusLabel("status", booking.status)
    : statusLabel("leg", leg.status);
  const mapMode = tracking ? "driver" : booking.status === "iptal" ? "idle" : "route";
  const progress = leg.status === "vardi" ? 0 : undefined;

  return (
    <MapSheet
      map={<MapCanvas seed={booking.booking_code} mode={mapMode} progress={progress} focusTop={0.55} />}
      mapRatio={0.42}
      refreshing={false}
      onRefresh={load}
      overlay={
        <>
          <IconButton icon="arrow-back" label={t("back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/bookings"))} />
          <View style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}>
            <T style={{ color: "#fff", fontWeight: "700", letterSpacing: 1.5, fontSize: 13 }}>{booking.booking_code}</T>
          </View>
        </>
      }
      bottom={booking.status === "odeme_bekliyor" ? (
        <Button title={`${t("bookings.payNow")} · ${fmt(booking.total_amount)}`} icon="card" onPress={startPayment} />
      ) : undefined}
    >
      <Animated.View entering={FadeInDown.duration(400)} style={{ gap: 10 }}>
        <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.7 }}>{headline}</T>
            <T style={s.hint}>{dateTime(leg.pickup_at, LOCALE)}</T>
          </View>
          <Badge text={statusLabel("status", booking.status)} tone={statusTone(booking.status)} />
        </Row>
        {booking.status !== "iptal" && booking.status !== "odeme_bekliyor" ? (
          <ProgressSegments total={LEG_FLOW.length} done={Math.max(1, legIdx + 1)} color={tracking ? colors.ok : colors.ink} />
        ) : null}
      </Animated.View>

      <Alert text={error} />
      <Alert text={notice} tone="ok" />
      {waitingPayment && booking.status === "odeme_bekliyor" ? <Alert tone="warn" text={t("bookings.paymentWaiting")} /> : null}

      {booking.status !== "iptal" && booking.status !== "odeme_bekliyor" && (
        leg.driver ? (
          <Card elevated delay={80}>
            <Row style={{ flexWrap: "nowrap" }} gap={14}>
              <Avatar name={leg.driver.first_name} size={54} />
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: "700", fontSize: 17 }}>{leg.driver.first_name}</T>
                <T style={s.hint} numberOfLines={1}>{leg.driver.vehicle}</T>
              </View>
              <View style={{ borderWidth: 1.5, borderColor: colors.ink, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#fff" }}>
                <T style={{ fontWeight: "800", letterSpacing: 1, fontSize: 13 }}>{leg.driver.plate}</T>
              </View>
            </Row>
            {tracking ? (
              <View style={{ backgroundColor: colors.okSoft, borderRadius: 14, padding: 12, gap: 4 }}>
                <Row gap={8}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok }} />
                  <T style={{ fontWeight: "700", color: colors.ok }}>{t("bookings.live")}</T>
                </Row>
                {location ? (
                  <>
                    <T style={[s.hint, { color: "#2D5A43" }]}>{t("bookings.liveUpdated", { time: dateTime(location.at, LOCALE) })}</T>
                    <T style={{ color: colors.ink, fontWeight: "600", textDecorationLine: "underline" }}
                      onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=16/${location.lat}/${location.lng}`)}>
                      {t("bookings.openMap")} ›
                    </T>
                  </>
                ) : (
                  <T style={[s.hint, { color: "#2D5A43" }]}>{t("bookings.liveNone")}</T>
                )}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card flat delay={80}>
            <Row gap={14} style={{ flexWrap: "nowrap" }}>
              <Searching />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: "700" }}>{t("bookings.driverPending")}</T>
                <T style={s.hint}>{t("home.promoText")}</T>
              </View>
            </Row>
          </Card>
        )
      )}

      <Card delay={140}>
        <H2>{t("bookings.details")}</H2>
        {booking.legs.map((l, i) => (
          <View key={l.id} style={{ gap: 10 }}>
            {booking.legs.length > 1 ? <T style={[s.hint, { fontWeight: "700" }]}>{i === 0 ? "1 · " : "2 · "}{dateTime(l.pickup_at, LOCALE)}</T> : null}
            <RouteStops from={l.pickup_region.name} to={l.dropoff_region.name} fromHint={l.pickup_address ?? undefined} toHint={l.dropoff_address ?? undefined} />
            {l.flight ? <Info icon="airplane-outline" label={t("bookings.flight")}>{l.flight.flight_no}</Info> : null}
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <Row spread style={{ flexWrap: "nowrap" }}>
          <View style={{ gap: 2, flex: 1 }}>
            <T style={s.hint}>{t("bookings.vehicle")}</T>
            <T style={{ fontWeight: "700" }}>{booking.vehicle_type.name}</T>
            <T style={s.hint}>{booking.passenger_name} · {booking.passenger_count} · {booking.luggage_count}</T>
          </View>
          {VEHICLE_IMAGE[booking.vehicle_type.code] ? (
            <Image source={VEHICLE_IMAGE[booking.vehicle_type.code]} style={{ width: 110, height: 70, mixBlendMode: "multiply" } as object} resizeMode="contain" />
          ) : null}
        </Row>
        <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 14 }}>
          <Row spread>
            <P muted>{t("book.total")}</P>
            <T style={{ fontWeight: "800", fontSize: 20, letterSpacing: -0.4 }}>{fmt(booking.total_amount)}</T>
          </Row>
        </View>
      </Card>

      {booking.status !== "iptal" && booking.status !== "odeme_bekliyor" && (
        <Card delay={200}>
          <Timeline current={leg.status} steps={LEG_FLOW.map((k) => ({ key: k, label: statusLabel("leg", k) }))} />
        </Card>
      )}

      {CANCELLABLE.includes(booking.status) && !refund && (
        <Pressable onPress={previewCancel} style={{ alignSelf: "center", padding: 10, flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
          <T style={{ color: colors.danger, fontWeight: "600" }}>{t("bookings.cancel")}</T>
        </Pressable>
      )}
      {refund && (
        <Card style={{ borderColor: colors.danger }}>
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
      {booking.status !== "iptal" && booking.status !== "tamamlandi" && <P muted small center>{t("bookings.change")}</P>}
    </MapSheet>
  );
}
