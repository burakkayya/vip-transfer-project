"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { dateTime, localInputToIso, money } from "@/lib/format";
import { useApiError, useSession } from "@/lib/hooks";
import { MARKETING_CONSENT_VERSION, defaultCountry } from "@/lib/site";
import type { Trip } from "@/lib/trip";
import { loadTrip, saveTrip, toPlace } from "@/lib/trip";
import type { Booking, BookingCreate, Quote, QuoteRequest, Region, VehicleType } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import CountrySelect from "./CountrySelect";
import { vehicleImage } from "@/lib/vehicles";
import Icon, { vehicleIcon } from "./Icon";
import OtpLogin from "./OtpLogin";
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

export default function BookingWizard(props: { regions: Region[]; vehicleTypes: VehicleType[]; initial: Trip }) {
  const t = useTranslations("book");
  const tTrip = useTranslations("trip");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const regions = useRegions(props.regions);
  const { loggedIn, setLoggedIn } = useSession();

  const [trip, setTrip] = useState(props.initial);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState(props.vehicleTypes);
  const [quotes, setQuotes] = useState<Record<string, Quote | ApiError | undefined>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [step, setStep] = useState<Step>("vehicle");
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
  const [finalQuote, setFinalQuote] = useState<Quote | null>(null);
  const [consents, setConsents] = useState({ disclosure: false, distanceSales: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setD = <K extends keyof Details>(k: K, v: Details[K]) => setDetails((s) => ({ ...s, [k]: v }));
  const fmt = (amount: string, currency: string) => money(amount, currency, locale);

  // Ana sayfadan gelen rota (adres jetonlarıyla) sessionStorage'dadır; link parametresi yoksa onu kullan.
  useEffect(() => {
    const stored = loadTrip();
    const initial = props.initial.from && props.initial.to ? props.initial : stored ?? props.initial;
    setTrip(initial);
    setEditing(!initial.from || !initial.to);
    setReady(true);
  }, [props.initial]);

  useEffect(() => {
    if (vehicleTypes.length === 0) api<VehicleType[]>("vehicle-types").then(setVehicleTypes).catch(() => undefined);
  }, [vehicleTypes.length]);

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
  }, [ready, trip, editing, vehicleTypes, details.country]);

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

  function goConfirm() {
    return run(async () => {
      setFinalQuote(await api<Quote>("quotes", { body: quoteRequest(trip, vehicle!, details, true) }));
      setStep("confirm");
    });
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    const flights = [details.flightNo, trip.roundTrip ? details.flightNoReturn : ""].filter(Boolean);
    if (flights.some((f) => !FLIGHT_RE.test(f.trim()))) {
      setError(t("flightHint"));
      return;
    }
    if (loggedIn) void goConfirm();
    else setStep("verify");
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
        const booking = await api<Booking>("me/bookings", { body });
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
        if (e instanceof ApiError && e.status === 401) {
          setLoggedIn(false);
          setStep("verify");
        }
        throw e;
      }
    });
  }

  if (!ready) return null;

  if (editing) {
    return (
      <div className="card elevated">
        <TripForm regions={regions} initial={trip} onSubmit={onTrip} />
      </div>
    );
  }

  const selectedType = vehicleTypes.find((v) => v.code === vehicle);
  const selectedQuote = vehicle ? quotes[vehicle] : undefined;
  const listQuote = selectedQuote && !(selectedQuote instanceof ApiError) ? selectedQuote : null;
  const shownQuote = finalQuote ?? listQuote;
  const visibleSteps = loggedIn ? STEPS.filter((s) => s !== "verify") : STEPS;
  const stepIndex = visibleSteps.indexOf(step);

  return (
    <div className="wizard">
      <div className="wizard-main">
        <ol className="stepper-bar">
          {visibleSteps.map((s, i) => (
            <li key={s} className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""}>
              <span className="dot">{i < stepIndex ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className="name">{t(`steps.${s}`)}</span>
            </li>
          ))}
        </ol>

        {error && <p className="alert error">{error}</p>}

        {step === "vehicle" && (
          <section className="stack">
            <h2>{t("chooseVehicle")}</h2>
            {loadingQuotes && <p className="muted">{t("loading")}</p>}
            <div className="vehicle-list">
              {vehicleTypes.map((vt) => {
                const q = quotes[vt.code];
                const ok = q && !(q instanceof ApiError);
                return (
                  <button
                    type="button"
                    key={vt.code}
                    className={`vehicle-card ${vehicle === vt.code ? "selected" : ""}`}
                    disabled={!ok}
                    onClick={() => {
                      setVehicle(vt.code);
                      setFinalQuote(null);
                      setStep("details");
                      setError(null);
                    }}
                  >
                    <span className="vehicle-media">
                      {vehicleImage(vt.code) ? (
                        <img src={vehicleImage(vt.code)!} alt="" width={300} height={188} />
                      ) : (
                        <Icon name={vehicleIcon(vt.code)} size={40} />
                      )}
                    </span>
                    <span className="vehicle-info">
                      <strong>{vt.name}</strong>
                      <span className="specs">
                        <span><Icon name="users" size={16} /> {vt.capacity}</span>
                        <span><Icon name="bag" size={16} /> {vt.luggage_capacity}</span>
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
                      {q instanceof ApiError && <span className="hint">{errorText(q)}</span>}
                    </span>
                    <span className="vehicle-price">
                      {ok ? (
                        <>
                          <span className="price">{fmt(q.price, q.currency)}</span>
                          <span className="hint">{t("perTrip")}</span>

                        </>
                      ) : (
                        <span className="hint">{t("unavailable")}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === "details" && (
          <form className="card stack" onSubmit={submitDetails}>
            <h2>{t("steps.details")}</h2>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="name">{t("passengerName")}</label>
                <input id="name" required minLength={2} maxLength={120} autoComplete="name"
                  value={details.passengerName} onChange={(e) => setD("passengerName", e.target.value)} />
                <span className="hint">{t("passengerNameHint")}</span>
              </div>
              <div className="field">
                <CountrySelect id="country" label={t("country")} value={details.country} onChange={(v) => setD("country", v)} />
                <span className="hint">{t("countryHint")}</span>
              </div>
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
                  <input id="flight" maxLength={10} placeholder="TK1234" value={details.flightNo}
                    onChange={(e) => setD("flightNo", e.target.value.toUpperCase())} />
                </div>
                <span className="hint">{t("flightHint")}</span>
              </div>
              {trip.roundTrip && (
                <div className="field">
                  <label htmlFor="flight-return">{t("flightNoReturn")}</label>
                  <div className="with-icon">
                    <Icon name="plane" />
                    <input id="flight-return" maxLength={10} placeholder="TK1235" value={details.flightNoReturn}
                      onChange={(e) => setD("flightNoReturn", e.target.value.toUpperCase())} />
                  </div>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="note">{t("note")}</label>
              <textarea id="note" rows={3} maxLength={500} value={details.note} onChange={(e) => setD("note", e.target.value)} />
              <span className="hint">{t("noteHint")}</span>
            </div>
            <label className="option-card">
              <input type="checkbox" checked={details.instant} onChange={(e) => setD("instant", e.target.checked)} />
              <span>
                <strong>{t("instant")}</strong>
                <span className="hint">{t("instantHint")}</span>
              </span>
            </label>
            {listQuote?.guarantee_available && (
              <label className="option-card">
                <input type="checkbox" checked={details.guarantee} onChange={(e) => setD("guarantee", e.target.checked)} />
                <span>
                  <strong>{t("guarantee", { fee: fmt(listQuote.guarantee_fee, listQuote.currency) })}</strong>
                  <span className="hint">{t("guaranteeHint")}</span>
                </span>
              </label>
            )}
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => setStep("vehicle")}>{t("back")}</button>
              <button className="btn primary" type="submit" disabled={busy}>{t("continue")} <Icon name="arrow" size={18} /></button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <div className="card stack">
            <h2>{t("verifyTitle")}</h2>
            <p className="muted">{t("verifyText")}</p>
            <OtpLogin
              country={details.country}
              onDone={() => {
                setLoggedIn(true);
                void goConfirm();
              }}
            />
            <div>
              <button className="btn ghost" type="button" onClick={() => setStep("details")}>{t("back")}</button>
            </div>
          </div>
        )}

        {step === "confirm" && finalQuote && (
          <div className="card stack">
            <h2>{t("steps.confirm")}</h2>
            <label className="check">
              <input type="checkbox" checked={consents.disclosure}
                onChange={(e) => setConsents((c) => ({ ...c, disclosure: e.target.checked }))} />
              <span>{t.rich("acceptDisclosure", { link: (c) => <Link href="/legal/privacy" target="_blank">{c}</Link> })}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={consents.distanceSales}
                onChange={(e) => setConsents((c) => ({ ...c, distanceSales: e.target.checked }))} />
              <span>
                {t.rich("acceptDistanceSales", {
                  link: (c) => <Link href="/legal/distance-sales" target="_blank">{c}</Link>,
                  policy: (c) => <Link href="/legal/cancellation" target="_blank">{c}</Link>,
                })}
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={consents.marketing}
                onChange={(e) => setConsents((c) => ({ ...c, marketing: e.target.checked }))} />
              <span>{t("acceptMarketing")}</span>
            </label>
            <div className="confirm-total">
              <span>{t("total")}</span>
              <span className="price">{fmt(finalQuote.total, finalQuote.currency)}</span>
            </div>
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => setStep("details")}>{t("back")}</button>
              <button className="btn primary big" type="button" onClick={createBooking}
                disabled={busy || !consents.disclosure || !consents.distanceSales}>
                <Icon name="lock" size={18} /> {busy ? t("creating") : t("payNow")}
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="wizard-summary">
        <div className="card elevated stack">
          <div className="row spread">
            <h3>{t("summary")}</h3>
            <button className="btn link" type="button" onClick={() => setEditing(true)}>{t("editTrip")}</button>
          </div>
          <div className="route-summary">
            <div><Icon name={trip.from?.region.type === "havalimani" ? "plane" : "pin"} /> <span>{trip.from?.label}</span></div>
            <div className="route-line" />
            <div><Icon name={trip.to?.region.type === "havalimani" ? "plane" : "pin"} /> <span>{trip.to?.label}</span></div>
          </div>
          <dl className="summary">
            <dt><Icon name="calendar" size={16} /> {t("when")}</dt>
            <dd>
              {details.instant ? t("instant") : dateTime(localInputToIso(trip.at), locale)}
              {trip.roundTrip && <><br />{tTrip("roundTrip")}: {dateTime(localInputToIso(trip.returnAt), locale)}</>}
            </dd>
            <dt><Icon name="users" size={16} /> {t("people")}</dt>
            <dd>{trip.pax} · {trip.lug}</dd>
            {selectedType && (
              <>
                <dt><Icon name={vehicleIcon(selectedType.code)} size={16} /> {t("vehicle")}</dt>
                <dd>{selectedType.name}</dd>
              </>
            )}
          </dl>
          {shownQuote && (
            <div className="price-box">
              <div className="row spread"><span>{t("price")}</span><span>{fmt(shownQuote.price, shownQuote.currency)}</span></div>
              {Number(shownQuote.guarantee_fee) > 0 && (
                <div className="row spread"><span>{t("guaranteeFee")}</span><span>{fmt(shownQuote.guarantee_fee, shownQuote.currency)}</span></div>
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
