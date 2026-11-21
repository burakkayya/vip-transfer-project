"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import type { Booking, BookingLeg, RefundQuote } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { useSessionExpired } from "./RequireLogin";

/** Ödenmiş günlük kiralamada gün iptal edilebilir: rezervasyon etkin, gün başlamamış ve başka açık gün var. */
const DAY_BOOKING = new Set(["onaylandi", "atandi", "yolculukta"]);
const DAY_OPEN = new Set(["beklemede", "atandi"]);

export function canCancelDay(booking: Booking, leg: BookingLeg): boolean {
  if (!booking.daily || !DAY_BOOKING.has(booking.status) || !DAY_OPEN.has(leg.status)) return false;
  return booking.legs.some((x) => x.id !== leg.id && x.status !== "iptal");
}

/** K-79: günlük kiralamada tek günün iptali. Önce iade önizlemesi (o günün başlangıcına göre), sonra onay. */
export function DayCancel(props: {
  code: string;
  booking: Booking;
  leg: BookingLeg;
  /** Aynı anda tek gün paneli açık kalır: başka gün açılınca bu panel kapanır. */
  openId: string | null;
  onOpen: (legId: string | null) => void;
  onDone: (b: Booking, notice: string) => void;
}) {
  const t = useTranslations("daily");
  const tb = useTranslations("bookings");
  const tbook = useTranslations("book");
  const tf = useTranslations("footer");
  const locale = useLocale();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"head" | "open" | "error" | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const n = props.leg.leg_order;
  const base = `me/bookings/${props.code}/days/${props.leg.id}`;
  const titleId = `day-cancel-${props.leg.id}`;

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    const el = target === "head" ? headRef.current : target === "error" ? errorRef.current : openRef.current;
    if (!el) return;
    focusNext.current = null;
    el.focus();
  });

  useEffect(() => {
    if (props.openId !== props.leg.id && quote) setQuote(null);
  }, [props.openId, props.leg.id, quote]);

  async function open() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setQuote(await api<RefundQuote>(`${base}/cancellation`));
      props.onOpen(props.leg.id);
      focusNext.current = "head";
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (busyRef.current || !quote) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const b = await api<Booking>(`${base}/cancel`, { body: {} });
      // Kesin iade tutarı backend'de belirlenir (önceki elle iadeler, kademe sınırı); mesajda tutar verilmez.
      props.onDone(b, t("dayCancelled", { n }));
    } catch (e) {
      if (isUnauthorized(e)) {
        sessionExpired();
        return;
      }
      setError(errorText(e));
      focusNext.current = "error";
      if (e instanceof ApiError && (e.code === "day_not_cancellable" || e.code === "not_cancellable")) setQuote(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!quote) {
    return (
      <div className="day-cancel">
        {error && <p className="alert error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <button
          ref={openRef}
          className="btn outline small"
          type="button"
          aria-disabled={loading || undefined}
          onClick={() => void open()}
        >
          {loading ? tb("cancelLoading") : t("cancelDay")}
        </button>
      </div>
    );
  }

  return (
    <div className="day-cancel cancel-panel stack" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} tabIndex={-1} ref={headRef}>{t("cancelDayTitle", { n })}</h3>
      <p className="cancel-text">{t("cancelDayText")}</p>
      <div className="cancel-summary">
        <span className="cancel-refund-label">{tb("refundAmount")}</span>
        <p className="price cancel-refund">{money(quote.refund_amount, props.booking.currency, locale)}</p>
      </div>
      <p className="cancel-text">
        {tb("cancelPreview", { percent: quote.refund_percent })}
        {quote.guarantee_applied && <> {tb("cancelGuarantee")}</>}
      </p>
      <p className="cancel-policy">
        {tbook("cancelTiers")} <Link href="/legal/cancellation">{tf("cancellation")}</Link>
      </p>
      {error && <p className="alert error cancel-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      <div className="cancel-actions">
        <button className="btn danger" type="button" aria-disabled={busy || undefined} onClick={() => void confirm()}
          aria-label={t("cancelDayTitle", { n })}>
          {busy ? tb("cancelling") : t("cancelDayConfirm")}
        </button>
        <button
          className="btn outline"
          type="button"
          onClick={() => {
            setQuote(null);
            setError(null);
            props.onOpen(null);
            focusNext.current = "open";
          }}
        >
          {tb("keep")}
        </button>
      </div>
    </div>
  );
}
