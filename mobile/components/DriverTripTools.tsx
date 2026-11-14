/**
 * Sürücü araçları (K-63): kanıtlı bekleme sayacı ve "Yolcu gelmedi", çıkış önerisi, müşteri not kartı.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Alert as NativeAlert, View } from "react-native";
import { Alert, Button, Card, Row, T, colors, s } from "@/components/ui";
import type { LatLng } from "@/components/mapTypes";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { Trip } from "@/lib/types";

const LANG_TR: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", ru: "Rusça", fr: "Fransızca", ar: "Arapça" };

function mmss(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** "Vardım"dan sonra bekleme sayacı. Ücretsiz bekleme dolunca "Yolcu gelmedi" açılır (konumla kaydedilir). */
export function WaitCard(props: { trip: Trip; position: LatLng | null; onDone: (t: Trip) => void }) {
  const { trip } = props;
  const now = useNow(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!trip.arrived_at) return null;
  const arrived = new Date(trip.arrived_at).getTime();
  const unlock = trip.no_show_after ? new Date(trip.no_show_after).getTime() : null;
  const open = unlock !== null && now >= unlock;

  async function submit() {
    if (!props.position) {
      setError("Konumunuz alınamadı. Konum izni verip tekrar deneyin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onDone(await api<Trip>(`driver/trips/${trip.leg_id}/no-show`, {
        body: { lat: props.position.latitude, lng: props.position.longitude },
      }));
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    NativeAlert.alert(
      "Yolcu gelmedi",
      "Konumunuz ve bekleme süreniz kaydedilir, yolculuk tamamlanmış sayılır ve hakedişiniz eklenir. Yolcuya bildirim gider.",
      [{ text: "Vazgeç", style: "cancel" }, { text: "Kaydet", style: "destructive", onPress: () => void submit() }],
    );
  }

  return (
    <Card>
      <Row spread style={{ flexWrap: "nowrap" }}>
        <Row gap={8}>
          <Ionicons name="hourglass-outline" size={20} color={colors.ink} />
          <T style={{ fontWeight: "700" }}>Bekliyorsunuz</T>
        </Row>
        <T accessibilityLabel={`Bekleme süresi ${mmss(now - arrived)}`} style={{ fontWeight: "800", fontSize: 22, fontVariant: ["tabular-nums"] }}>
          {mmss(now - arrived)}
        </T>
      </Row>
      <T style={s.hint}>
        Vardığınız an ({clock(trip.arrived_at)}) ve konumunuz kaydedildi.
        {unlock !== null && !open ? ` Ücretsiz bekleme ${clock(trip.no_show_after)} saatinde biter (${mmss(unlock - now)} kaldı).` : ""}
      </T>
      {trip.passenger_status ? null : (
        <T style={s.hint}>Yolcu henüz durum bildirmedi. Önce mesajla ulaşmayı deneyin.</T>
      )}
      <Alert text={error} />
      <Button title="Yolcu gelmedi" icon="person-remove-outline" variant="secondary" busy={busy} disabled={!open} onPress={confirm} />
    </Card>
  );
}

/** Atanmış işte "en geç şu saatte yola çıkın" önerisi (uçuş rötarını hesaba katar). */
export function DepartureCard(props: { trip: Trip; position: LatLng | null }) {
  const [d, setD] = useState<{ leave_at: string; drive_minutes: number; target_at: string; based_on_flight: boolean } | null>(null);
  const pos = props.position;
  const key = pos ? `${pos.latitude.toFixed(2)},${pos.longitude.toFixed(2)}` : null;
  useEffect(() => {
    if (!pos) return;
    api<typeof d>(`driver/trips/${props.trip.leg_id}/departure?lat=${pos.latitude}&lng=${pos.longitude}`)
      .then(setD)
      .catch(() => undefined);
    // Konum ~1 km değişince yeniden hesaplanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, props.trip.leg_id, props.trip.flight_estimated_at]);
  const now = useNow(d !== null);
  if (!d) return null;
  const late = new Date(d.leave_at).getTime() < now;
  return (
    <Card flat>
      <Row gap={10} style={{ flexWrap: "nowrap" }}>
        <Ionicons name={late ? "alert-circle" : "time-outline"} size={22} color={late ? colors.danger : colors.ink} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontWeight: "800", fontSize: 17, color: late ? colors.danger : colors.ink }}>
            {late ? "Hemen yola çıkın" : `En geç ${clock(d.leave_at)}'de yola çıkın`}
          </T>
          <T style={s.hint}>
            Alışa ~{d.drive_minutes} dk · {d.based_on_flight ? "uçuş inişi ve çıkış süresine göre" : "alış saatine göre"} hedef {clock(d.target_at)}
          </T>
        </View>
      </Row>
    </Card>
  );
}

/** Müşteri not kartı: yolcu, bagaj, çocuk koltuğu, dil ve not tek bakışta. */
export function CustomerNoteCard(props: { trip: Trip }) {
  const t = props.trip;
  const rows: [string, string][] = [
    ["people-outline", `${t.passenger_count} yolcu`],
    ["briefcase-outline", `${t.luggage_count} bagaj`],
  ];
  if (t.child_seat_count) rows.push(["happy-outline", `${t.child_seat_count} çocuk koltuğu`]);
  if (t.market_stop) rows.push(["basket-outline", "Market molası"]);
  if (t.customer_locale && t.customer_locale !== "tr") rows.push(["language-outline", LANG_TR[t.customer_locale] ?? t.customer_locale.toUpperCase()]);
  return (
    <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 12, gap: 8 }}>
      <Row gap={8}>
        {rows.map(([icon, text]) => (
          <Row key={text} gap={5}>
            <Ionicons name={icon as "people-outline"} size={15} color={colors.ink} />
            <T style={{ fontWeight: "600", fontSize: 13 }}>{text}</T>
          </Row>
        ))}
      </Row>
      {t.customer_note ? (
        <Row gap={8} style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <Ionicons name="chatbox-ellipses-outline" size={16} color={colors.muted} />
          <T style={{ flex: 1, lineHeight: 20 }}>{t.customer_note}</T>
        </Row>
      ) : null}
    </View>
  );
}
