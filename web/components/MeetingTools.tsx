"use client";

/**
 * Buluşma deneyimi (K-62): sürücü kartı (fotoğraf, diller, renk), yolcu durumu ("İndim / Bagajdayım /
 * Çıkıyorum"), havalimanı buluşma rehberi, girişsiz takip bağlantısı, puan ve bahşiş.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import type { Booking, BookingLeg, DriverBrief, MeetingGuide, Rating, ShareLink } from "@/lib/types";
import Icon from "./Icon";
import { useSessionExpired } from "./RequireLogin";

const LANG_NAMES: Record<string, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", ru: "Русский", fr: "Français", es: "Español", it: "Italiano",
  zh: "中文", ja: "日本語", ar: "العربية",
};
const PRE_PICKUP = new Set(["atandi", "yolda", "vardi"]);
const PASSENGER_STEPS = ["indi", "bagajda", "cikiyor"] as const;

/** Sürücü kartı. Fotoğraf yoksa baş harf gösterilir. `photoSrc` aynı kökenli vekil adresidir. */
export function DriverCard(props: { driver: DriverBrief; photoSrc: string | null }) {
  const t = useTranslations("meet");
  const tb = useTranslations("bookings");
  const [photoFailed, setPhotoFailed] = useState(false);
  const d = props.driver;
  const showPhoto = d.has_photo && props.photoSrc && !photoFailed;
  return (
    <div className="driver-card">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar avatar-photo" src={props.photoSrc!} alt="" onError={() => setPhotoFailed(true)} />
      ) : (
        <span className="avatar" aria-hidden="true">
          {d.first_name.slice(0, 1)}
        </span>
      )}
      <div className="driver-text">
        <span className="sr-only">{tb("driver")}: </span>
        <strong>{d.first_name}</strong>
        <div className="muted">
          {d.color ? `${d.color} ` : ""}
          {d.vehicle} · <strong className="tabular plate">{d.plate}</strong>
        </div>
        {d.languages.length > 0 && (
          <div className="muted driver-langs">
            <Icon name="globe" size={14} /> {t("speaks", { languages: d.languages.map((x) => LANG_NAMES[x] ?? x).join(", ") })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Yolcu durumu düğmeleri: tek dokunuşla sürücüye bildirilir. Yalnızca havalimanı alışında, alış gününde. */
export function PassengerStatus(props: { code: string; leg: BookingLeg; onChange: (status: string) => void }) {
  const t = useTranslations("meet");
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = props.leg.passenger_status;
  const currentIdx = current ? PASSENGER_STEPS.indexOf(current as (typeof PASSENGER_STEPS)[number]) : -1;

  async function send(status: string) {
    if (busy) return;
    setBusy(status);
    setError(null);
    try {
      const r = await api<{ passenger_status: string }>(`me/bookings/${props.code}/passenger-status`, { body: { status } });
      props.onChange(r.passenger_status);
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="passenger-status stack-sm">
      <p className="label">{t("statusTitle")}</p>
      <div className="status-steps" role="group" aria-label={t("statusTitle")}>
        {PASSENGER_STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`status-step${i <= currentIdx ? " done" : ""}`}
            aria-pressed={current === s}
            aria-disabled={busy !== null || undefined}
            onClick={() => void send(s)}
          >
            <Icon name={i <= currentIdx ? "check" : s === "indi" ? "plane" : s === "bagajda" ? "bag" : "arrow"} size={18} />
            <span>{busy === s ? t("statusSending") : t(`status.${s}`)}</span>
          </button>
        ))}
      </div>
      <p className="hint" role="status">
        {current ? t("statusSent") : t("statusHint")}
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Havalimanı buluşma rehberi: terminal sekmeleri, fotoğraflı adımlar. */
export function MeetingGuidePanel(props: { code: string; photoBase: string }) {
  const t = useTranslations("meet");
  const locale = useLocale();
  const [data, setData] = useState<MeetingGuide | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!open || data) return;
    api<MeetingGuide>(`me/bookings/${props.code}/meeting-guide?lang=${locale}`)
      .then(setData)
      .catch(() => setData({ airport: null, guides: [] }));
  }, [open, data, props.code, locale]);

  const guide = data?.guides[tab];
  return (
    <div className="meeting-guide">
      <button className="btn outline" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="route" size={18} /> {t("guideButton")}
      </button>
      {open && (
        <div className="card stack guide-card">
          <h3>{data?.airport ? t("guideTitle", { airport: data.airport }) : t("guideButton")}</h3>
          {!data && <p className="muted">{t("loading")}</p>}
          {data && data.guides.length === 0 && <p className="muted">{t("guideEmpty")}</p>}
          {data && data.guides.length > 1 && (
            <div className="guide-tabs" role="tablist">
              {data.guides.map((g, i) => (
                <button key={g.id} role="tab" type="button" aria-selected={i === tab} onClick={() => setTab(i)}>
                  {g.terminal || t("guideGeneral")}
                </button>
              ))}
            </div>
          )}
          {guide && (
            <ol className="guide-steps">
              {guide.steps.map((s, i) => (
                <li key={i}>
                  <span className="guide-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="stack-sm">
                    {s.photo_path && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="guide-photo" src={`${props.photoBase}${s.photo_path.replace(/^\/api\/v1\//, "")}`} alt="" loading="lazy" />
                    )}
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** Girişsiz takip bağlantısı: karşılayan yakına gönderilir, uygulama ve giriş gerektirmez. */
export function SharePanel(props: { code: string; active: boolean }) {
  const t = useTranslations("meet");
  const errorText = useApiError();
  const [link, setLink] = useState<string | null>(null);
  const [active, setActive] = useState(props.active);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const r = await api<ShareLink>(`me/bookings/${props.code}/share`, { body: {} });
      setLink(r.url);
      setActive(true);
      if (navigator.share) {
        await navigator.share({ title: t("shareTitle"), url: r.url }).catch(() => undefined);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function revoke() {
    setError(null);
    try {
      await api<void>(`me/bookings/${props.code}/share`, { method: "DELETE" });
      setLink(null);
      setActive(false);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="card stack-sm share-panel" aria-labelledby="share-title">
      <h2 id="share-title" className="small-title">
        <Icon name="users" size={18} /> {t("shareTitle")}
      </h2>
      <p className="muted">{t("shareText")}</p>
      {link ? (
        <div className="share-link">
          <input readOnly value={link} aria-label={t("shareTitle")} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn secondary small" type="button" onClick={() => void copy()}>
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      ) : null}
      <div className="row-actions">
        <button className="btn outline small" type="button" onClick={() => void create()}>
          {active ? t("shareShow") : t("shareCreate")}
        </button>
        {active && (
          <button className="btn link small" type="button" onClick={() => void revoke()}>
            {t("shareRevoke")}
          </button>
        )}
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Yolculuk sonrası puan ve isteğe bağlı bahşiş (tamamı sürücüye). Bahşiş ödeme sayfası çerçevede açılır. */
export function RatingPanel(props: { code: string; booking: Booking }) {
  const t = useTranslations("meet");
  const locale = useLocale();
  const errorText = useApiError();
  const [state, setState] = useState<Rating | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [tip, setTip] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<Rating>(`me/bookings/${props.code}/rating`).then(setState).catch(() => setState(null));
  }, [props.code]);

  if (!state || !state.leg_id) return null;
  const fmt = (a: string) => money(a, state.currency, locale);

  async function submit() {
    if (busy || (!state!.rated && stars === 0)) return;
    setBusy(true);
    setError(null);
    try {
      const r = state!.rated
        ? await api<Rating>(`me/bookings/${props.code}/tip`, { body: { amount: tip } })
        : await api<Rating>(`me/bookings/${props.code}/rating`, {
            body: { stars, comment: comment.trim() || null, tip_amount: tip || null },
          });
      setState(r);
      if (r.iframe_url) setFrame(r.iframe_url);
      headingRef.current?.focus();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const tipOpen = state.tip_status === null || state.tip_status === "yok" || state.tip_status === "basarisiz";
  if (state.rated && !tipOpen && !frame) {
    return (
      <section className="card stack-sm rating-panel" aria-labelledby="rate-title">
        <h2 id="rate-title" className="small-title" tabIndex={-1} ref={headingRef}>
          <Icon name="star" size={18} /> {t("ratedTitle", { stars: state.stars ?? 0 })}
        </h2>
        <p className="muted">
          {state.tip_status === "odendi" ? t("tipPaid", { amount: fmt(state.tip_amount ?? "0") }) : t("tipPending")}
        </p>
      </section>
    );
  }

  return (
    <section className="card stack rating-panel" aria-labelledby="rate-title">
      <h2 id="rate-title" className="small-title" tabIndex={-1} ref={headingRef}>
        <Icon name="star" size={18} /> {state.rated ? t("tipTitle") : t("rateTitle", { name: props.booking.legs.find((l) => l.id === state.leg_id)?.driver?.first_name ?? "" })}
      </h2>
      {!state.rated && (
        <>
          <div className="stars" role="radiogroup" aria-label={t("starsLabel")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={t("starN", { n })}
                className={n <= stars ? "on" : ""}
                onClick={() => setStars(n)}
              >
                ★
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="rate-comment">{t("comment")}</label>
            <textarea id="rate-comment" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </>
      )}
      <fieldset className="tip-options">
        <legend>{t("tipLegend")}</legend>
        <div className="row-actions">
          <button type="button" className={`chip${tip === "" ? " on" : ""}`} aria-pressed={tip === ""} onClick={() => setTip("")}>
            {t("noTip")}
          </button>
          {state.tip_suggestions.map((s) => (
            <button key={s} type="button" className={`chip${tip === s ? " on" : ""}`} aria-pressed={tip === s} onClick={() => setTip(s)}>
              {fmt(s)}
            </button>
          ))}
        </div>
        <p className="hint">{t("tipHint")}</p>
      </fieldset>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {frame ? (
        <iframe className="pay-frame tip-frame" src={frame} title={t("tipTitle")} />
      ) : (
        <button
          className="btn primary"
          type="button"
          aria-disabled={busy || (!state.rated && stars === 0) || (state.rated && !tip) || undefined}
          onClick={() => void submit()}
        >
          {busy ? t("sending") : state.rated ? t("tipPay") : tip ? t("rateAndTip") : t("rateSend")}
        </button>
      )}
    </section>
  );
}

export const showPassengerStatus = (leg: BookingLeg) =>
  leg.pickup_region.type === "havalimani" && PRE_PICKUP.has(leg.status) &&
  Date.now() >= new Date(leg.pickup_at).getTime() - 12 * 3600_000;
