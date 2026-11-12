import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert as NativeAlert, Image, Linking, Pressable, View } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import {
  DriverAvatar, DriverLanguages, MeetingGuideCard, PassengerStatus, RatingCard, ShareTrip, driverSubline, showPassengerStatus,
} from "@/components/MeetingTools";
import {
  Alert, Badge, Button, Card, H2, IconButton, Info, Loading, P, ProgressSegments, RouteStops, Row, Screen, T,
  Timeline, colors, s, statusTone,
} from "@/components/ui";
import { accessToken, api, wsUrl } from "@/lib/api";
import { reachable } from "@/lib/config";
import { clock, dateTime, money } from "@/lib/format";
import { LOCALE, errorText, statusLabel, t } from "@/lib/i18n";
import { customerLiveProps, endLiveTrip, showLiveTrip } from "@/lib/liveTrip";
import type { Booking, DriverLocation, Eta, RefundQuote } from "@/lib/types";
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
// K-60: uçuş takibi açıksa tahmini iniş saati (Türkiye saati) gösterilir.
function flightText(f: { flight_no: string; status: string | null; estimated_at: string | null }) {
  if (f.status === "iptal") return `${f.flight_no} · ${t("bookings.flightCancelled")}`;
  if (!f.estimated_at || !f.status || f.status === "bilinmiyor" || f.status === "yonlendirildi") return f.flight_no;
  const time = clock(f.estimated_at, LOCALE);
  return `${f.flight_no} · ${f.status === "indi" ? t("bookings.flightLanded", { time }) : t("bookings.flightEta", { time })}`;
}

