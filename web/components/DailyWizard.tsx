"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, CREATE_TIMEOUT_MS, api, isAbort } from "@/lib/api";
import { dateTime, inputFromNow, localInputToIso, money } from "@/lib/format";
import { useApiError, useSession } from "@/lib/hooks";
import { MARKETING_CONSENT_VERSION, defaultCountry } from "@/lib/site";
import { toPlace } from "@/lib/trip";
import type { Booking, DailyPackage, DailyQuote, Endpoint, Region, VehicleType } from "@/lib/types";
import { vehicleName } from "@/lib/vehicleNames";
import { vehicleImage } from "@/lib/vehicles";
import AddressField from "./AddressField";
import CountrySelect from "./CountrySelect";
import { ErrorState } from "./ErrorState";
import Icon, { vehicleIcon } from "./Icon";
import OtpLogin from "./OtpLogin";
import RouteMap, { type MapPoint } from "./RouteMap";

type Step = "plan" | "vehicle" | "details" | "verify" | "confirm";
const MAX_DAYS = 14;

/** Kullanıcıya olduğu gibi gösterilecek, zaten çevrilmiş mesaj. */
class Shown extends Error {}

interface Plan {
  start: Endpoint | null;
  at: string;
  days: number;
  pkg: DailyPackage;
  pax: number;
  lug: number;
}

/**
 * K-29 şoförlü günlük kiralama sihirbazı: plan (başlangıç, saat, gün, paket) → araç → bilgiler → doğrulama → onay.
 * Fiyat backend'den gelir (gün fiyatı × gün); istemci hesaplamaz. Oluşan rezervasyon transferle aynı ödeme sayfasına gider.
 */
