import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { Alert, Badge, Card, H2, Loading, P, Row, Screen, s, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Earnings } from "@/lib/types";

const LEDGER: Record<string, string> = { beklemede: "Ödeme bekliyor", odendi: "Ödendi", iptal: "İptal" };

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

  if (!data) return <Screen>{error ? <Alert text={error} /> : <Loading />}</Screen>;

  return (
    <Screen refreshing={false} onRefresh={load}>
      <Row>
        <Card style={{ flex: 1 }}>
          <P muted small>Ödeme bekleyen</P>
          <Text style={s.price}>{money(data.pending_try, "TRY")}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <P muted small>Ödenen</P>
          <Text style={s.price}>{money(data.paid_try, "TRY")}</Text>
        </Card>
      </Row>
      <P muted small>EUR işlerin TL karşılığı ödeme kaydı oluşturulurken o günün kuruyla hesaplanır.</P>
      <H2>Hakediş geçmişi</H2>
      {data.entries.length === 0 && <P muted>Henüz hakediş yok.</P>}
      {data.entries.map((e) => (
        <Card key={e.id}>
          <Row spread>
            <P>{dateTime(e.created_at)}</P>
            <Badge text={LEDGER[e.status] ?? e.status} tone={statusTone(e.status)} />
          </Row>
          <Row spread>
            <P muted small>Net {money(e.net_amount, e.currency)}</P>
            <P bold>{e.net_amount_try ? money(e.net_amount_try, "TRY") : "kur bekleniyor"}</P>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
