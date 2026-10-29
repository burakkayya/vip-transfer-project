import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import AddressField from "@/components/AddressField";
import DateTimeField from "@/components/DateTimeField";
import { Alert, Button, Card, CheckCard, Divider, H2, Hero, IconName, Info, Input, P, Row, Screen, Steps, Toggle, colors, s } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { money, wallClockIso, wallClockLabel } from "@/lib/format";
import { LOCALE, errorText, t } from "@/lib/i18n";
import type { Booking, Endpoint, Profile, Quote, Region, VehicleType } from "@/lib/types";

type Step = "trip" | "vehicle" | "details";
const STEP_INDEX: Record<Step, number> = { trip: 0, vehicle: 1, details: 2 };
const FLIGHT_RE = /^[A-Za-z0-9]{2,3}\s?\d{1,5}[A-Za-z]?$/;
const MARKETING_CONSENT_VERSION = "1.0";
const VEHICLE_ICON: Record<string, IconName> = { minivan: "car-outline", vip_van: "car-sport-outline", minibus: "bus-outline" };
// Araç tipi görselleri; yeni eklenen tipte görsel yoksa ikon gösterilir.
const VEHICLE_IMAGE: Record<string, number> = {
  minivan: require("@/assets/images/minivan.jpg"),
  vip_van: require("@/assets/images/vip_van.jpg"),
  minibus: require("@/assets/images/minibus.jpg"),
};

