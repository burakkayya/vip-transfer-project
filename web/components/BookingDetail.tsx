"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import { company } from "@/lib/site";
import type { Booking, BookingStatus, DriverLocation, RefundQuote } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { regionLabel } from "@/lib/regions";
import Icon from "./Icon";

const TRACKABLE = new Set(["yolda", "vardi", "basladi"]);
const LEG_FLOW = ["beklemede", "atandi", "yolda", "vardi", "basladi", "bitti"];
const CANCELLABLE = new Set<BookingStatus>(["odeme_bekliyor", "onaylandi", "atandi"]);

export function statusClass(s: BookingStatus) {
  if (s === "iptal" || s === "odeme_basarisiz") return "danger";
  if (s === "odeme_bekliyor") return "warn";
  return "ok";
}

/** Ekran 7 ve 9: rezervasyon özeti, detay ve iptal. */
export default function BookingDetail(props: { code: string; justPaid?: boolean }) {
  const t = useTranslations("bookings");
  const locale = useLocale();
  const errorText = useApiError();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refund, setRefund] = useState<RefundQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [location, setLocation] = useState<DriverLocation | null>(null);

  useEffect(() => {
    api<Booking>(`me/bookings/${props.code}`)
      .then(setBooking)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? t("notFound") : errorText(e)));
  }, [props.code, t, errorText]);

  const tracking = booking?.legs.some((l) => TRACKABLE.has(l.status)) ?? false;

  // Web'de canlı konum kısa aralıklarla yoklanır; jeton tarayıcıya verilmediği için WebSocket kullanılmaz.
  useEffect(() => {
    if (!tracking) return;
    const poll = () =>
      api<DriverLocation | null>(`me/bookings/${props.code}/driver-location`)
        .then(setLocation)
        .catch(() => undefined);
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [tracking, props.code]);

  async function previewCancel() {
    setError(null);
    try {
      setRefund(await api<RefundQuote>(`me/bookings/${props.code}/cancellation`));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError(null);
    try {
      setBooking(await api<Booking>(`me/bookings/${props.code}/cancel`, { body: {} }));
      setRefund(null);
      setNotice(t("cancelled"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!booking) return error ? <p className="alert error">{error}</p> : null;
  const fmt = (a: string) => money(a, booking.currency, locale);

  return (
    <div className="stack">
      {props.justPaid && (
        <div className="alert ok">
          <strong>{t("confirmedTitle")}</strong>
          <br />
          {t("confirmedText")}
        </div>
      )}
      {notice && <p className="alert ok">{notice}</p>}
      {error && <p className="alert error">{error}</p>}

      <div className="card elevated booking-head">
        <div>
          <span className="label">{t("code")}</span>
          <h1 className="booking-code">{booking.booking_code}</h1>
          <span className="muted">
            {booking.vehicle_type.name} · {t("people", { passengers: booking.passenger_count, luggage: booking.luggage_count })}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`badge ${statusClass(booking.status)}`}>{t(`status.${booking.status}`)}</span>
          <div className="price" style={{ marginTop: 8 }}>{fmt(booking.total_amount)}</div>
        </div>
      </div>

      {booking.legs.map((leg) => {
        const idx = LEG_FLOW.indexOf(leg.status);
        return (
          <div key={leg.id} className="card stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>
                {booking.legs.length > 1 && `${leg.leg_order}. `}
                {regionLabel(leg.pickup_region)} → {regionLabel(leg.dropoff_region)}
              </h3>
              <span className="muted"><Icon name="calendar" size={16} /> {dateTime(leg.pickup_at, locale)}</span>
            </div>
            {leg.status !== "iptal" && (
              <ol className="timeline" aria-label={t(`legStatus.${leg.status}`)}>
                {LEG_FLOW.map((st, i) => (
                  <li key={st} className={`${i <= idx ? "done" : ""} ${i === idx ? "current" : ""}`}>{t(`legStatus.${st}`)}</li>
                ))}
              </ol>
            )}
            <dl className="summary">
              {(leg.pickup_address || leg.dropoff_address) && (
                <>
                  <dt><Icon name="pin" size={16} /></dt>
                  <dd>{[leg.pickup_address, leg.dropoff_address].filter(Boolean).join(" → ")}</dd>
                </>
              )}
              {leg.flight && (
                <>
                  <dt><Icon name="plane" size={16} /> {t("flight")}</dt>
                  <dd>{leg.flight.flight_no}</dd>
                </>
              )}
            </dl>
            {leg.driver ? (
              <div className="driver-card">
                <span className="avatar">{leg.driver.first_name.slice(0, 1)}</span>
                <div>
                  <strong>{leg.driver.first_name}</strong>
                  <div className="muted">{leg.driver.vehicle} · <strong>{leg.driver.plate}</strong></div>
                </div>
              </div>
            ) : (
              <p className="muted"><Icon name="clock" size={16} /> {t("driverPending")}</p>
            )}
            {TRACKABLE.has(leg.status) && (
              <div className="alert ok">
                <strong><span className="live-dot" /> {t("live")}</strong>
                <br />
                {location ? (
                  <>
                    {t("liveUpdated", { time: dateTime(location.at, locale) })} ·{" "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=16/${location.lat}/${location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("openMap")}
                    </a>
                  </>
                ) : (
                  t("liveNone")
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="card">
        <dl className="summary">
          <dt><Icon name="user" size={16} /> {t("passenger")}</dt>
          <dd>{booking.passenger_name}</dd>
          {booking.note && (
            <>
              <dt>✎</dt>
              <dd>{booking.note}</dd>
            </>
          )}
          <dt><Icon name="clock" size={16} /></dt>
          <dd>{dateTime(booking.created_at, locale)}</dd>
        </dl>
      </div>

      <div className="row">
        {booking.status === "odeme_bekliyor" && (
          <Link className="btn primary big" href={`/bookings/${booking.booking_code}/pay`}>
            <Icon name="card" size={18} /> {t("payNow")}
          </Link>
        )}
        {CANCELLABLE.has(booking.status) && !refund && (
          <button className="btn ghost" type="button" onClick={previewCancel}>
            {t("cancel")}
          </button>
        )}
      </div>

      {refund && (
        <div className="card stack">
          <h2>{t("cancelTitle")}</h2>
          {booking.status === "odeme_bekliyor" ? (
            <p>{t("cancelNoPay")}</p>
          ) : (
            <p>
              {t("cancelPreview", { percent: refund.refund_percent, amount: fmt(refund.refund_amount) })}
              {refund.guarantee_applied && <> {t("cancelGuarantee")}</>}
            </p>
          )}
          <div className="row">
            <button className="btn danger" type="button" disabled={busy} onClick={confirmCancel}>
              {t("cancelConfirm")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setRefund(null)}>
              {t("keep")}
            </button>
          </div>
        </div>
      )}

      {booking.status !== "iptal" && booking.status !== "tamamlandi" && (
        <p className="hint">{t("changeText", { email: company.email })}</p>
      )}
    </div>
  );
}
