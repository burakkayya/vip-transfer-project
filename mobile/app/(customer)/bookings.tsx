import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable } from "react-native";
import { Alert, Badge, Button, Card, Hero, Info, Loading, P, Row, Screen, s, statusTone } from "@/components/ui";
import { Text } from "react-native";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { LOCALE, errorText, statusLabel, t } from "@/lib/i18n";
import type { Booking } from "@/lib/types";

/** Müşteri ekranı 2: rezervasyonlarım. */
export default function Bookings() {
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <Screen header={<Hero title={t("tabs.bookings")} subtitle={t("bookings.heroText")} />}
      refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Alert text={error} />
      {list?.length === 0 && (
        <Card>
          <P>{t("bookings.empty")}</P>
          <Button title={t("tabs.book")} icon="add" onPress={() => router.push("/book")} />
        </Card>
      )}
      {list?.map((b) => (
        <Pressable key={b.id} onPress={() => router.push(`/booking/${b.booking_code}`)}>
          <Card>
            <Row spread>
              <P bold>{b.booking_code}</P>
              <Badge text={statusLabel("status", b.status)} tone={statusTone(b.status)} />
            </Row>
            <Info icon="navigate-outline">{b.legs[0].pickup_region.name} → {b.legs[0].dropoff_region.name}</Info>
            <Row spread>
              <P muted small>{dateTime(b.legs[0].pickup_at, LOCALE)}</P>
              <Text style={[s.price, { fontSize: 18 }]}>{money(b.total_amount, b.currency, LOCALE)}</Text>
            </Row>
          </Card>
        </Pressable>
      ))}
      {list === null && !error && <Loading />}
    </Screen>
  );
}
