import Ionicons from "@/components/Icon";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Alert, Badge, Button, Hero, RouteStops, Row, Screen, Segmented, Skeleton, T, colors, rtlFlip, s, shadow, statusTone, tap } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { regionName } from "@/lib/airports";
import { LOCALE, errorText, statusLabel, t } from "@/lib/i18n";
import type { Booking } from "@/lib/types";
import { VEHICLE_IMAGE, vehicleName } from "@/lib/vehicles";

const DONE = ["tamamlandi", "iptal", "odeme_basarisiz"];

/** Müşteri ekranı 2: rezervasyonlarım (yaklaşan / geçmiş). */
export default function Bookings() {
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const load = useCallback(async () => {
    try {
      setList(await api<Booking[]>("me/bookings"));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const shown = (list ?? []).filter((b) => (tab === "past") === DONE.includes(b.status));

  return (
    <Screen canvas
      header={<Hero title={t("tabs.bookings")} subtitle={t("bookings.heroText")} />}
      refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "upcoming", label: t("bookings.upcoming") }, { value: "past", label: t("bookings.past") }]} />
      <Alert text={error} />
      {list === null && !error && [0, 1, 2].map((i) => <Skeleton key={i} height={150} radius={22} />)}
      {list !== null && shown.length === 0 && (
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 12 }}>
          <View style={{ width: 220, height: 96, alignItems: "center", justifyContent: "flex-end" }}>
            <View style={{ position: "absolute", bottom: 10, left: 0, right: 0, height: 2, backgroundColor: colors.line }} />
            <Image source={require("@/assets/images/vito-side.png")} style={{ width: 200, height: 80 }} resizeMode="contain" />
          </View>
          <T style={{ fontSize: 19, fontWeight: "800", letterSpacing: -0.4 }}>{t("bookings.emptyTitle")}</T>
          <T style={[s.hint, { textAlign: "center", fontSize: 14 }]}>{t("bookings.empty")}</T>
          <Button title={t("bookings.emptyCta")} icon="add" onPress={() => router.push("/book")} style={{ alignSelf: "stretch", marginTop: 6 }} />
        </Animated.View>
      )}
      {shown.map((b, i) => {
        const leg = b.legs[0];
        return (
          <Animated.View key={b.id} entering={FadeInDown.duration(380).delay(i * 60)}>
            <Pressable onPress={() => { tap(); router.push(`/booking/${b.booking_code}`); }}
              style={({ pressed }) => [{ backgroundColor: "#fff", borderRadius: 22, padding: 16, gap: 14 }, shadow.card, pressed && { transform: [{ scale: 0.99 }] }]}>
              <Row spread style={{ flexWrap: "nowrap" }}>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: "700", fontSize: 16 }}>{dateTime(leg.pickup_at, LOCALE)}</T>
                  <T style={s.hint}>{b.booking_code}{b.legs.length > 1 ? ` · ${t("book.roundTrip")}` : ""}</T>
                </View>
                <Badge text={statusLabel("status", b.status)} tone={statusTone(b.status)} />
              </Row>
              {b.daily ? (
                // K-29 günlük kiralama: başlangıç noktası ve paket özeti (gün boyu, bırakış yok).
                <View style={{ gap: 2 }}>
                  <T style={{ fontWeight: "600" }} numberOfLines={1}>{regionName(leg.pickup_region, LOCALE)}</T>
                  <T style={s.hint}>{t("daily.summary", { days: b.daily.days, package: b.daily.package === "tam" ? t("daily.full") : t("daily.half") })}</T>
                </View>
              ) : (
                <RouteStops from={regionName(leg.pickup_region, LOCALE)} to={regionName(leg.dropoff_region, LOCALE)} fromHint={leg.pickup_address ?? undefined} toHint={leg.dropoff_address ?? undefined} compact />
              )}
              <View style={{ height: 1, backgroundColor: colors.line }} />
              <Row spread style={{ flexWrap: "nowrap" }}>
                <Row gap={10} style={{ flex: 1, flexWrap: "nowrap" }}>
                  <View style={{ width: 58, height: 36, borderRadius: 8, backgroundColor: colors.canvas, overflow: "hidden" }}>
                    {VEHICLE_IMAGE[b.vehicle_type.code] ? <Image source={VEHICLE_IMAGE[b.vehicle_type.code]} style={{ width: 58, height: 36, mixBlendMode: "multiply" } as object} resizeMode="contain" /> : null}
                  </View>
                  <T style={{ fontWeight: "600" }} numberOfLines={1}>{vehicleName(b.vehicle_type, LOCALE)}</T>
                </Row>
                <Row gap={6} style={{ flexWrap: "nowrap" }}>
                  <T style={{ fontWeight: "800", fontSize: 17, letterSpacing: -0.3 }}>{money(b.total_amount, b.currency, LOCALE)}</T>
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} style={rtlFlip("chevron-forward")} />
                </Row>
              </Row>
              {b.status === "odeme_bekliyor" ? (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.warnSoft, borderRadius: 12, padding: 10 }}>
                  <Ionicons name="card" size={16} color={colors.warn} />
                  <T style={{ color: colors.warn, fontWeight: "600", fontSize: 13, flex: 1 }}>{t("bookings.payNow")}</T>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        );
      })}
    </Screen>
  );
}
