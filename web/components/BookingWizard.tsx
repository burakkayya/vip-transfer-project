"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, CREATE_TIMEOUT_MS, api, isAbort } from "@/lib/api";
import { dateTime, localInputToIso, money } from "@/lib/format";
import { useApiError, useSession } from "@/lib/hooks";
import { MARKETING_CONSENT_VERSION, defaultCountry } from "@/lib/site";
import type { Trip } from "@/lib/trip";
import { loadTrip, saveTrip, toPlace } from "@/lib/trip";
import type { Booking, BookingCreate, Endpoint, Quote, QuoteRequest, Region, VehicleType } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import CountrySelect from "./CountrySelect";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./States";
import { vehicleImage } from "@/lib/vehicles";
import Icon, { vehicleIcon } from "./Icon";
import OtpLogin from "./OtpLogin";
import RouteMap, { type MapPoint } from "./RouteMap";
import TripForm, { useRegions } from "./TripForm";

type Step = "vehicle" | "details" | "verify" | "confirm";
const STEPS: Step[] = ["vehicle", "details", "verify", "confirm"];
const FLIGHT_RE = /^[A-Za-z0-9]{2,3}\s?\d{1,5}[A-Za-z]?$/;

/** Kullanıcıya olduğu gibi gösterilecek, zaten çevrilmiş mesaj. */
class Shown extends Error {}

interface Details {
  passengerName: string;
  country: string;
  pickupNote: string;
  dropoffNote: string;
  flightNo: string;
  flightNoReturn: string;
  note: string;
  instant: boolean;
  guarantee: boolean;
}

type FieldErrors = Partial<Record<"name" | "flight" | "flight-return", string>>;

function quoteRequest(trip: Trip, vehicle: string, d: Details, withNotes: boolean): QuoteRequest {
  return {
    pickup: toPlace(trip.from!, withNotes ? d.pickupNote : undefined),
    dropoff: toPlace(trip.to!, withNotes ? d.dropoffNote : undefined),
    vehicle_type_code: vehicle,
    pickup_at: d.instant ? new Date().toISOString() : localInputToIso(trip.at),
    return_pickup_at: trip.roundTrip ? localInputToIso(trip.returnAt) : null,
    passenger_count: trip.pax,
    luggage_count: trip.lug,
    country_code: d.country,
    with_guarantee: withNotes && d.guarantee,
  };
}

/** Ağ veya sunucu hatası mı (yeniden denemeye değer), yoksa seçime özgü bir neden mi (kapasite vb.)? */
const isTransient = (e: ApiError) => e.status === 0 || e.status >= 500;

/** Alanın ipucu ve hata metni kimlikleri; hata varken alan `aria-invalid` olur. */
function described(id: string, error: string | undefined, hint = true) {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return { "aria-invalid": error ? true : undefined, "aria-describedby": ids || undefined } as const;
}

