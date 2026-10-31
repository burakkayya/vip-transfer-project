import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { RouteBox, regionEndpoint } from "@/components/AddressField";
import DateTimeField from "@/components/DateTimeField";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import {
  Alert, Badge, Button, Card, CheckCard, Eyebrow, H2, IconBubble, IconButton, IconName, Input, P, RouteStops, Row,
  Segmented, Skeleton, Steps, T, Toggle, colors, s, tap,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { money, wallClockIso, wallClockLabel } from "@/lib/format";
import { LOCALE, errorText, t } from "@/lib/i18n";
import type { Booking, Endpoint, Profile, Quote, Region, VehicleType } from "@/lib/types";
import { VEHICLE_ICON, VEHICLE_IMAGE } from "@/lib/vehicles";

type Step = "home" | "trip" | "vehicle" | "details";
const FLOW: Step[] = ["trip", "vehicle", "details"];
const FLIGHT_RE = /^[A-Za-z0-9]{2,3}\s?\d{1,5}[A-Za-z]?$/;
const MARKETING_CONSENT_VERSION = "1.0";

const inHours = (h: number) => {
  const d = new Date(Date.now() + h * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
};

function place(e: Endpoint, note?: string) {
  const address = note?.trim() || null;
  return e.place_token ? { place_token: e.place_token, address } : { region_id: e.region.id, address };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? t("home.morning") : h < 18 ? t("home.afternoon") : t("home.evening");
}

function Counter(props: { label: string; icon: IconName; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.brandSoft, borderRadius: 16, padding: 8, paddingLeft: 14, gap: 8 }}>
      <Ionicons name={props.icon} size={18} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <T style={s.hint}>{props.label}</T>
        <T style={{ fontWeight: "700", fontSize: 17 }}>{props.value}</T>
      </View>
      <Pressable accessibilityLabel={`${props.label} -`} hitSlop={6} disabled={props.value <= props.min}
        onPress={() => { tap(); props.onChange(Math.max(props.min, props.value - 1)); }}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", opacity: props.value <= props.min ? 0.4 : 1 }}>
        <Ionicons name="remove" size={18} color={colors.ink} />
      </Pressable>
      <Pressable accessibilityLabel={`${props.label} +`} hitSlop={6}
        onPress={() => { tap(); props.onChange(Math.min(50, props.value + 1)); }}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="add" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

/** Müşteri ekranı 3: ana sayfa ve yeni rezervasyon (web ile aynı akış). Fiyat, adreslerin ilçesine göre hesaplanır. */
export default function Book() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>("home");
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
    api<Profile>("me/profile").then((p) => {
      setProfile(p);
      if (p.full_name) setD((x) => (x.name ? x : { ...x, name: p.full_name ?? "" }));
    }).catch(() => undefined);
  }, []);

  const airports = useMemo(() => regions.filter((r) => r.type === "havalimani"), [regions]);
  const seed = `${from?.label ?? ""}>${to?.label ?? ""}`;

  const request = (vt: string, withDetails: boolean) => ({
    pickup: place(from!, withDetails ? d.pickupNote : undefined),
    dropoff: place(to!, withDetails ? d.dropoffNote : undefined),
    vehicle_type_code: vt,
    pickup_at: instant ? new Date().toISOString() : wallClockIso(at),
    return_pickup_at: roundTrip ? wallClockIso(returnAt) : null,
    passenger_count: pax,
    luggage_count: lug,
    country_code: profile?.country_code ?? null,
    with_guarantee: withDetails && d.guarantee,
  });

  async function loadQuotes() {
    setBusy(true);
    setError(null);
    setQuotes({});
    setStep("vehicle");
    const rows = await Promise.all(
      types.map((vt) =>
        api<Quote>("quotes", { body: request(vt.code, false) }).then(
          (q) => [vt.code, q] as const,
          (e) => [vt.code, e instanceof ApiError ? e : new ApiError(0, "network", "")] as const,
        ),
      ),
    );
    const map = Object.fromEntries(rows);
    setQuotes(map);
    // İlk uygun araç önceden seçilir (Uber'deki gibi); kullanıcı değiştirebilir.
    const first = types.find((vt) => !(map[vt.code] instanceof ApiError));
    setVehicle((v) => (v && !(map[v] instanceof ApiError) ? v : first?.code ?? null));
    setBusy(false);
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
        setStep("home");
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
  const selectedType = types.find((x) => x.code === vehicle);
  const legal = (slug: string) => WebBrowser.openBrowserAsync(`${WEB_URL}/${LOCALE}/legal/${slug}`);
  const total = selectedQuote ? String(Number(selectedQuote.price) + (d.guarantee ? Number(selectedQuote.guarantee_fee) : 0)) : "0";
  const back = () => setStep(step === "details" ? "vehicle" : step === "vehicle" ? "trip" : "home");

  const overlay = step === "home" ? (
    <>
      <View style={{ backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok }} />
        <T style={{ fontWeight: "600", fontSize: 13 }}>Antalya · Muğla</T>
      </View>
      <IconButton icon="person" label={t("tabs.profile")} onPress={() => router.push("/profile")} />
    </>
  ) : (
    <IconButton icon="arrow-back" label={t("back")} onPress={back} />
  );

  // --- Ana sayfa ----------------------------------------------------------------
  if (step === "home") {
    return (
      <MapSheet map={<MapCanvas seed="home" mode="idle" focusTop={0.5} />} mapRatio={0.4} overlay={overlay}>
        <View style={{ gap: 4 }}>
          <Eyebrow>{greeting()}{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</Eyebrow>
          <T style={{ fontSize: 28, fontWeight: "800", letterSpacing: -0.9 }}>{t("home.where")}</T>
        </View>
        <Pressable onPress={() => { tap(); setStep("trip"); }}
          style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.brandSoft, borderRadius: 18, paddingLeft: 18, paddingRight: 8, height: 62 }, pressed && { opacity: 0.85 }]}>
          <Ionicons name="search" size={22} color={colors.ink} />
          <T style={{ flex: 1, fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("book.to")}?</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 }}>
            <Ionicons name="time" size={16} color={colors.ink} />
            <T style={{ fontWeight: "600", fontSize: 13 }}>{t("home.later")}</T>
            <Ionicons name="chevron-down" size={14} color={colors.ink} />
          </View>
        </Pressable>

        <ErrLine error={error} />
        <View style={{ gap: 2 }}>
          {airports.length === 0 && !error ? [0, 1, 2].map((i) => <Skeleton key={i} height={52} radius={14} style={{ marginBottom: 8 }} />) : null}
          {airports.map((a, i) => (
            <Animated.View key={a.id} entering={FadeInDown.duration(380).delay(80 + i * 60)}>
              <Pressable onPress={() => { tap(); setFrom(regionEndpoint(a)); setStep("trip"); }}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 }, pressed && { opacity: 0.6 }]}>
                <IconBubble name="airplane" size={42} />
                <View style={{ flex: 1, borderBottomWidth: i < airports.length - 1 ? 1 : 0, borderBottomColor: colors.line, paddingBottom: 12, marginBottom: -12 }}>
                  <T style={{ fontWeight: "600", fontSize: 15.5 }} numberOfLines={1}>{a.name}</T>
                  <T style={s.hint}>{a.iata_code} · {a.province === "mugla" ? "Muğla" : "Antalya"}</T>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInDown.duration(450).delay(380)}>
          <Pressable onPress={() => setStep("trip")} style={{ backgroundColor: colors.ink, borderRadius: 22, padding: 18, overflow: "hidden", minHeight: 150 }}>
            <View style={{ width: "62%", gap: 6, zIndex: 1 }}>
              <Eyebrow>Getaway</Eyebrow>
              <T style={{ color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}>{t("home.promoTitle")}</T>
              <T style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18 }}>{t("home.promoText")}</T>
            </View>
            <Image source={require("@/assets/images/vito-side.png")} resizeMode="contain" style={{ position: "absolute", right: -46, bottom: 10, width: 210, height: 90 }} />
          </Pressable>
        </Animated.View>
      </MapSheet>
    );
  }

  const stepIdx = FLOW.indexOf(step);
  const stepper = <Steps steps={[t("book.step.route"), t("book.step.vehicle"), t("book.step.details")]} current={stepIdx} />;

  // --- 1. Rota, zaman, kişi -------------------------------------------------------
  if (step === "trip") {
    return (
      <MapSheet map={<MapCanvas seed={seed} mode={from && to ? "route" : "idle"} focusTop={0.4} />} mapRatio={0.26} overlay={overlay}
        bottom={<Button title={t("book.showPrices")} iconRight="arrow-forward" onPress={loadQuotes} busy={busy} disabled={!from || !to || types.length === 0} />}>
        {stepper}
        <H2>{t("book.routeTitle")}</H2>
        <RouteBox regions={regions} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <ErrLine error={error} />
        <Row spread style={{ marginTop: 6 }}>
          <H2>{t("book.whenTitle")}</H2>
          <Segmented value={instant ? "now" : "later"} onChange={(v) => setInstant(v === "now")}
            options={[{ value: "later", label: t("home.later") }, { value: "now", label: t("home.now") }]} />
        </Row>
        {instant ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.accentSoft, borderRadius: 14, padding: 12 }}>
            <Ionicons name="flash" size={18} color="#8A6A37" />
            <T style={{ flex: 1, color: "#6B5228", fontSize: 13.5 }}>{t("book.instant")}</T>
          </View>
        ) : (
          <DateTimeField label="" value={at} onChange={setAt} minimumDate={new Date()} />
        )}
        <Toggle icon="repeat" label={t("book.roundTrip")} value={roundTrip} onChange={setRoundTrip} />
        {roundTrip && <DateTimeField label={t("book.returnAt")} value={returnAt} onChange={setReturnAt} minimumDate={at} />}
        <H2>{t("book.whoTitle")}</H2>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Counter label={t("book.passengers")} icon="people-outline" value={pax} min={1} onChange={setPax} />
          <Counter label={t("book.luggage")} icon="briefcase-outline" value={lug} min={0} onChange={setLug} />
        </View>
      </MapSheet>
    );
  }

  // --- 2. Araç seçimi --------------------------------------------------------------
  if (step === "vehicle") {
    return (
      <MapSheet map={<MapCanvas seed={seed} mode="route" focusTop={0.62} />} mapRatio={0.36} overlay={overlay}
        bottom={
          <Button
            title={selectedType && selectedQuote ? `${t("book.select", { name: selectedType.name })} · ${money(selectedQuote.price, selectedQuote.currency, LOCALE)}` : t("book.chooseVehicle")}
            onPress={() => setStep("details")}
            disabled={!selectedQuote}
            busy={busy}
          />
        }>
        {stepper}
        <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <RouteStops from={from?.label ?? ""} to={to?.label ?? ""} compact />
          </View>
          <Pressable onPress={() => setStep("trip")} hitSlop={8} style={{ backgroundColor: colors.brandSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
            <T style={{ fontWeight: "600", fontSize: 13 }}>{t("book.edit")}</T>
          </Pressable>
        </Row>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Badge text={instant ? t("home.now") : wallClockLabel(at)} />
          <Badge text={`${pax} · ${lug}`} />
          {roundTrip ? <Badge text={t("book.roundTrip")} tone="accent" /> : null}
        </View>
        <H2>{t("book.chooseVehicle")}</H2>
        <ErrLine error={error} />
        <View style={{ gap: 10 }}>
          {types.map((vt, i) => {
            const q = quotes[vt.code];
            const ok = q && !(q instanceof ApiError);
            const on = vehicle === vt.code;
            return (
              <Animated.View key={vt.code} entering={FadeInRight.duration(420).delay(i * 80)}>
                <Pressable disabled={!ok} onPress={() => { tap(); setVehicle(vt.code); }}
                  style={[{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, paddingRight: 14, borderRadius: 18, borderWidth: 2, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? "#fff" : "#fff" }, !ok && q ? { opacity: 0.45 } : null]}>
                  <View style={{ width: 96, height: 62, borderRadius: 12, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {VEHICLE_IMAGE[vt.code] ? (
                      <Image source={VEHICLE_IMAGE[vt.code]} style={{ width: 96, height: 62, mixBlendMode: "multiply" } as object} resizeMode="contain" />
                    ) : (
                      <Ionicons name={VEHICLE_ICON[vt.code] ?? "car-outline"} size={30} color={colors.ink} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Row gap={8}>
                      <T style={{ fontWeight: "700", fontSize: 16.5 }}>{vt.name}</T>
                      {vt.code === "vip_van" ? <Badge text="VIP" tone="dark" /> : null}
                    </Row>
                    <Row gap={10}>
                      <Row gap={3}><Ionicons name="person" size={13} color={colors.muted} /><T style={s.hint}>{vt.capacity}</T></Row>
                      <Row gap={3}><Ionicons name="briefcase" size={13} color={colors.muted} /><T style={s.hint}>{vt.luggage_capacity}</T></Row>
                    </Row>
                    {ok ? <T style={s.hint}>{t("book.distance", { km: Number(q.legs[0].distance_km).toFixed(0), minutes: q.legs[0].duration_minutes })}</T> : null}
                    {q instanceof ApiError ? <T style={[s.hint, { color: colors.danger }]} numberOfLines={2}>{errorText(q)}</T> : null}
                  </View>
                  {ok ? (
                    <T style={{ fontWeight: "800", fontSize: 17, letterSpacing: -0.3 }}>{money(q.price, q.currency, LOCALE)}</T>
                  ) : !q ? (
                    <Skeleton width={72} height={22} />
                  ) : null}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
        <Row gap={8} style={{ justifyContent: "center", marginTop: 4 }}>
          <Ionicons name="shield-checkmark" size={15} color={colors.ok} />
          <T style={s.hint}>{t("book.fixedPrice")}</T>
        </Row>
      </MapSheet>
    );
  }

  // --- 3. Bilgiler ve onay ------------------------------------------------------------
  return (
    <MapSheet map={<MapCanvas seed={seed} mode="route" focusTop={0.7} />} mapRatio={0.2} overlay={overlay}
      bottom={
        <>
          <Row spread>
            <T style={s.hint}>{t("book.total")}</T>
            <T style={{ fontWeight: "800", fontSize: 20, letterSpacing: -0.4 }}>{selectedQuote ? money(total, selectedQuote.currency, LOCALE) : "—"}</T>
          </Row>
          <Button title={t("book.create")} icon="lock-closed" onPress={create} busy={busy}
            disabled={d.name.trim().length < 2 || !consent.disclosure || !consent.distance} />
        </>
      }>
      {stepper}
      {selectedQuote && from && to && (
        <Card flat>
          <Row spread style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 1 }}>
              <RouteStops from={from.label} to={to.label} compact />
            </View>
            {vehicle && VEHICLE_IMAGE[vehicle] ? <Image source={VEHICLE_IMAGE[vehicle]} style={{ width: 84, height: 54, mixBlendMode: "multiply" } as object} resizeMode="contain" /> : null}
          </Row>
          <Row gap={8}>
            <Badge text={selectedType?.name ?? ""} tone="dark" />
            <Badge text={instant ? t("home.now") : wallClockLabel(at)} />
            <Badge text={`${pax} · ${lug}`} />
          </Row>
        </Card>
      )}
      <ErrLine error={error} />
      <H2>{t("book.detailsTitle")}</H2>
      <Input label={t("book.passengerName")} icon="person-outline" value={d.name} onChangeText={(v) => setD({ ...d, name: v })} autoComplete="name" maxLength={120} />
      <Input label={t("book.flightNo")} icon="airplane-outline" value={d.flight} onChangeText={(v) => setD({ ...d, flight: v.toUpperCase() })} autoCapitalize="characters" maxLength={10} placeholder="TK1234" />
      <Input label={t("book.pickupNote")} icon="location-outline" value={d.pickupNote} onChangeText={(v) => setD({ ...d, pickupNote: v })} maxLength={120} />
      <Input label={t("book.dropoffNote")} icon="flag-outline" value={d.dropoffNote} onChangeText={(v) => setD({ ...d, dropoffNote: v })} maxLength={120} />
      <Input label={t("book.note")} icon="chatbubble-ellipses-outline" value={d.note} onChangeText={(v) => setD({ ...d, note: v })} multiline maxLength={500} />
      {selectedQuote?.guarantee_available && (
        <Card flat>
          <Toggle icon="shield-checkmark-outline" label={t("book.guarantee", { fee: money(selectedQuote.guarantee_fee, selectedQuote.currency, LOCALE) })}
            value={d.guarantee} onChange={(v) => setD({ ...d, guarantee: v })} />
        </Card>
      )}
      <H2>{t("book.consentTitle")}</H2>
      <CheckCard label={t("book.acceptDisclosure")} checked={consent.disclosure} onChange={(v) => setConsent({ ...consent, disclosure: v })}
        link={{ title: t("book.read"), onPress: () => legal("privacy") }} />
      <CheckCard label={t("book.acceptDistanceSales")} checked={consent.distance} onChange={(v) => setConsent({ ...consent, distance: v })}
        link={{ title: t("book.read"), onPress: () => legal("distance-sales") }} />
      <CheckCard label={t("book.acceptMarketing")} checked={consent.marketing} onChange={(v) => setConsent({ ...consent, marketing: v })} />
      {selectedQuote && (
        <Card flat>
          <Row spread><P muted>{t("book.step.vehicle")}</P><P>{money(selectedQuote.price, selectedQuote.currency, LOCALE)}</P></Row>
          {d.guarantee ? <Row spread><P muted>{t("book.guarantee", { fee: "" }).replace(/\(\+\)/, "").trim()}</P><P>{money(selectedQuote.guarantee_fee, selectedQuote.currency, LOCALE)}</P></Row> : null}
        </Card>
      )}
    </MapSheet>
  );
}

function ErrLine({ error }: { error: string | null }) {
  return <Alert text={error} />;
}
