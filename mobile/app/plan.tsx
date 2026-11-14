/**
 * Sürücünün günlük planı (K-63): seçilen günün işleri, tahmini kazanç ve varış bölgesinden dönüş işi önerileri.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Alert, Badge, Card, H2, IconButton, Loading, P, RouteStops, Row, Screen, Segmented, T, colors, s, tap } from "@/components/ui";
import { api } from "@/lib/api";
import { LEG_STATUS } from "@/lib/driverLabels";
import { clock, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Currency, Job, Trip } from "@/lib/types";

interface Plan {
  day: string;
  trips: Trip[];
  earnings: Record<string, string>;
  earnings_try: string | null;
  return_jobs: Job[];
}

function isoDay(offset: number) {
  // Türkiye saatine göre gün (UTC+3, yaz saati yok).
  const d = new Date(Date.now() + 3 * 3600_000 + offset * 86400_000);
  return d.toISOString().slice(0, 10);
}

export default function PlanScreen() {
  const [which, setWhich] = useState<"today" | "tomorrow">("tomorrow");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<Plan>(`driver/plan?day=${isoDay(which === "today" ? 0 : 1)}`)
      .then((p) => active && setPlan(p))
      .catch((e) => active && setError(errorTextTr(e)));
    return () => {
      active = false;
    };
  }, [which]);

  const currencies = plan ? Object.entries(plan.earnings) : [];
  return (
    <Screen>
      <Row spread>
        <IconButton icon="arrow-back" label="Geri" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
        <T style={{ fontSize: 20, fontWeight: "800" }}>Günlük plan</T>
        <View style={{ width: 44 }} />
      </Row>
      <Segmented value={which} onChange={(v) => setWhich(v as "today" | "tomorrow")}
        options={[{ value: "today", label: "Bugün" }, { value: "tomorrow", label: "Yarın" }]} />
      <Alert text={error} />
      {!plan && !error ? <Loading /> : null}
      {plan ? (
        <>
          <Card elevated>
            <T style={s.hint}>Tahmini kazanç</T>
            <T style={{ fontSize: 28, fontWeight: "800", letterSpacing: -0.6 }}>
              {plan.earnings_try !== null ? money(plan.earnings_try, "TRY") : currencies.map(([c, a]) => money(a, c as Currency)).join(" + ") || money("0", "TRY")}
            </T>
            {currencies.length > 0 && plan.earnings_try !== null && currencies.some(([c]) => c !== "TRY") ? (
              <T style={s.hint}>{currencies.map(([c, a]) => money(a, c as Currency)).join(" + ")} · güncel kurla</T>
            ) : null}
            <T style={s.hint}>{plan.trips.length} iş</T>
          </Card>

          <H2>İşler</H2>
          {plan.trips.length === 0 ? <Card flat><P muted>Bu gün için işiniz yok.</P></Card> : null}
          {plan.trips.map((tr) => (
            <Pressable key={tr.leg_id} accessibilityRole="button" onPress={() => { tap(); router.push(`/trip/${tr.leg_id}`); }}>
              <Card>
                <Row spread style={{ flexWrap: "nowrap" }}>
                  <T style={{ fontWeight: "800", fontSize: 18 }}>{clock(tr.pickup_at)}</T>
                  <Badge text={LEG_STATUS[tr.status] ?? tr.status} tone={tr.status === "bitti" ? "ok" : "dark"} />
                </Row>
                <RouteStops from={tr.pickup_region} to={tr.dropoff_region} />
                <Row spread>
                  <T style={s.hint}>{tr.passenger_count} yolcu · {tr.luggage_count} bagaj{tr.flight_no ? ` · ${tr.flight_no}` : ""}</T>
                  <T style={{ fontWeight: "700" }}>{money(tr.driver_amount, tr.currency)}</T>
                </Row>
              </Card>
            </Pressable>
          ))}

          {plan.return_jobs.length > 0 ? (
            <>
              <Row gap={8}>
                <Ionicons name="repeat" size={18} color={colors.accent} />
                <H2>Dönüş işi önerileri</H2>
              </Row>
              <P muted small>Bir işinizin bittiği bölgeden, bitişten sonraki 4 saatte kalkan açık işler.</P>
              {plan.return_jobs.map((j) => (
                <Pressable key={j.leg_id} accessibilityRole="button" onPress={() => { tap(); router.push(`/job/${j.leg_id}`); }}>
                  <Card flat>
                    <Row spread style={{ flexWrap: "nowrap" }}>
                      <T style={{ fontWeight: "800" }}>{clock(j.pickup_at)}</T>
                      <T style={{ fontWeight: "700" }}>{money(j.driver_amount, j.currency)}</T>
                    </Row>
                    <RouteStops from={j.pickup_region} to={j.dropoff_region} />
                  </Card>
                </Pressable>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
