import Ionicons from "@/components/Icon";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { AddressSearch } from "@/components/AddressField";
import DateTimeField from "@/components/DateTimeField";
import MapCanvas from "@/components/MapCanvas";
import MapSheet from "@/components/MapSheet";
import {
  Alert, Badge, Button, Card, CheckCard, H2, IconButton, IconName, Input, P, Row, Segmented, Skeleton, Steps, T,
  colors, s, tap,
} from "@/components/ui";
import { regionName } from "@/lib/airports";
import { ApiError, api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { money, wallClockIso, wallClockLabel } from "@/lib/format";
import { LOCALE, errorText, t } from "@/lib/i18n";
import { requestAutoPay } from "@/lib/routeParams";
import type { Booking, DailyPackage, DailyQuote, Endpoint, Profile, Region, VehicleType } from "@/lib/types";
import { VEHICLE_ICON, VEHICLE_IMAGE, vehicleName } from "@/lib/vehicles";

type Step = "plan" | "vehicle" | "details";
const FLOW: Step[] = ["plan", "vehicle", "details"];
const MAX_DAYS = 14;
const MARKETING_CONSENT_VERSION = "1.0";

/** Varsayılan başlangıç: iki gün sonra saat 09:00 (en az 24 saat önceden, K-29). */
function defaultStart() {
  const d = new Date(Date.now() + 48 * 3600_000);
  d.setHours(9, 0, 0, 0);
  return d;
}

function place(e: Endpoint) {
  return e.place_token ? { place_token: e.place_token, address: null } : { region_id: e.region.id, address: null };
}

function Stepper(props: { label: string; icon: IconName; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const btn = { width: 36, height: 36, borderRadius: 18, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ flex: 1, backgroundColor: colors.brandSoft, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, gap: 8 }}>
      <Row gap={6} style={{ flexWrap: "nowrap" }}>
        <Ionicons name={props.icon} size={15} color={colors.muted} />
        <T style={s.hint} numberOfLines={1}>{props.label}</T>
      </Row>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.label} -`} hitSlop={6} disabled={props.value <= props.min}
          onPress={() => { tap(); props.onChange(Math.max(props.min, props.value - 1)); }}
          style={[btn, { backgroundColor: "#fff", opacity: props.value <= props.min ? 0.4 : 1 }]}>
          <Ionicons name="remove" size={18} color={colors.ink} />
        </Pressable>
        <T style={{ fontWeight: "800", fontSize: 20, minWidth: 28, textAlign: "center" }} accessibilityLiveRegion="polite">{props.value}</T>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.label} +`} hitSlop={6} disabled={props.value >= props.max}
          onPress={() => { tap(); props.onChange(Math.min(props.max, props.value + 1)); }}
          style={[btn, { backgroundColor: colors.ink, opacity: props.value >= props.max ? 0.4 : 1 }]}>
          <Ionicons name="add" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * K-29 şoförlü günlük kiralama: başlangıç noktası, ilk gün saati, gün sayısı ve paket → araç → bilgiler ve onay.
 * Her gün ayrı bir bacak olarak oluşur; ödeme ve iptal transferle aynı akıştır (rezervasyon ekranına geçilir).
 */