export default function DailyWizard(props: { regions: Region[]; vehicleTypes: VehicleType[] }) {
  const t = useTranslations("daily");
  const tb = useTranslations("book");
  const tErr = useTranslations("errors");
  const tBk = useTranslations("bookings");
  const tTrip = useTranslations("trip");
  const tm = useTranslations("meet");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const { loggedIn, setLoggedIn, error: sessionError, check: checkSession, recheck } = useSession();

  const [plan, setPlan] = useState<Plan>({ start: null, at: inputFromNow(48).slice(0, 11) + "09:00", days: 2, pkg: "tam", pax: 2, lug: 2 });
  const [step, setStep] = useState<Step>("plan");
  const [startMissing, setStartMissing] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, DailyQuote | ApiError | undefined>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [country, setCountry] = useState(defaultCountry[locale] ?? "GB");
  const [note, setNote] = useState("");
  const [childSeats, setChildSeats] = useState(0);
  const [finalQuote, setFinalQuote] = useState<DailyQuote | null>(null);
  const [consents, setConsents] = useState({ disclosure: false, distanceSales: false, marketing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createUncertain, setCreateUncertain] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Adım değişince odak yeni adımın başlığına taşınır (ilk açılışta sayfa başlığında kalır).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setPlan((p) => ({ ...p, [k]: v }));
  const fmt = (amount: string, currency: string) => money(amount, currency, locale);
  const pkgLabel = (p: DailyPackage) => (p === "tam" ? t("full") : t("half"));
  const request = (vt: string) => ({
    pickup: toPlace(plan.start!),
    vehicle_type_code: vt,
    start_at: localInputToIso(plan.at),
    days: plan.days,
    package: plan.pkg,
    passenger_count: plan.pax,
    luggage_count: plan.lug,
    country_code: country,
  });
  const mapFrom = useMemo<MapPoint | null>(() => {
    const e = plan.start;
    if (!e) return null;
    if (e.point) return { lat: e.point.lat, lng: e.point.lng, label: e.label };
    const lat = Number(e.region.latitude);
    const lng = Number(e.region.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, label: e.label } : null;
  }, [plan.start]);

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

  async function loadQuotes(e: React.FormEvent) {
    e.preventDefault();
    if (!plan.start) {
      setStartMissing(true);
      document.getElementById("daily-start")?.focus();
      return;
    }
    setError(null);
    setStep("vehicle");
    setLoadingQuotes(true);
    setQuotes({});
    setFinalQuote(null);
    const rows = await Promise.all(
      props.vehicleTypes.map((vt) =>
        api<DailyQuote>("daily-quotes", { body: request(vt.code) }).then(
          (q) => [vt.code, q] as const,
          (err) => [vt.code, err instanceof ApiError ? err : new ApiError(0, "network", "")] as const,
        ),
      ),
    );
    setQuotes(Object.fromEntries(rows));
    setLoadingQuotes(false);
  }

  async function confirmQuote() {
    setFinalQuote(await api<DailyQuote>("daily-quotes", { body: request(vehicle!) }));
    setStep("confirm");
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setNameError(tb("nameRequired"));
      document.getElementById("daily-name")?.focus();
      return;
    }
    setNameError(null);
    if (loggedIn === true) void run(confirmQuote);
    else if (loggedIn === false) setStep("verify");
    else void run(async () => {
      if (await checkSession()) await confirmQuote();
      else setStep("verify");
    });
  }

  function createBooking() {
    return run(async () => {
      const body = {
        ...request(vehicle!),
        expected_total: finalQuote!.total,
        passenger_name: name.trim(),
        note: note.trim() || null,
        child_seat_count: Math.min(childSeats, plan.pax),
        locale,
        accept_disclosure: consents.disclosure,
        accept_distance_sales: consents.distanceSales,
      };
      try {
        const booking = await api<Booking>("me/daily-bookings", { body, timeoutMs: CREATE_TIMEOUT_MS });
        if (consents.marketing) {
          await api("me/consents", {
            body: { consent_type: "pazarlama", accepted: true, version: MARKETING_CONSENT_VERSION },
          }).catch(() => undefined);
        }
        router.push(`/bookings/${booking.booking_code}/pay`);
      } catch (e) {
        if (e instanceof ApiError && e.code === "price_changed") {
          const q = await api<DailyQuote>("daily-quotes", { body: request(vehicle!) });
          setFinalQuote(q);
          throw new Shown(tb("priceChanged", { total: fmt(q.total, q.currency) }));
        }
        if (isAbort(e)) {
          setCreateUncertain(true);
          return;
        }
        if (e instanceof ApiError && e.status === 401) {
          setLoggedIn(false);
          setStep("verify");
          throw new Shown(tErr("unauthorized"));
        }
        throw e;
      }
    });
  }

  const steps: Step[] = loggedIn === true ? ["plan", "vehicle", "details", "confirm"] : ["plan", "vehicle", "details", "verify", "confirm"];
  const stepName = (s: Step) => (s === "plan" ? t("package") : tb(`steps.${s}`));
  const stepIndex = steps.indexOf(step);
  const selectedType = props.vehicleTypes.find((v) => v.code === vehicle);
  const selectedQuote = vehicle ? quotes[vehicle] : undefined;
  const shownQuote = finalQuote ?? (selectedQuote && !(selectedQuote instanceof ApiError) ? selectedQuote : null);
  const canPay = consents.disclosure && consents.distanceSales;
  const newTab = <span className="sr-only"> ({tBk("newTab")})</span>;
  const errorBox = error ? <p className="alert error" role="alert">{error}</p> : null;
  const head = (title: string, backTo?: Step) => (
    <div className="wizard-step-head">
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      {backTo && (
        <button className="btn link wizard-back" type="button" onClick={() => setStep(backTo)}>
          <Icon name="arrow" size={16} /> {tb("back")}
        </button>
      )}
    </div>
  );

  return (
    <div className="wizard daily-wizard">
      <div className="wizard-map">
        <RouteMap from={mapFrom} to={null} />
      </div>
      <div className="wizard-main">
        {sessionError ? (
          <div className="wizard-session-error">
            <ErrorState text={errorText(sessionError)} onRetry={recheck} />
          </div>
        ) : (
          <ol className="stepper-bar" aria-label={tb("progress")}>
            {steps.map((s, i) => (
              <li key={s} className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span className="name">{stepName(s)}</span>
                {i < stepIndex && <span className="sr-only"> ({tb("stepDone")})</span>}
              </li>
            ))}
          </ol>
        )}

        {step === "plan" && (
          <form className="card stack wizard-step" onSubmit={loadQuotes} noValidate>
            {head(t("package"))}
            {errorBox}
            <AddressField id="daily-start" label={t("start")} icon="pin" regions={props.regions} value={plan.start}
              error={startMissing && !plan.start ? t("start") : null}
              onChange={(v) => {
                set("start", v);
                setStartMissing(false);
              }} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="daily-at">{t("startAt")}</label>
                <input id="daily-at" type="datetime-local" required value={plan.at} min={inputFromNow(24)}
                  onChange={(e) => set("at", e.target.value)} aria-describedby="daily-lead" />
              </div>
              <div className="field">
                <label htmlFor="daily-days">{t("days")}</label>
                <select id="daily-days" value={plan.days} onChange={(e) => set("days", Number(e.target.value))}>
                  {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="daily-package-label">{t("package")}</span>
              <div className="segmented" role="radiogroup" aria-labelledby="daily-package-label">
                {(["tam", "yarim"] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={plan.pkg === p} className={plan.pkg === p ? "on" : ""}
                    onClick={() => set("pkg", p)}>
                    {pkgLabel(p)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="daily-pax">{tTrip("passengers")}</label>
                <input id="daily-pax" type="number" min={1} max={50} value={plan.pax} onChange={(e) => set("pax", Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="field">
                <label htmlFor="daily-lug">{tTrip("luggage")}</label>
                <input id="daily-lug" type="number" min={0} max={50} value={plan.lug} onChange={(e) => set("lug", Math.max(0, Number(e.target.value) || 0))} />
              </div>
            </div>
            <p className="hint" id="daily-lead"><Icon name="clock" size={16} /> {t("leadTime")}</p>
            <div className="wizard-actions">
              <button className="btn primary big" type="submit">{t("showPrices")}</button>
            </div>
          </form>
        )}

        {step === "vehicle" && (
          <section className="stack wizard-step">
            {head(t("chooseVehicle"), "plan")}
            {errorBox}
            <p className={loadingQuotes ? "muted" : "sr-only"} role="status">
              {loadingQuotes ? tb("loading") : Object.keys(quotes).length > 0 ? tb("pricesReady") : ""}
            </p>
            <div className="vehicle-list">
              {props.vehicleTypes.map((vt) => {
                const q = quotes[vt.code];
                const ok = q && !(q instanceof ApiError);
                const img = vehicleImage(vt.code);
                return (
                  <button type="button" key={vt.code} className={`vehicle-card ${vehicle === vt.code ? "selected" : ""}`}
                    disabled={!ok} aria-busy={!q && loadingQuotes}
                    onClick={() => {
                      setVehicle(vt.code);
                      setFinalQuote(null);
                      setError(null);
                      setStep("details");
                    }}>
                    <span className="vehicle-media">
                      {img ? <Image src={img} alt="" width={300} height={188} sizes="(max-width: 720px) 110px, 150px" /> : <Icon name={vehicleIcon(vt.code)} size={40} />}
                    </span>
                    <span className="vehicle-info">
                      <strong>{vehicleName(vt, locale)}</strong>
                      <span className="specs">
                        <span><Icon name="users" size={16} /> <span aria-hidden="true">{vt.capacity}</span><span className="sr-only">{tb("seats", { count: vt.capacity })}</span></span>
                        <span><Icon name="bag" size={16} /> <span aria-hidden="true">{vt.luggage_capacity}</span><span className="sr-only">{tb("bags", { count: vt.luggage_capacity })}</span></span>
                      </span>
                      {ok && (
                        <span className="hint">
                          {t("perDay", { price: fmt(q.day_price, q.currency) })} · {t("limits", { hours: q.hours_per_day, km: q.km_per_day })}
                        </span>
                      )}
                      {q instanceof ApiError && <span className="hint">{errorText(q)}</span>}
                    </span>
                    <span className="vehicle-price">
                      {ok ? (
                        <>
                          <span className="price">{fmt(q.total, q.currency)}</span>
                          <span className="hint">{t("total", { days: plan.days })}</span>
                        </>
                      ) : !q && loadingQuotes ? (
                        <span className="skeleton" aria-hidden="true" />
                      ) : (
                        <span className="hint">{tb("unavailable")}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === "details" && (
          <form className="card stack wizard-step" onSubmit={submitDetails} noValidate>
            {head(tb("steps.details"), "vehicle")}
            {errorBox}
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="daily-name">{tb("passengerName")}</label>
                <input id="daily-name" required minLength={2} maxLength={120} autoComplete="name" value={name}
                  aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "daily-name-error daily-name-hint" : "daily-name-hint"}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(null);
                  }} />
                {nameError && <span className="field-error" id="daily-name-error">{nameError}</span>}
                <span className="hint" id="daily-name-hint">{tb("passengerNameHint")}</span>
              </div>
              <CountrySelect id="daily-country" label={tb("country")} hint={tb("countryHint")} value={country} onChange={setCountry} />
            </div>
            <div className="field">
              <label htmlFor="daily-note">{t("plan")}</label>
              <textarea id="daily-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="daily-note-hint" />
              <span className="hint" id="daily-note-hint">{t("planHint")}</span>
            </div>
            <div className="field">
              <label htmlFor="daily-child">{tm("childSeatLabel")}</label>
              <input id="daily-child" type="number" min={0} max={Math.min(4, plan.pax)} value={childSeats}
                onChange={(e) => setChildSeats(Math.max(0, Math.min(Number(e.target.value) || 0, 4, plan.pax)))} />
            </div>
            <div className="wizard-actions">
              <button className="btn primary big" type="submit" disabled={busy}>{tb("continue")}</button>
            </div>
          </form>
        )}

        {step === "verify" && (
          <div className="card stack wizard-step">
            {head(tb("verifyTitle"), "details")}
            <p className="muted">{tb("verifyText")}</p>
            {errorBox}
            <OtpLogin country={country} onDone={() => {
              setLoggedIn(true);
              void run(confirmQuote);
            }} />
          </div>
        )}

        {step === "confirm" && finalQuote && (
          <div className="card stack wizard-step">
            {head(tb("steps.confirm"), "details")}
            <p className="cancel-tiers"><Icon name="refund" size={18} /><span>{tb("cancelTiers")}</span></p>
            <p className="hint">{t("extras", { hour: fmt(finalQuote.extra_hour_price, finalQuote.currency), km: fmt(finalQuote.extra_km_price, finalQuote.currency) })}</p>
            <fieldset className="consents">
              <legend className="sr-only">{tb("consentsLegend")}</legend>
              <label className="check">
                <input type="checkbox" aria-required="true" checked={consents.disclosure}
                  onChange={(e) => setConsents((c) => ({ ...c, disclosure: e.target.checked }))} />
                <span>{tb.rich("acceptDisclosure", { link: (c) => <Link href="/legal/privacy" target="_blank">{c}{newTab}</Link> })}</span>
              </label>
              <label className="check">
                <input type="checkbox" aria-required="true" checked={consents.distanceSales}
                  onChange={(e) => setConsents((c) => ({ ...c, distanceSales: e.target.checked }))} />
                <span>
                  {tb.rich("acceptDistanceSales", {
                    link: (c) => <Link href="/legal/distance-sales" target="_blank">{c}{newTab}</Link>,
                    policy: (c) => <Link href="/legal/cancellation" target="_blank">{c}{newTab}</Link>,
                  })}
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={consents.marketing} onChange={(e) => setConsents((c) => ({ ...c, marketing: e.target.checked }))} />
                <span>{tb("acceptMarketing")}</span>
              </label>
            </fieldset>
            <div className="confirm-total">
              <span>{tb("total")}</span>
              <span className="price">{fmt(finalQuote.total, finalQuote.currency)}</span>
            </div>
            {errorBox}
            {createUncertain && (
              <p className="alert error create-uncertain" role="alert">{tb("createUncertain")} <Link href="/bookings">{tBk("title")}</Link></p>
            )}
            <div className="wizard-actions">
              <button className="btn primary big" type="button" onClick={createBooking} disabled={busy || !canPay || createUncertain}
                aria-describedby={canPay ? undefined : "daily-pay-hint"}>
                <Icon name="lock" size={18} /> {busy ? tb("creating") : tb("payNow")}
              </button>
              {!canPay && <p className="hint" id="daily-pay-hint">{tb("payHint")}</p>}
            </div>
          </div>
        )}
      </div>

      <aside className="wizard-summary" aria-labelledby="daily-summary-title">
        <div className="card elevated stack">
          <h3 id="daily-summary-title">{tb("summary")}</h3>
          <dl className="summary">
            <dt><Icon name="pin" size={16} /> {t("start")}</dt>
            <dd>{plan.start?.label ?? "—"}</dd>
            <dt><Icon name="calendar" size={16} /> {tb("when")}</dt>
            <dd>{dateTime(localInputToIso(plan.at), locale)}<br />{t("summary", { days: plan.days, package: pkgLabel(plan.pkg) })}</dd>
            <dt><Icon name="users" size={16} /> {tb("people")}</dt>
            <dd>{tb("seats", { count: plan.pax })} · {tb("bags", { count: plan.lug })}</dd>
            {selectedType && (
              <>
                <dt><Icon name={vehicleIcon(selectedType.code)} size={16} /> {tb("vehicle")}</dt>
                <dd>{vehicleName(selectedType, locale)}</dd>
              </>
            )}
          </dl>
          {shownQuote && (
            <div className="price-box">
              <div className="row spread"><span>{t("perDay", { price: fmt(shownQuote.day_price, shownQuote.currency) })}</span><span className="amount">× {shownQuote.days}</span></div>
              <div className="row spread"><span>{t("limits", { hours: shownQuote.hours_per_day, km: shownQuote.km_per_day })}</span></div>
              <div className="row spread total-row"><span>{tb("total")}</span><span className="price">{fmt(shownQuote.total, shownQuote.currency)}</span></div>
            </div>
          )}
          <ul className="trust-list">
            <li><Icon name="shield" size={16} /> {tb("fixedPrice")}</li>
            <li><Icon name="refund" size={16} /> {tb("freeCancel")}</li>
            <li><Icon name="lock" size={16} /> {tb("secure")}</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
