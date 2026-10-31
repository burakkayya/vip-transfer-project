import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Alert, Badge, Card, H2, Hero, IconBubble, Loading, Row, Screen, Skeleton, T, colors, s, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Earnings } from "@/lib/types";

const LEDGER: Record<string, string> = { beklemede: "Ödeme bekliyor", odendi: "Ödendi", iptal: "İptal" };
const DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Son 7 günün hakedişleri (TL) sütun grafik olarak. */
function WeekChart({ data }: { data: Earnings }) {
  const days = useMemo(() => {
    const out: { label: string; total: number; today: boolean }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toDateString();
      const total = data.entries
        .filter((e) => e.status !== "iptal" && new Date(e.created_at).toDateString() === key)
        .reduce((sum, e) => sum + Number(e.net_amount_try ?? 0), 0);
      out.push({ label: DAYS[d.getDay()], total, today: i === 0 });
    }
    return out;
  }, [data]);
  const max = Math.max(1, ...days.map((d) => d.total));
  const week = days.reduce((sum, d) => sum + d.total, 0);
  return (
    <Card elevated delay={80}>
      <Row spread>
        <View>
          <T style={s.hint}>Son 7 gün</T>
          <T style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }}>{money(String(week), "TRY")}</T>
        </View>
        <IconBubble name="stats-chart" />
      </Row>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 8 }}>
        {days.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <View style={{ height: 96, width: "100%", justifyContent: "flex-end" }}>
              <Animated.View
                entering={FadeInUp.duration(500).delay(100 + i * 50)}
                style={{ height: Math.max(4, Math.round((d.total / max) * 96)), borderRadius: 8, backgroundColor: d.today ? colors.accent : d.total ? colors.ink : colors.line }}
              />
            </View>
            <T style={[s.hint, d.today && { color: colors.ink, fontWeight: "700" }]}>{d.label}</T>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Sürücü ekranı 7: kazanç özeti ve hakediş geçmişi. Ödemeler TL yapılır. */
export default function EarningsScreen() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Earnings>("driver/earnings"));
    } catch (e) {
      setError(errorTextTr(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen canvas header={<Hero title="Kazanç" subtitle="Hakedişler TL olarak IBAN'ınıza ödenir." />} refreshing={false} onRefresh={load}>
      <Alert text={error} />
      {!data && !error ? <><Skeleton height={150} radius={24} /><Skeleton height={190} radius={22} /></> : null}
      {data && (
        <>
          <Animated.View entering={FadeInDown.duration(400)} style={{ backgroundColor: colors.ink, borderRadius: 24, padding: 22, gap: 16 }}>
            <View style={{ gap: 4 }}>
              <T style={{ color: colors.accent, fontWeight: "700", letterSpacing: 1.5, fontSize: 11 }}>ÖDEME BEKLEYEN</T>
              <T style={{ color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1.2 }}>{money(data.pending_try, "TRY")}</T>
            </View>
            <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
            <Row spread>
              <Row gap={8}>
                <Ionicons name="checkmark-circle" size={18} color="#7FD3A4" />
                <T style={{ color: "rgba(255,255,255,0.7)" }}>Ödenen</T>
              </Row>
              <T style={{ color: "#fff", fontWeight: "700", fontSize: 17 }}>{money(data.paid_try, "TRY")}</T>
            </Row>
          </Animated.View>
          <WeekChart data={data} />
          <T style={s.hint}>EUR işlerin TL karşılığı ödeme kaydı oluşturulurken o günün kuruyla hesaplanır.</T>
          <H2>Hakediş geçmişi</H2>
          {data.entries.length === 0 && (
            <Card flat>
              <Row gap={12} style={{ flexWrap: "nowrap" }}>
                <Ionicons name="wallet-outline" size={22} color={colors.muted} />
                <T style={s.muted}>Henüz hakediş yok. İlk yolculuğunuzdan sonra burada görünür.</T>
              </Row>
            </Card>
          )}
          {data.entries.length > 0 && (
            <Card delay={140} style={{ paddingVertical: 6 }}>
              {data.entries.map((e, i) => (
                <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                  <IconBubble name={e.status === "odendi" ? "checkmark" : e.status === "iptal" ? "close" : "time-outline"} size={38}
                    bg={e.status === "odendi" ? colors.okSoft : e.status === "iptal" ? colors.dangerSoft : colors.warnSoft}
                    color={e.status === "odendi" ? colors.ok : e.status === "iptal" ? colors.danger : colors.warn} />
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: "600" }}>{dateTime(e.created_at)}</T>
                    <Row gap={6}>
                      <T style={s.hint}>Net {money(e.net_amount, e.currency)}</T>
                      <Badge text={LEDGER[e.status] ?? e.status} tone={statusTone(e.status)} />
                    </Row>
                  </View>
                  <T style={{ fontWeight: "800" }}>{e.net_amount_try ? money(e.net_amount_try, "TRY") : "kur bekleniyor"}</T>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
      {!data && error ? <Loading /> : null}
    </Screen>
  );
}