export default function Daily() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>("plan");
  const [start, setStart] = useState<Endpoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [startAt, setStartAt] = useState(defaultStart);
  // En erken başlangıç (24 saat sonra); ekran açılırken bir kez hesaplanır, kesin denetim backend'dedir.
  const [minStart] = useState(() => new Date(Date.now() + 24 * 3600_000));
  const [days, setDays] = useState(2);
  const [pkg, setPkg] = useState<DailyPackage>("tam");
  const [pax, setPax] = useState(2);
  const [lug, setLug] = useState(2);
  const [quotes, setQuotes] = useState<Record<string, DailyQuote | ApiError>>({});
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [childSeats, setChildSeats] = useState(0);
  const [consent, setConsent] = useState({ disclosure: false, distance: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Region[]>("regions").then(setRegions).catch((e) => setError(errorText(e)));
    api<VehicleType[]>("vehicle-types").then(setTypes).catch(() => undefined);
    api<Profile>("me/profile").then((p) => {
      setProfile(p);
      if (p.full_name) setName((x) => x || p.full_name || "");
    }).catch(() => undefined);
  }, []);

  const point = useMemo(() => {
    if (!start) return undefined;
    if (start.point) return [start.point];
    const { latitude, longitude } = start.region;
    return latitude && longitude ? [{ latitude: Number(latitude), longitude: Number(longitude) }] : undefined;
  }, [start]);

  const request = (vt: string) => ({
    pickup: place(start!),
    vehicle_type_code: vt,
    start_at: wallClockIso(startAt),
    days,
    package: pkg,
    passenger_count: pax,
    luggage_count: lug,
    country_code: profile?.country_code ?? null,
  });

  async function loadQuotes() {
    setBusy(true);
    setError(null);
    setQuotes({});
    setStep("vehicle");
    const rows = await Promise.all(
      types.map((vt) =>
        api<DailyQuote>("daily-quotes", { body: request(vt.code) }).then(
          (q) => [vt.code, q] as const,
          (e) => [vt.code, e instanceof ApiError ? e : new ApiError(0, "network", "")] as const,
        ),
      ),
    );
    const map = Object.fromEntries(rows);
    setQuotes(map);
    const first = types.find((vt) => !(map[vt.code] instanceof ApiError));
    setVehicle((v) => (v && !(map[v] instanceof ApiError) ? v : first?.code ?? null));
    setBusy(false);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const req = request(vehicle!);
      const q = await api<DailyQuote>("daily-quotes", { body: req });
      try {
        const booking = await api<Booking>("me/daily-bookings", {
          body: {
            ...req,
            expected_total: q.total,
            passenger_name: name.trim(),
            note: note.trim() || null,
            child_seat_count: Math.min(childSeats, pax),
            locale: LOCALE,
            accept_disclosure: consent.disclosure,
            accept_distance_sales: consent.distance,
          },
        });
        if (consent.marketing) {
          await api("me/consents", { body: { consent_type: "pazarlama", accepted: true, version: MARKETING_CONSENT_VERSION } }).catch(() => undefined);
        }
        requestAutoPay(booking.booking_code);
        router.replace({ pathname: "/booking/[code]", params: { code: booking.booking_code } });
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
  const quote = selected && !(selected instanceof ApiError) ? selected : null;
  const selectedType = types.find((x) => x.code === vehicle);
  const pkgLabel = pkg === "tam" ? t("daily.full") : t("daily.half");
  const legal = (slug: string) => WebBrowser.openBrowserAsync(`${WEB_URL}/${LOCALE}/legal/${slug}`);
  const back = () => (step === "plan" ? (router.canGoBack() ? router.back() : router.replace("/book")) : setStep(FLOW[FLOW.indexOf(step) - 1]));
  const overlay = <IconButton icon="arrow-back" label={t("back")} onPress={back} />;
  const stepper = <Steps steps={[t("daily.package"), t("book.step.vehicle"), t("book.step.details")]} current={FLOW.indexOf(step)} />;
  const map = <MapCanvas seed={`daily:${start?.label ?? ""}`} mode="idle" focusTop={0.5} endpoints={point} />;
  const summary = (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      <Badge text={wallClockLabel(startAt, LOCALE)} />
      <Badge text={t("daily.summary", { days, package: pkgLabel })} tone="accent" />
      <Badge text={`${pax} · ${lug}`} />
    </View>
  );

  // --- 1. Plan: başlangıç, saat, gün, paket ------------------------------------------
  if (step === "plan") {
    return (
      <MapSheet map={map} mapRatio={0.26} overlay={overlay}
        bottom={<Button title={t("daily.showPrices")} iconRight="arrow-forward" onPress={loadQuotes} busy={busy} disabled={!start || types.length === 0} />}>
        {stepper}
        <View style={{ gap: 4 }}>
          <T style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }} accessibilityRole="header">{t("daily.title")}</T>
          <P muted small>{t("daily.intro")}</P>
        </View>
        <Alert text={error} />
        <Pressable onPress={() => setSearching(true)} accessibilityRole="button" accessibilityLabel={t("daily.start")}
          style={{ backgroundColor: colors.brandSoft, borderRadius: 18, minHeight: 60, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name="business-outline" size={20} color={colors.ink} />
          <View style={{ flex: 1, paddingVertical: 10 }}>
            {start ? (
              <>
                <T style={[s.p, { fontWeight: "600" }]} numberOfLines={1}>{start.label}</T>
                <T style={s.hint} numberOfLines={1}>{t("addr.region", { region: regionName(start.region, LOCALE) })}</T>
              </>
            ) : (
              <T style={[s.p, { color: colors.faint, fontWeight: "500", fontSize: 16 }]}>{t("daily.start")}</T>
            )}
          </View>
        </Pressable>
        <AddressSearch open={searching} title={t("daily.start")} regions={regions} onClose={() => setSearching(false)}
          onPick={(e) => { setStart(e); setSearching(false); }} />
        <DateTimeField label={t("daily.startAt")} value={startAt} onChange={setStartAt} minimumDate={minStart} />
        <H2>{t("daily.package")}</H2>
        <Segmented value={pkg} onChange={setPkg} options={[{ value: "tam", label: t("daily.full") }, { value: "yarim", label: t("daily.half") }]} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Stepper label={t("daily.days")} icon="calendar-outline" value={days} min={1} max={MAX_DAYS} onChange={setDays} />
          <Stepper label={t("book.passengers")} icon="people-outline" value={pax} min={1} max={50} onChange={setPax} />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Stepper label={t("book.luggage")} icon="briefcase-outline" value={lug} min={0} max={50} onChange={setLug} />
          <View style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: colors.canvas, borderRadius: 14, padding: 12 }}>
          <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
          <T style={[s.hint, { flex: 1 }]}>{t("daily.leadTime")}</T>
        </View>
      </MapSheet>
    );
  }

  // --- 2. Araç ---------------------------------------------------------------------
  if (step === "vehicle") {
    return (
      <MapSheet map={map} mapRatio={0.22} overlay={overlay}
        bottom={
          <Button
            title={selectedType && quote ? `${t("book.select", { name: vehicleName(selectedType, LOCALE) })} · ${money(quote.total, quote.currency, LOCALE)}` : t("daily.chooseVehicle")}
            onPress={() => setStep("details")} disabled={!quote} busy={busy} />
        }>
        {stepper}
        <Row spread style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <T style={{ flex: 1, fontWeight: "700" }} numberOfLines={2}>{start?.label}</T>
          <Pressable onPress={() => setStep("plan")} hitSlop={8} accessibilityRole="button"
            style={{ backgroundColor: colors.brandSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
            <T style={{ fontWeight: "600", fontSize: 13 }}>{t("daily.edit")}</T>
          </Pressable>
        </Row>
        {summary}
        <H2>{t("daily.chooseVehicle")}</H2>
        <Alert text={error} />
        <View style={{ gap: 10 }}>
          {types.map((vt, i) => {
            const q = quotes[vt.code];
            const ok = q && !(q instanceof ApiError);
            const on = vehicle === vt.code;
            return (
              <Animated.View key={vt.code} entering={FadeInRight.duration(420).delay(i * 80)}>
                <Pressable disabled={!ok} onPress={() => { tap(); setVehicle(vt.code); }} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !ok }}
                  style={[{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, paddingRight: 14, borderRadius: 18, borderWidth: 2, borderColor: on ? colors.ink : colors.line, backgroundColor: "#fff" }, !ok && q ? { opacity: 0.45 } : null]}>
                  <View style={{ width: 96, height: 62, borderRadius: 12, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {VEHICLE_IMAGE[vt.code] ? (
                      <Image source={VEHICLE_IMAGE[vt.code]} style={{ width: 96, height: 62, mixBlendMode: "multiply" } as object} resizeMode="contain" />
                    ) : (
                      <Ionicons name={VEHICLE_ICON[vt.code] ?? "car-outline"} size={30} color={colors.ink} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Row gap={8}>
                      <T style={{ fontWeight: "700", fontSize: 16.5 }}>{vehicleName(vt, LOCALE)}</T>
                      {vt.code.startsWith("vip_") ? <Badge text="VIP" tone="dark" /> : null}
                    </Row>
                    {ok ? <T style={s.hint}>{t("daily.perDay", { price: money(q.day_price, q.currency, LOCALE) })} · {t("daily.limits", { hours: q.hours_per_day, km: q.km_per_day })}</T> : null}
                    {q instanceof ApiError ? <T style={[s.hint, { color: colors.danger }]} numberOfLines={2}>{errorText(q)}</T> : null}
                  </View>
                  {ok ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <T style={{ fontWeight: "800", fontSize: 17, letterSpacing: -0.3 }}>{money(q.total, q.currency, LOCALE)}</T>
                      <T style={s.hint}>{t("daily.total", { days })}</T>
                    </View>
                  ) : !q ? (
                    <Skeleton width={72} height={22} />
                  ) : null}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
        {quote ? <P muted small>{t("daily.extras", { hour: money(quote.extra_hour_price, quote.currency, LOCALE), km: money(quote.extra_km_price, quote.currency, LOCALE) })}</P> : null}
      </MapSheet>
    );
  }

  // --- 3. Bilgiler ve onay ---------------------------------------------------------
  return (
    <MapSheet map={map} mapRatio={0.18} overlay={overlay}
      bottom={
        <>
          <Row spread>
            <T style={s.hint}>{t("book.total")}</T>
            <T style={{ fontWeight: "800", fontSize: 20, letterSpacing: -0.4 }}>{quote ? money(quote.total, quote.currency, LOCALE) : "—"}</T>
          </Row>
          <Button title={t("book.create")} icon="lock-closed" onPress={create} busy={busy}
            disabled={name.trim().length < 2 || !consent.disclosure || !consent.distance || !quote} />
        </>
      }>
      {stepper}
      {quote && (
        <Card flat>
          <T style={{ fontWeight: "700" }} numberOfLines={2}>{start?.label}</T>
          {summary}
          {quote.schedule.map((d) => (
            <Row spread key={d.day}>
              <P muted small>{t("daily.dayN", { n: d.day })} · {wallClockLabel(new Date(d.start_at), LOCALE)}</P>
              <P small>{money(d.price, quote.currency, LOCALE)}</P>
            </Row>
          ))}
          <P muted small>{t("daily.limits", { hours: quote.hours_per_day, km: quote.km_per_day })}</P>
        </Card>
      )}
      <Alert text={error} />
      <H2>{t("book.detailsTitle")}</H2>
      <Input label={t("book.passengerName")} icon="person-outline" value={name} onChangeText={setName} autoComplete="name" maxLength={120} />
      <Input label={t("daily.plan")} hint={t("daily.planHint")} icon="map-outline" value={note} onChangeText={setNote} multiline maxLength={500} />
      <Stepper label={t("meet.childSeats")} icon="happy-outline" value={childSeats} min={0} max={Math.min(4, pax)} onChange={setChildSeats} />
      <H2>{t("book.consentTitle")}</H2>
      <CheckCard label={t("book.acceptDisclosure")} checked={consent.disclosure} onChange={(v) => setConsent({ ...consent, disclosure: v })}
        link={{ title: t("book.read"), onPress: () => legal("privacy") }} />
      <CheckCard label={t("book.acceptDistanceSales")} checked={consent.distance} onChange={(v) => setConsent({ ...consent, distance: v })}
        link={{ title: t("book.read"), onPress: () => legal("distance-sales") }} />
      <CheckCard label={t("book.acceptMarketing")} checked={consent.marketing} onChange={(v) => setConsent({ ...consent, marketing: v })} />
    </MapSheet>
  );
}