const inHours = (h: number) => {
  const d = new Date(Date.now() + h * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
};

function place(e: Endpoint, note?: string) {
  const address = note?.trim() || null;
  return e.place_token ? { place_token: e.place_token, address } : { region_id: e.region.id, address };
}

function Counter(props: { label: string; icon: IconName; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <View style={[s.field, { flex: 1 }]}>
      <Text style={s.label}>{props.label}</Text>
      <View style={[s.inputWrap, { justifyContent: "space-between" }]}>
        <Ionicons name={props.icon} size={18} color={colors.muted} />
        <Pressable hitSlop={8} onPress={() => props.onChange(Math.max(props.min, props.value - 1))}>
          <Ionicons name="remove-circle-outline" size={26} color={props.value > props.min ? colors.brand : colors.line} />
        </Pressable>
        <Text style={[s.p, { fontWeight: "700", minWidth: 24, textAlign: "center" }]}>{props.value}</Text>
        <Pressable hitSlop={8} onPress={() => props.onChange(Math.min(50, props.value + 1))}>
          <Ionicons name="add-circle-outline" size={26} color={colors.brand} />
        </Pressable>
      </View>
    </View>
  );
}

/** Müşteri ekranı 3: yeni rezervasyon (web ile aynı akış). Fiyat, adreslerin ilçesine göre hesaplanır. */
export default function Book() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [country, setCountry] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("trip");
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [at, setAt] = useState(inHours(24));
  const [roundTrip, setRoundTrip] = useState(false);
  const [returnAt, setReturnAt] = useState(inHours(24 * 8));
  const [instant, setInstant] = useState(false);
  const [pax, setPax] = useState(2);
  const [lug, setLug] = useState(2);
  const [quotes, setQuotes] = useState<Record<string, Quote | ApiError>>({});
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [d, setD] = useState({ name: "", pickupNote: "", dropoffNote: "", flight: "", note: "", guarantee: false });
  const [consent, setConsent] = useState({ disclosure: false, distance: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Region[]>("regions").then(setRegions).catch((e) => setError(errorText(e)));
    api<VehicleType[]>("vehicle-types").then(setTypes).catch(() => undefined);
    api<Profile>("me/profile").then((p) => setCountry(p.country_code)).catch(() => undefined);
  }, []);

  const request = (vt: string, withDetails: boolean) => ({
    pickup: place(from!, withDetails ? d.pickupNote : undefined),
    dropoff: place(to!, withDetails ? d.dropoffNote : undefined),
    vehicle_type_code: vt,
    pickup_at: instant ? new Date().toISOString() : wallClockIso(at),
    return_pickup_at: roundTrip ? wallClockIso(returnAt) : null,
    passenger_count: pax,
    luggage_count: lug,
    country_code: country,
    with_guarantee: withDetails && d.guarantee,
  });

  async function loadQuotes() {
    setBusy(true);
    setError(null);
    const rows = await Promise.all(
      types.map((vt) =>
        api<Quote>("quotes", { body: request(vt.code, false) }).then(
          (q) => [vt.code, q] as const,
          (e) => [vt.code, e instanceof ApiError ? e : new ApiError(0, "network", "")] as const,
        ),
      ),
    );
    setQuotes(Object.fromEntries(rows));
    setBusy(false);
    setStep("vehicle");
  }

  async function create() {
    if (d.flight && !FLIGHT_RE.test(d.flight.trim())) {
      setError(t("errors.validation_error"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const req = request(vehicle!, true);
      const q = await api<Quote>("quotes", { body: req });
      try {
        const booking = await api<Booking>("me/bookings", {
          body: {
            ...req,
            booking_type: instant ? "anlik" : "planli",
            expected_total: q.total,
            passenger_name: d.name.trim(),
            note: d.note.trim() || null,
            flights: d.flight.trim() ? [{ leg_order: 1, flight_no: d.flight.trim().toUpperCase() }] : [],
            locale: LOCALE,
            accept_disclosure: consent.disclosure,
            accept_distance_sales: consent.distance,
          },
        });
        if (consent.marketing) {
          await api("me/consents", { body: { consent_type: "pazarlama", accepted: true, version: MARKETING_CONSENT_VERSION } }).catch(() => undefined);
        }
        setStep("trip");
        setVehicle(null);
        router.push({ pathname: "/booking/[code]", params: { code: booking.booking_code, pay: "1" } });
      } catch (e) {
        if (e instanceof ApiError && e.code === "price_changed") {
          setError(t("book.priceChanged", { total: money(q.total, q.currency, LOCALE) }));
          return;
        }
        throw e;
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const selected = vehicle ? quotes[vehicle] : undefined;
  const selectedQuote = selected && !(selected instanceof ApiError) ? selected : null;
  const legal = (slug: string) => WebBrowser.openBrowserAsync(`${WEB_URL}/${LOCALE}/legal/${slug}`);
  const total = selectedQuote ? String(Number(selectedQuote.price) + (d.guarantee ? Number(selectedQuote.guarantee_fee) : 0)) : "0";

  return (
    <Screen header={<Hero title={t("book.heroTitle")} subtitle={t("book.heroText")} />}>
      <Steps steps={[t("book.step.route"), t("book.step.vehicle"), t("book.step.details")]} current={STEP_INDEX[step]} />
      <Alert text={error} />

      {step === "trip" && (
        <Card elevated>
          <AddressField label={t("book.from")} icon="airplane-outline" regions={regions} value={from} onChange={setFrom} />
          <Pressable style={{ alignSelf: "center" }} hitSlop={8} onPress={() => { setFrom(to); setTo(from); }}>
            <Ionicons name="swap-vertical" size={22} color={colors.brand} />
          </Pressable>
          <AddressField label={t("book.to")} icon="location-outline" regions={regions} value={to} onChange={setTo} />
          <Divider />
          <Toggle label={t("book.instant")} value={instant} onChange={setInstant} />
          {!instant && <DateTimeField label={t("book.pickupAt")} value={at} onChange={setAt} minimumDate={new Date()} />}
          <Toggle label={t("book.roundTrip")} value={roundTrip} onChange={setRoundTrip} />
          {roundTrip && <DateTimeField label={t("book.returnAt")} value={returnAt} onChange={setReturnAt} minimumDate={at} />}
          <Row style={{ flexWrap: "nowrap" }}>
            <Counter label={t("book.passengers")} icon="people-outline" value={pax} min={1} onChange={setPax} />
            <Counter label={t("book.luggage")} icon="briefcase-outline" value={lug} min={0} onChange={setLug} />
          </Row>
          <Button title={t("book.showPrices")} icon="arrow-forward" onPress={loadQuotes} busy={busy} disabled={!from || !to || types.length === 0} />
        </Card>
      )}

      {step === "vehicle" && (
        <>
          <H2>{t("book.chooseVehicle")}</H2>
          {types.map((vt) => {
            const q = quotes[vt.code];
            const ok = q && !(q instanceof ApiError);
            return (
              <Pressable key={vt.code} disabled={!ok} onPress={() => { setVehicle(vt.code); setStep("details"); }}>
                <Card style={{ opacity: ok ? 1 : 0.45, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
                  {VEHICLE_IMAGE[vt.code] ? (
                    <Image source={VEHICLE_IMAGE[vt.code]} style={{ width: 96, height: 60 }} resizeMode="contain" />
                  ) : (
                    <View style={{ width: 96, height: 60, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={VEHICLE_ICON[vt.code] ?? "car-outline"} size={30} color={colors.brand} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <P bold>{vt.name}</P>
                    <P muted small>{t("book.seats", { count: vt.capacity, bags: vt.luggage_capacity })}</P>
                    {ok && <P muted small>{t("book.distance", { km: Number(q.legs[0].distance_km).toFixed(0), minutes: q.legs[0].duration_minutes })}</P>}
                    {q instanceof ApiError && <P small muted>{errorText(q)}</P>}
                  </View>
                  {ok && (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={s.price}>{money(q.price, q.currency, LOCALE)}</Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </View>
                  )}
                </Card>
              </Pressable>
            );
          })}
          <Button title={t("back")} variant="secondary" onPress={() => setStep("trip")} />
        </>
      )}

      {step === "details" && selectedQuote && from && to && (
        <>
          <Card>
            <H2>{t("book.summary")}</H2>
            <Info icon="airplane-outline">{from.label}</Info>
            <Info icon="location-outline">{to.label}</Info>
            <Info icon="calendar-outline">{instant ? t("book.instant") : wallClockLabel(at)}{roundTrip ? ` · ${t("book.roundTrip")}` : ""}</Info>
            <Info icon="people-outline">{pax} · {lug}</Info>
          </Card>
          <Card>
            <Input label={t("book.passengerName")} icon="person-outline" value={d.name} onChangeText={(v) => setD({ ...d, name: v })} autoComplete="name" maxLength={120} />
            <Input label={t("book.pickupNote")} value={d.pickupNote} onChangeText={(v) => setD({ ...d, pickupNote: v })} maxLength={120} />
            <Input label={t("book.dropoffNote")} value={d.dropoffNote} onChangeText={(v) => setD({ ...d, dropoffNote: v })} maxLength={120} />
            <Input label={t("book.flightNo")} icon="airplane-outline" value={d.flight} onChangeText={(v) => setD({ ...d, flight: v.toUpperCase() })} autoCapitalize="characters" maxLength={10} placeholder="TK1234" />
            <Input label={t("book.note")} value={d.note} onChangeText={(v) => setD({ ...d, note: v })} multiline maxLength={500} />
            {selectedQuote.guarantee_available && (
              <Toggle label={t("book.guarantee", { fee: money(selectedQuote.guarantee_fee, selectedQuote.currency, LOCALE) })}
                value={d.guarantee} onChange={(v) => setD({ ...d, guarantee: v })} />
            )}
          </Card>
          <CheckCard label={t("book.acceptDisclosure")} checked={consent.disclosure} onChange={(v) => setConsent({ ...consent, disclosure: v })}
            link={{ title: t("book.read"), onPress: () => legal("privacy") }} />
          <CheckCard label={t("book.acceptDistanceSales")} checked={consent.distance} onChange={(v) => setConsent({ ...consent, distance: v })}
            link={{ title: t("book.read"), onPress: () => legal("distance-sales") }} />
          <CheckCard label={t("book.acceptMarketing")} checked={consent.marketing} onChange={(v) => setConsent({ ...consent, marketing: v })} />
          <Card elevated>
            <Row spread>
              <P bold>{t("book.total")}</P>
              <Text style={s.price}>{money(total, selectedQuote.currency, LOCALE)}</Text>
            </Row>
            <Button title={t("book.create")} icon="lock-closed" onPress={create} busy={busy}
              disabled={d.name.trim().length < 2 || !consent.disclosure || !consent.distance} />
            <Button title={t("back")} variant="secondary" onPress={() => setStep("vehicle")} />
          </Card>
        </>
      )}
    </Screen>
  );
}