export default function BookingWizard(props: { regions: Region[]; vehicleTypes: VehicleType[]; initial: Trip }) {
  const t = useTranslations("book");
  const tTrip = useTranslations("trip");
  const tErr = useTranslations("errors");
  const tBk = useTranslations("bookings");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const regions = useRegions(props.regions);
  const { loggedIn, setLoggedIn, error: sessionError, check: checkSession, recheck } = useSession();

  const [trip, setTrip] = useState(props.initial);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState(props.vehicleTypes);
  const [vehicleTypesError, setVehicleTypesError] = useState(false);
  const [vehicleTypesTry, setVehicleTypesTry] = useState(0);
  const [quotes, setQuotes] = useState<Record<string, Quote | ApiError | undefined>>({});
  const [quotesTry, setQuotesTry] = useState(0);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [step, setStep] = useState<Step>("vehicle");
  // Doğrulama adımı bu sihirbazda bir kez gösterildiyse göstergede kalır (adım sayısı yolda değişmez).
  const [verifySeen, setVerifySeen] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({
    passengerName: "",
    country: defaultCountry[locale] ?? "GB",
    pickupNote: "",
    dropoffNote: "",
    flightNo: "",
    flightNoReturn: "",
    note: "",
    instant: false,
    guarantee: false,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [finalQuote, setFinalQuote] = useState<Quote | null>(null);
  const [consents, setConsents] = useState({ disclosure: false, distanceSales: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Rezervasyon oluşturma yanıtı süresinde gelmedi: kayıt açılmış olabilir, yeniden gönderim kapalı. */
  const [createUncertain, setCreateUncertain] = useState(false);

  const setD = <K extends keyof Details>(k: K, v: Details[K]) => setDetails((s) => ({ ...s, [k]: v }));
  const fmt = (amount: string, currency: string) => money(amount, currency, locale);
  // Harita noktaları: adres aramasından gelen konum, yoksa bölge merkezi. Nesne kimliği rota değişmedikçe sabit
  // kalır (harita her çizimde yeniden sığdırılmaz).
  const mapFrom = useMemo(() => mapPoint(trip.from), [trip.from]);
  const mapTo = useMemo(() => mapPoint(trip.to), [trip.to]);
  // Teklifler gelmeden de karayolu çizgisi gösterilir (K-58: düz çizgi değil).
  // Çizgi hangi nokta çiftine aitse onunla saklanır; noktalar değişince eski çizgi kendiliğinden gizlenir.
  const [preview, setPreview] = useState<{ from: Endpoint; to: Endpoint; line: string | null } | null>(null);
  const tripFrom = trip.from;
  const tripTo = trip.to;
  const previewRoute = preview && preview.from === tripFrom && preview.to === tripTo ? preview.line : null;
  useEffect(() => {
    const from = tripFrom;
    const to = tripTo;
    if (!from || !to) return;
    const ctrl = new AbortController();
    api<{ route_polyline: string | null }>("routes/preview", {
      body: { pickup: toPlace(from), dropoff: toPlace(to) },
      signal: ctrl.signal,
    }).then((r) => setPreview({ from, to, line: r.route_polyline ?? null }), () => undefined);
    return () => ctrl.abort();
  }, [tripFrom, tripTo]);

  const clearFieldError = (k: keyof FieldErrors) =>
    setFieldErrors((s) => {
      if (!s[k]) return s;
      const next = { ...s };
      delete next[k];
      return next;
    });

  function goStep(next: Step) {
    if (next === "verify") setVerifySeen(true);
    setStep(next);
  }

  // Ana sayfadan gelen rota (adres jetonlarıyla) sessionStorage'dadır; link parametresi yoksa onu kullan.
  useEffect(() => {
    const stored = loadTrip();
    const initial = props.initial.from && props.initial.to ? props.initial : stored ?? props.initial;
    setTrip(initial);
    setEditing(!initial.from || !initial.to);
    setReady(true);
  }, [props.initial]);

  useEffect(() => {
    if (vehicleTypes.length > 0) return;
    let cancelled = false;
    setVehicleTypesError(false);
    api<VehicleType[]>("vehicle-types").then(
      (list) => !cancelled && (list.length ? setVehicleTypes(list) : setVehicleTypesError(true)),
      () => !cancelled && setVehicleTypesError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [vehicleTypes.length, vehicleTypesTry]);

  // Araç listesindeki fiyatlar: rota, tarih veya ülke (para birimi) değişince yeniden hesaplanır.
  useEffect(() => {
    if (!ready || editing || !trip.from || !trip.to || vehicleTypes.length === 0) return;
    let cancelled = false;
    setLoadingQuotes(true);
    const base = { ...details, instant: false, guarantee: false };
    Promise.all(
      vehicleTypes.map((vt) =>
        api<Quote>("quotes", { body: quoteRequest(trip, vt.code, base, false) }).then(
          (q) => [vt.code, q] as const,
          (e) => [vt.code, e instanceof ApiError ? e : new ApiError(0, "network", "")] as const,
        ),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setQuotes(Object.fromEntries(rows));
      setLoadingQuotes(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trip, editing, vehicleTypes, details.country, quotesTry]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Shown ? e.message : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function onTrip(next: Trip) {
    setTrip(next);
    saveTrip(next);
    setEditing(false);
    setStep("vehicle");
    setFinalQuote(null);
  }

  async function confirmQuote() {
    setFinalQuote(await api<Quote>("quotes", { body: quoteRequest(trip, vehicle!, details, true) }));
    setStep("confirm");
  }

  function goConfirm() {
    return run(confirmQuote);
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs: FieldErrors = {};
    if (details.passengerName.trim().length < 2) errs.name = t("nameRequired");
    if (details.flightNo.trim() && !FLIGHT_RE.test(details.flightNo.trim())) errs.flight = t("flightInvalid");
    if (trip.roundTrip && details.flightNoReturn.trim() && !FLIGHT_RE.test(details.flightNoReturn.trim()))
      errs["flight-return"] = t("flightInvalid");
    setFieldErrors(errs);
    const first = (["name", "flight", "flight-return"] as const).find((k) => errs[k]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    if (loggedIn === true) void goConfirm();
    else if (loggedIn === false) goStep("verify");
    else {
      // Oturum durumu bilinmiyor (denetim sürüyor veya ağ/sunucu hatası): müşteri sessizce doğrulamaya gönderilmez.
      // Yeniden denetlenir; yine bilinemezse hata bu formda gösterilir.
      void run(async () => {
        if (await checkSession()) await confirmQuote();
        else goStep("verify");
      });
    }
  }

  function createBooking() {
    return run(async () => {
      const req = quoteRequest(trip, vehicle!, details, true);
      const body: BookingCreate = {
        ...req,
        booking_type: details.instant ? "anlik" : "planli",
        expected_total: finalQuote!.total,
        passenger_name: details.passengerName.trim(),
        note: details.note.trim() || null,
        flights: [
          { leg_order: 1, flight_no: details.flightNo.trim() },
          { leg_order: 2, flight_no: trip.roundTrip ? details.flightNoReturn.trim() : "" },
        ].filter((f) => f.flight_no),
        locale,
        accept_disclosure: consents.disclosure,
        accept_distance_sales: consents.distanceSales,
      };
      try {
        const booking = await api<Booking>("me/bookings", { body, timeoutMs: CREATE_TIMEOUT_MS });
        if (consents.marketing) {
          await api("me/consents", {
            body: { consent_type: "pazarlama", accepted: true, version: MARKETING_CONSENT_VERSION },
          }).catch(() => undefined);
        }
        router.push(`/bookings/${booking.booking_code}/pay`);
      } catch (e) {
        if (e instanceof ApiError && e.code === "price_changed") {
          const q = await api<Quote>("quotes", { body: req });
          setFinalQuote(q);
          throw new Shown(t("priceChanged", { total: fmt(q.total, q.currency) }));
        }
        if (isAbort(e)) {
          // Sonuç belirsiz: aynı isteği yeniden göndermek ikinci rezervasyon açabilir; müşteri önce listesine bakar.
          setCreateUncertain(true);
          return;
        }
        if (e instanceof ApiError && e.status === 401) {
          setLoggedIn(false);
          goStep("verify");
          // Neden yeniden doğrulama istendiği söylenir (genel "bir hata oluştu" değil).
          throw new Shown(tErr("unauthorized"));
        }
        throw e;
      }
    });
  }

  // Adım değişince formun başı görünür olur ve odak yeni adımın başlığına gider
  // (tıklanan araç kartı DOM'dan kalktığı için odak aksi halde sayfanın başına düşer).
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: reduce ? "auto" : "smooth" });
    }
    heading.current?.focus({ preventScroll: true });
  }, [step, editing]);

  if (!ready) return null;

  if (editing) {
    const canCancel = Boolean(trip.from && trip.to);
    return (
      <div className="wizard-start stack">
        <p className="lead">{t("startLead")}</p>
        <div className="card elevated">
          <TripForm regions={regions} initial={trip} onSubmit={onTrip} />
        </div>
        {canCancel && (
          <div>
            <button className="btn link" type="button" onClick={() => setEditing(false)}>{t("cancelEdit")}</button>
          </div>
        )}
      </div>
    );
  }

  const selectedType = vehicleTypes.find((v) => v.code === vehicle);
  const selectedQuote = vehicle ? quotes[vehicle] : undefined;
  const listQuote = selectedQuote && !(selectedQuote instanceof ApiError) ? selectedQuote : null;
  const shownQuote = finalQuote ?? listQuote;
  // Rota tüm araç tiplerinde aynıdır: seçili teklif yoksa ilk gelen teklifin rotası çizilir.
  const routeQuote = shownQuote ?? (Object.values(quotes).find((q) => q && !(q instanceof ApiError)) as Quote | undefined);
  const routeLeg = routeQuote?.legs[0];
  const routeMeta = routeLeg ? t("distance", { km: Number(routeLeg.distance_km).toFixed(0), minutes: routeLeg.duration_minutes }) : null;
  const visibleSteps = loggedIn === true && !verifySeen ? STEPS.filter((s) => s !== "verify") : STEPS;
  const stepIndex = visibleSteps.indexOf(step);
  const transientQuoteError = Object.values(quotes).find((q) => q instanceof ApiError && isTransient(q)) as ApiError | undefined;
  const canPay = consents.disclosure && consents.distanceSales;
  const errorBox = error && <p className="alert error" role="alert">{error}</p>;
  // Yeni sekmede açılan yasal bağlantılar bunu ekran okuyucuya söyler (detaydaki harita bağlantısıyla aynı metin).
  const newTab = <span className="sr-only"> ({tBk("newTab")})</span>;

  const back = (to: Step) => (
    <button className="btn link wizard-back" type="button" onClick={() => setStep(to)}>
      <Icon name="arrow" size={16} /> {t("back")}
    </button>
  );
  const head = (title: string, backTo?: Step) => (
    <div className="wizard-step-head">
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      {backTo && back(backTo)}
    </div>
  );

  return (
    <div className="wizard" ref={top}>
      <div className="wizard-map">
        <RouteMap from={mapFrom} to={mapTo} route={routeLeg?.route_polyline ?? previewRoute} meta={routeMeta} />
      </div>
      <div className="wizard-main">
        {sessionError ? (
          // Oturum durumu bilinemedi (ağ, süre aşımı, 5xx): müşteri oturumsuz sayılmaz, hata ve yeniden dene.
          <div className="wizard-session-error">
            <ErrorState text={errorText(sessionError)} onRetry={recheck} />
          </div>
        ) : loggedIn === null ? (
          // Oturum durumu bilinmeden adım sayısı (3 veya 4) çizilmez; yer tutucu yüksekliği korur, gösterge sıçramaz.
          <div className="stepper-bar stepper-pending" aria-hidden="true" />
        ) : (
          <ol className="stepper-bar" aria-label={t("progress")}>
            {visibleSteps.map((s, i) => (
              <li key={s} className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span className="name">{t(`steps.${s}`)}</span>
                {i < stepIndex && <span className="sr-only"> ({t("stepDone")})</span>}
              </li>
            ))}
          </ol>
        )}

        {step === "vehicle" && (
          <section className="stack wizard-step" key="vehicle">
            {head(t("chooseVehicle"))}
            {errorBox}
            {vehicleTypes.length === 0 ? (
              vehicleTypesError ? (
                <ErrorState text={errorText(null)} onRetry={() => setVehicleTypesTry((n) => n + 1)} />
              ) : (
                <LoadingState label={t("loading")} />
              )
            ) : (
              <>
                <p className={loadingQuotes ? "muted" : "sr-only"} role="status">
                  {loadingQuotes ? t("loading") : Object.keys(quotes).length > 0 ? t("pricesReady") : ""}
                </p>
                {transientQuoteError && !loadingQuotes && (
                  <ErrorState text={errorText(transientQuoteError)} onRetry={() => setQuotesTry((n) => n + 1)} />
                )}
                <div className="vehicle-list">
                  {vehicleTypes.map((vt) => {
                    const q = quotes[vt.code];
                    const ok = q && !(q instanceof ApiError);
                    const img = vehicleImage(vt.code);
                    return (
                      <button
                        type="button"
                        key={vt.code}
                        className={`vehicle-card ${vehicle === vt.code ? "selected" : ""}`}
                        disabled={!ok}
                        aria-busy={!q && loadingQuotes}
                        onClick={() => {
                          setVehicle(vt.code);
                          setFinalQuote(null);
                          setStep("details");
                          setError(null);
                        }}
                      >
                        <span className="vehicle-media">
                          {img ? (
                            <Image src={img} alt="" width={300} height={188} sizes="(max-width: 720px) 110px, 150px" />
                          ) : (
                            <Icon name={vehicleIcon(vt.code)} size={40} />
                          )}
                        </span>
                        <span className="vehicle-info">
                          <strong>{vt.name}</strong>
                          <span className="specs">
                            <span>
                              <Icon name="users" size={16} /> <span aria-hidden="true">{vt.capacity}</span>
                              <span className="sr-only">{t("seats", { count: vt.capacity })}</span>
                            </span>
                            <span>
                              <Icon name="bag" size={16} /> <span aria-hidden="true">{vt.luggage_capacity}</span>
                              <span className="sr-only">{t("bags", { count: vt.luggage_capacity })}</span>
                            </span>
                          </span>
                          {ok && (
                            <span className="hint">
                              {q.legs.map((leg, i) => (
                                <span key={i}>
                                  {q.legs.length > 1 && `${i === 0 ? t("outbound") : t("return")}: `}
                                  {t("distance", { km: Number(leg.distance_km).toFixed(0), minutes: leg.duration_minutes })}
                                  {i < q.legs.length - 1 && " · "}
                                </span>
                              ))}
                            </span>
                          )}
                          {q instanceof ApiError && !isTransient(q) && <span className="hint">{errorText(q)}</span>}
                        </span>
                        <span className="vehicle-price">
                          {ok ? (
                            <>
                              <span className="price">{fmt(q.price, q.currency)}</span>
                              <span className="hint">{t("perTrip")}</span>
                            </>
                          ) : !q && loadingQuotes ? (
                            <span className="skeleton" aria-hidden="true" />
                          ) : (
                            <span className="hint">{t("unavailable")}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {step === "details" && (
          <form className="card stack wizard-step" key="details" onSubmit={submitDetails} noValidate>
            {head(t("steps.details"), "vehicle")}
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="name">{t("passengerName")}</label>
                <input id="name" required minLength={2} maxLength={120} autoComplete="name"
                  {...described("name", fieldErrors.name)}
                  value={details.passengerName}
                  onChange={(e) => {
                    setD("passengerName", e.target.value);
                    clearFieldError("name");
                  }} />
                {fieldErrors.name && <span className="field-error" id="name-error">{fieldErrors.name}</span>}
                <span className="hint" id="name-hint">{t("passengerNameHint")}</span>
              </div>
              <CountrySelect id="country" label={t("country")} hint={t("countryHint")} value={details.country} onChange={(v) => setD("country", v)} />
              <div className="field">
                <label htmlFor="pickup-note">{t("pickupAddress")}</label>
                <input id="pickup-note" maxLength={120} value={details.pickupNote} onChange={(e) => setD("pickupNote", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="dropoff-note">{t("dropoffAddress")}</label>
                <input id="dropoff-note" maxLength={120} value={details.dropoffNote} onChange={(e) => setD("dropoffNote", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="flight">{t("flightNo")}</label>
                <div className="with-icon">
                  <Icon name="plane" />
                  <input id="flight" maxLength={10} placeholder="TK1234" autoCapitalize="characters" value={details.flightNo}
                    {...described("flight", fieldErrors.flight)}
                    onChange={(e) => {
                      setD("flightNo", e.target.value.toUpperCase());
                      clearFieldError("flight");
                    }} />
                </div>
                {fieldErrors.flight && <span className="field-error" id="flight-error">{fieldErrors.flight}</span>}
                <span className="hint" id="flight-hint">{t("flightHint")}</span>
              </div>
              {trip.roundTrip && (
                <div className="field">
                  <label htmlFor="flight-return">{t("flightNoReturn")}</label>
                  <div className="with-icon">
                    <Icon name="plane" />
                    <input id="flight-return" maxLength={10} placeholder="TK1235" autoCapitalize="characters" value={details.flightNoReturn}
                      {...described("flight-return", fieldErrors["flight-return"], false)}
                      onChange={(e) => {
                        setD("flightNoReturn", e.target.value.toUpperCase());
                        clearFieldError("flight-return");
                      }} />
                  </div>
                  {fieldErrors["flight-return"] && (
                    <span className="field-error" id="flight-return-error">{fieldErrors["flight-return"]}</span>
                  )}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="note">{t("note")}</label>
              <textarea id="note" rows={3} maxLength={500} aria-describedby="note-hint" value={details.note} onChange={(e) => setD("note", e.target.value)} />
              <span className="hint" id="note-hint">{t("noteHint")}</span>
            </div>
            <div className="option-card">
              <input id="instant" type="checkbox" aria-describedby="instant-hint" checked={details.instant} onChange={(e) => setD("instant", e.target.checked)} />
              <label htmlFor="instant">
                <strong>{t("instant")}</strong>
                <span className="hint" id="instant-hint">{t("instantHint")}</span>
              </label>
            </div>
            {listQuote?.guarantee_available && (
              <div className="option-card">
                <input id="guarantee" type="checkbox" aria-describedby="guarantee-hint" checked={details.guarantee} onChange={(e) => setD("guarantee", e.target.checked)} />
                <label htmlFor="guarantee">
                  <strong>{t("guarantee", { fee: fmt(listQuote.guarantee_fee, listQuote.currency) })}</strong>
                  <span className="hint" id="guarantee-hint">{t("guaranteeHint")}</span>
                </label>
              </div>
            )}
            {errorBox}
            <div className="wizard-actions">
              <button className="btn primary" type="submit" disabled={busy}>{t("continue")} <Icon name="arrow" size={18} /></button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <div className="card stack wizard-step" key="verify">
            {head(t("verifyTitle"), "details")}
            <p className="muted">{t("verifyText")}</p>
            {errorBox}
            <OtpLogin
              country={details.country}
              onDone={() => {
                setLoggedIn(true);
                void goConfirm();
              }}
            />
          </div>
        )}

        {step === "confirm" && finalQuote && (
          <div className="card stack wizard-step" key="confirm">
            {head(t("steps.confirm"), "details")}
            <p className="cancel-tiers">
              <Icon name="refund" size={18} />
              <span>{t("cancelTiers")}</span>
            </p>
            <fieldset className="consents">
              <legend className="sr-only">{t("consentsLegend")}</legend>
              <label className="check">
                <input type="checkbox" aria-required="true" checked={consents.disclosure}
                  onChange={(e) => setConsents((c) => ({ ...c, disclosure: e.target.checked }))} />
                <span>{t.rich("acceptDisclosure", { link: (c) => <Link href="/legal/privacy" target="_blank">{c}{newTab}</Link> })}</span>
              </label>
              <label className="check">
                <input type="checkbox" aria-required="true" checked={consents.distanceSales}
                  onChange={(e) => setConsents((c) => ({ ...c, distanceSales: e.target.checked }))} />
                <span>
                  {t.rich("acceptDistanceSales", {
                    link: (c) => <Link href="/legal/distance-sales" target="_blank">{c}{newTab}</Link>,
                    policy: (c) => <Link href="/legal/cancellation" target="_blank">{c}{newTab}</Link>,
                  })}
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={consents.marketing}
                  onChange={(e) => setConsents((c) => ({ ...c, marketing: e.target.checked }))} />
                <span>{t("acceptMarketing")}</span>
              </label>
            </fieldset>
            <div className="confirm-total">
              <span>{t("total")}</span>
              <span className="price">{fmt(finalQuote.total, finalQuote.currency)}</span>
            </div>
            {errorBox}
            {createUncertain && (
              <p className="alert error create-uncertain" role="alert">
                {t("createUncertain")}{" "}
                <Link href="/bookings">{tBk("title")}</Link>
              </p>
            )}
            <div className="wizard-actions">
              <button className="btn primary big" type="button" onClick={createBooking} disabled={busy || !canPay || createUncertain}
                aria-describedby={canPay ? undefined : "pay-hint"}>
                <Icon name="lock" size={18} /> {busy ? t("creating") : t("payNow")}
              </button>
              {!canPay && <p className="hint" id="pay-hint">{t("payHint")}</p>}
            </div>
          </div>
        )}
      </div>

      <aside className="wizard-summary" aria-labelledby="wizard-summary-title">
        <div className="card elevated stack">
          <div className="row spread">
            <h3 id="wizard-summary-title">{t("summary")}</h3>
            <button className="btn link" type="button" onClick={() => setEditing(true)}>{t("editTrip")}</button>
          </div>
          <div className="route-summary">
            <div><span>{trip.from?.label}</span></div>
            <div><span>{trip.to?.label}</span></div>
          </div>
          <dl className="summary">
            <dt><Icon name="calendar" size={16} /> {t("when")}</dt>
            <dd>
              {details.instant ? t("instant") : dateTime(localInputToIso(trip.at), locale)}
              {trip.roundTrip && <><br />{tTrip("roundTrip")}: {dateTime(localInputToIso(trip.returnAt), locale)}</>}
            </dd>
            <dt><Icon name="users" size={16} /> {t("people")}</dt>
            <dd>{t("seats", { count: trip.pax })} · {t("bags", { count: trip.lug })}</dd>
            {selectedType && (
              <>
                <dt><Icon name={vehicleIcon(selectedType.code)} size={16} /> {t("vehicle")}</dt>
                <dd>{selectedType.name}</dd>
              </>
            )}
          </dl>
          {shownQuote && (
            <div className="price-box">
              <div className="row spread"><span>{t("price")}</span><span className="amount">{fmt(shownQuote.price, shownQuote.currency)}</span></div>
              {Number(shownQuote.guarantee_fee) > 0 && (
                <div className="row spread"><span>{t("guaranteeFee")}</span><span className="amount">{fmt(shownQuote.guarantee_fee, shownQuote.currency)}</span></div>
              )}
              <div className="row spread total-row"><span>{t("total")}</span><span className="price">{fmt(shownQuote.total, shownQuote.currency)}</span></div>
            </div>
          )}
          <ul className="trust-list">
            <li><Icon name="shield" size={16} /> {t("fixedPrice")}</li>
            <li><Icon name="refund" size={16} /> {t("freeCancel")}</li>
            <li><Icon name="lock" size={16} /> {t("secure")}</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function mapPoint(e: Endpoint | null): MapPoint | null {
  if (!e) return null;
  if (e.point) return { lat: e.point.lat, lng: e.point.lng, label: e.label };
  const lat = Number(e.region.latitude);
  const lng = Number(e.region.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, label: e.label } : null;
}
