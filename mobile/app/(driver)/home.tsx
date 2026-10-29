import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Switch, Text, View } from "react-native";
import { Alert, Badge, Button, Card, H2, Info, Loading, P, Row, Screen, colors, s, statusTone } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { DOC_LABEL, DRIVER_STATUS, LEG_STATUS } from "@/lib/driverLabels";
import { dateTime, money } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { DriverMe, Offer, Trip } from "@/lib/types";

/**
 * Sürücü ekranları 2-4: onay bekleme, çevrimiçi/çevrimdışı geçişi, iş teklifleri, yaklaşan işler.
 * Push bildirimi (FCM) açılana kadar teklifler çevrimiçiyken kısa aralıklarla yoklanır.
 */
export default function DriverHome() {
  const { signOut } = useSession();
  const [me, setMe] = useState<DriverMe | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const m = await api<DriverMe>("driver/me");
      setMe(m);
      setTrips(await api<Trip[]>("driver/trips"));
      setOffers(m.is_online ? await api<Offer[]>("driver/offers") : []);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "driver_profile_missing") router.replace("/driver-register");
      else setError(errorTextTr(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!me?.is_online) return;
    const poll = setInterval(load, 8000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [me?.is_online, load]);

  async function setOnline(v: boolean) {
    setBusy(true);
    try {
      setMe(await api<DriverMe>("driver/me/online", { body: { is_online: v } }));
      await load();
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  async function respond(offer: Offer, accept: boolean) {
    setBusy(true);
    try {
      if (accept) {
        const trip = await api<Trip>(`driver/offers/${offer.offer_id}/accept`, { body: {} });
        router.push(`/trip/${trip.leg_id}`);
      } else {
        await api(`driver/offers/${offer.offer_id}/reject`, { body: {} });
      }
      await load();
    } catch (e) {
      setError(errorTextTr(e));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <Screen>{error ? <Alert text={error} /> : <Loading />}</Screen>;

  return (
    <Screen refreshing={false} onRefresh={load}
      header={
        <View style={{ backgroundColor: me.is_online ? colors.ok : colors.ink, marginTop: 8, padding: 20, gap: 10, borderRadius: 20 }}>
          <Row spread>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>{me.full_name}</Text>
            <Badge text={DRIVER_STATUS[me.status] ?? me.status} tone={statusTone(me.status)} />
          </Row>
          {me.status === "onayli" && (
            <Row spread>
              <View>
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>{me.is_online ? "Çevrimiçisiniz" : "Çevrimdışısınız"}</Text>
                <Text style={{ color: "rgba(255,255,255,0.8)" }}>{me.is_online ? "Anlık iş teklifleri geliyor." : "Teklif almak için açın."}</Text>
              </View>
              <Switch value={me.is_online} onValueChange={(v) => { if (!busy) void setOnline(v); }} trackColor={{ true: "#7fd3a4", false: "#5a5a5a" }} thumbColor="#fff" />
            </Row>
          )}
        </View>
      }>
      <Alert text={error} />
      <Card>
        {me.status === "onayli" ? (
          <Info icon="shield-checkmark-outline">Belgeleriniz geçerli. İyi yolculuklar.</Info>
        ) : (
          <P muted>
            {me.status === "basvuru"
              ? "Başvurunuz inceleniyor. Belgeleriniz onaylanınca iş almaya başlayabilirsiniz."
              : "Hesabınız şu an iş alamaz. Lütfen operasyon ekibiyle iletişime geçin."}
          </P>
        )}
        {me.missing_documents.length > 0 && (
          <Pressable onPress={() => router.push("/documents")}>
            <Alert tone="warn" text={`Eksik belgeler: ${me.missing_documents.map((d) => DOC_LABEL[d] ?? d).join(", ")}`} />
          </Pressable>
        )}
      </Card>

      {offers.map((o) => {
        const left = Math.max(0, Math.round((new Date(o.expires_at).getTime() - now) / 1000));
        return (
          <Card key={o.offer_id} style={{ borderColor: "#c8a04a", borderWidth: 2 }}>
            <Row spread>
              <H2>Yeni iş teklifi</H2>
              <Badge text={`${left} sn`} tone="warn" />
            </Row>
            <Info icon="navigate-outline">{o.trip.pickup_region} → {o.trip.dropoff_region}</Info>
            <Info icon="calendar-outline">{dateTime(o.trip.pickup_at)}</Info>
            <Info icon="people-outline">{o.trip.passenger_count} yolcu · {o.trip.luggage_count} bagaj</Info>
            <Text style={s.price}>{money(o.trip.driver_amount, o.trip.currency)}</Text>
            <Row>
              <Button title="Kabul et" icon="checkmark" busy={busy} disabled={left === 0} onPress={() => respond(o, true)} />
              <Button title="Reddet" variant="secondary" disabled={busy} onPress={() => respond(o, false)} />
            </Row>
          </Card>
        );
      })}

      <H2>Yaklaşan işler</H2>
      {trips.length === 0 && <P muted>Atanmış işiniz yok.</P>}
      {trips.map((tr) => (
        <Pressable key={tr.leg_id} onPress={() => router.push(`/trip/${tr.leg_id}`)}>
          <Card>
            <Row spread>
              <P bold>{dateTime(tr.pickup_at)}</P>
              <Badge text={LEG_STATUS[tr.status] ?? tr.status} tone={statusTone(tr.status)} />
            </Row>
            <Info icon="navigate-outline">{tr.pickup_region} → {tr.dropoff_region}</Info>
            <P muted small>{tr.booking_code} · {tr.passenger_name} · {money(tr.driver_amount, tr.currency)}</P>
          </Card>
        </Pressable>
      ))}

      <Button title="Çıkış yap" variant="secondary" onPress={async () => {
        if (me.is_online) await api("driver/me/online", { body: { is_online: false } }).catch(() => undefined);
        await signOut();
        router.replace("/login");
      }} />
    </Screen>
  );
}