export default function BookingScreen() {
  const { code, pay } = useLocalSearchParams<{ code: string; pay?: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refund, setRefund] = useState<RefundQuote | null>(null);
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingPayment, setWaitingPayment] = useState(false);
  const [eta, setEta] = useState<Eta | null>(null);
  const [unread, setUnread] = useState(0);
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
  const finished = !booking || ["iptal", "tamamlandi"].includes(booking.status);
  useEffect(() => {
    if (finished) return;
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [finished, load]);

  const tracking = booking?.legs.some((l) => TRACKABLE.includes(l.status)) ?? false;
  const hasDriver = booking?.legs.some((l) => l.driver && !["bitti", "iptal"].includes(l.status)) ?? false;

  // Sürücünün tahmini varış süresi (yolcu alınana kadar alışa, sonra varışa) (K-51).
  useEffect(() => {
    if (!tracking) return;
    const tick = () => api<Eta>(`me/bookings/${code}/eta`).then(setEta).catch(() => undefined);
    void tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [tracking, code]);

  // K-59: yolculuk durumu bildirim ekranında sabit (iOS Canlı Etkinlik, Android kalıcı bildirim).
  useEffect(() => {
    if (!booking) return;
    const l = booking.legs.find((x) => !["bitti", "iptal"].includes(x.status)) ?? booking.legs[booking.legs.length - 1];
    if (booking.status === "iptal") {
      void endLiveTrip(booking.booking_code);
      return;
    }
    const live = customerLiveProps({
      bookingStatus: booking.status,
      legStatus: l.status,
      from: l.pickup_region.name,
      to: l.dropoff_region.name,
      driver: l.driver,
      etaMinutes: eta?.eta_minutes ?? null,
      bookingType: booking.booking_type,
      pickupAt: l.pickup_at,
    });
    if (!live) return;
    if (live.done) void endLiveTrip(booking.booking_code, live.props);
    else void showLiveTrip(booking.booking_code, live.props, `getaway://booking/${booking.booking_code}`);
  }, [booking, eta]);

  // Okunmamış mesaj sayısı (K-50).
  useEffect(() => {
    if (!hasDriver) return;
    const tick = () => api<{ unread: number }>(`me/bookings/${code}/messages/unread`).then((r) => setUnread(r.unread)).catch(() => undefined);
    void tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [hasDriver, code]);

  // K-48: yolcu araçtayken yolculuk her an bitirilebilir; tamamlandı sayılır, iade yoktur.
  function confirmFinish() {
    NativeAlert.alert(t("finish.title"), t("finish.text"), [
      { text: t("finish.cancel"), style: "cancel" },
      { text: t("finish.confirm"), style: "destructive", onPress: () => void finishTrip() },
    ]);
  }

  async function finishTrip() {
    setBusy(true);
    try {
      setBooking(await api<Booking>(`me/bookings/${code}/finish`, { body: {} }));
      setNotice(t("finish.done"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

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
  const driverPos = tracking && location ? { latitude: location.lat, longitude: location.lng } : null;
  const mapSummary = t(driverPos ? "map.summaryDriver" : "map.summaryRoute", { from: leg.pickup_region.name, to: leg.dropoff_region.name });

  return (
    <MapSheet
      map={<MapCanvas seed={booking.booking_code} mode={mapMode} progress={progress} focusTop={0.55}
        route={leg.route_polyline} driver={driverPos} accessibilitySummary={mapSummary} />}
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
      ) : leg.status === "basladi" ? (
        <Button title={t("finish.button")} icon="flag" variant="secondary" busy={busy} onPress={confirmFinish} />
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
              <DriverAvatar code={booking.booking_code} driver={leg.driver} size={54} />
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: "700", fontSize: 17 }}>{leg.driver.first_name}</T>
                <T style={s.hint} numberOfLines={1}>{driverSubline(leg.driver)}</T>
                <DriverLanguages driver={leg.driver} />
              </View>
              <View style={{ borderWidth: 1.5, borderColor: colors.ink, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#fff" }}>
                <T style={{ fontWeight: "800", letterSpacing: 1, fontSize: 13 }}>{leg.driver.plate}</T>
              </View>
            </Row>
            {tracking ? (
              <View style={{ gap: 2 }}>
                <T style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4 }}>
                  {leg.status === "vardi"
                    ? t("track.arrived")
                    : leg.status === "basladi"
                      ? eta?.eta_minutes ? t("track.etaTrip", { min: eta.eta_minutes }) : t("track.onboard")
                      : eta?.eta_minutes ? t("track.eta", { min: eta.eta_minutes }) : statusLabel("leg", leg.status)}
                </T>
              </View>
            ) : null}
            {!["bitti", "iptal"].includes(leg.status) ? (
              <Pressable accessibilityRole="button" accessibilityLabel={unread ? `${t("chat.open")} (${unread})` : t("chat.open")}
                onPress={() => router.push(`/chat/${booking.booking_code}`)}
                style={({ pressed }) => [{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 13, backgroundColor: colors.canvas }, pressed && { opacity: 0.8 }]}>
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.ink} />
                <T style={{ fontWeight: "700" }}>{t("chat.open")}</T>
                {unread > 0 ? (
                  <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                    <T style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{unread}</T>
                  </View>
                ) : null}
              </Pressable>
            ) : null}
            {showPassengerStatus(leg) ? (
              <PassengerStatus code={booking.booking_code} leg={leg}
                onChange={(st) => setBooking((b) => b && { ...b, legs: b.legs.map((x) => (x.id === leg.id ? { ...x, passenger_status: st } : x)) })} />
            ) : null}
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

      {leg.pickup_region.type === "havalimani" && !["bitti", "iptal"].includes(leg.status) && booking.status !== "odeme_bekliyor" ? (
        <MeetingGuideCard code={booking.booking_code} />
      ) : null}
      {["onaylandi", "atandi", "yolculukta"].includes(booking.status) ? <ShareTrip code={booking.booking_code} /> : null}
      {booking.status === "tamamlandi" ? (
        <RatingCard code={booking.booking_code} driverName={[...booking.legs].reverse().find((l) => l.driver)?.driver?.first_name ?? ""} />
      ) : null}

      <Card delay={140}>
        <H2>{t("bookings.details")}</H2>
        {booking.legs.map((l, i) => (
          <View key={l.id} style={{ gap: 10 }}>
            {booking.legs.length > 1 ? <T style={[s.hint, { fontWeight: "700" }]}>{i === 0 ? "1 · " : "2 · "}{dateTime(l.pickup_at, LOCALE)}</T> : null}
            <RouteStops from={l.pickup_region.name} to={l.dropoff_region.name} fromHint={l.pickup_address ?? undefined} toHint={l.dropoff_address ?? undefined} />
            {l.flight ? <Info icon="airplane-outline" label={t("bookings.flight")}>{flightText(l.flight)}</Info> : null}
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <Row spread style={{ flexWrap: "nowrap" }}>
          <View style={{ gap: 2, flex: 1 }}>
            <T style={s.hint}>{t("bookings.vehicle")}</T>
            <T style={{ fontWeight: "700" }}>{booking.vehicle_type.name}</T>
            <T style={s.hint}>{booking.passenger_name} · {booking.passenger_count} · {booking.luggage_count}</T>
            {booking.child_seat_count ? <T style={s.hint}>{t("meet.childSeatCount", { count: booking.child_seat_count })}</T> : null}
            {booking.market_stop ? <T style={s.hint}>{t("meet.marketStop")}</T> : null}
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
