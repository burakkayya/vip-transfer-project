"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import { regionLabel } from "@/lib/regions";
import type { Booking, Checkout } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import { ErrorState } from "./ErrorState";
import Icon from "./Icon";
import { EmptyState, LoadingState } from "./States";

export const PENDING_KEY = "ga_pending_booking";
const PAID = new Set(["onaylandi", "atandi", "yolculukta", "tamamlandi"]);

/** Yeniden denemenin anlamsız olduğu hatalar: rezervasyon yok veya bu müşterinin değil. */
const isFinal = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);

/**
 * Ekran 6: ödeme. Kart bilgisi sağlayıcının iFrame'inde girilir (K-17).
 * Sonuç, sağlayıcının sunucumuza bildirimiyle kesinleşir; bu ekran rezervasyon durumunu yoklar.
 * Tutar API'nin döndürdüğü haliyle yalnızca biçimlenerek gösterilir.
 */
export default function PaymentPanel(props: { code: string; result?: "ok" | "fail" }) {
  const t = useTranslations("pay");
  const tb = useTranslations("bookings");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; final: boolean } | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [failed, setFailed] = useState(props.result === "fail");
  const started = useRef(false);

  const start = useCallback(async () => {
    setCheckoutError(null);
    setFailed(false);
    setCheckout(null);
    try {
      const c = await api<Checkout>(`me/bookings/${props.code}/payments`, { body: {} });
      sessionStorage.setItem(PENDING_KEY, props.code);
      setCheckout(c);
    } catch (e) {
      setCheckoutError(errorText(e));
    }
  }, [props.code, errorText]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const b = await api<Booking>(`me/bookings/${props.code}`);
      setBooking(b);
      if (b.status === "odeme_bekliyor" && !props.result) void start();
    } catch (e) {
      setLoadError({ text: errorText(e), final: isFinal(e) });
    }
  }, [props.code, props.result, start, errorText]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  // Ödeme bildirimi gelene kadar durum yoklanır.
  useEffect(() => {
    if (!booking || booking.status !== "odeme_bekliyor") return;
    const id = setInterval(async () => {
      const b = await api<Booking>(`me/bookings/${props.code}`).catch(() => null);
      if (b && b.status !== booking.status) setBooking(b);
    }, 3000);
    return () => clearInterval(id);
  }, [booking, props.code]);

  useEffect(() => {
    if (booking && PAID.has(booking.status)) {
      sessionStorage.removeItem(PENDING_KEY);
      router.replace(`/bookings/${props.code}?paid=1`);
    }
  }, [booking, props.code, router]);

  if (loadError) {
    return (
      <div className="pay stack">
        <ErrorState text={loadError.text} onRetry={loadError.final ? undefined : () => void load()} />
        {loadError.final && (
          <Link className="btn secondary pay-link" href="/bookings">
            {tb("title")}
          </Link>
        )}
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="pay">
        <LoadingState label={t("loading")} />
      </div>
    );
  }
  if (PAID.has(booking.status)) {
    return (
      <div className="pay">
        <p className="alert ok" role="status">
          {t("success")}
        </p>
      </div>
    );
  }
  if (booking.status !== "odeme_bekliyor") {
    const view = (
      <Link className="btn secondary" href={`/bookings/${props.code}`}>
        {t("viewBooking")}
      </Link>
    );
    return (
      <div className="pay">
        {booking.status === "iptal" ? (
          <EmptyState
            title={t("cancelledTitle")}
            text={t("cancelledText")}
            action={
              <div className="pay-actions">
                <Link className="btn" href="/book">
                  {tb("newBooking")}
                </Link>
                {view}
              </div>
            }
          />
        ) : (
          <EmptyState title={t("notNeeded")} action={view} />
        )}
      </div>
    );
  }

  const roundTrip = booking.legs.length > 1;
  return (
    <div className="pay stack">
      <section className="card pay-summary" aria-label={t("summary")}>
        <div className="pay-total">
          <span className="pay-total-label">{t("amount")}</span>
          <p className="price pay-amount">{money(booking.total_amount, booking.currency, locale)}</p>
        </div>
        <dl className="pay-facts">
          <div>
            <dt>{tb("code")}</dt>
            <dd className="pay-code">{booking.booking_code}</dd>
          </div>
          {booking.legs.map((leg) => (
            <div key={leg.id}>
              <dt>{roundTrip ? t(leg.leg_order === 1 ? "outbound" : "inbound") : t("route")}</dt>
              <dd>
                <span className="pay-route">
                  {regionLabel(leg.pickup_region)} → {regionLabel(leg.dropoff_region)}
                </span>
                <span className="pay-when">{dateTime(leg.pickup_at, locale)}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="pay-notes">
          <p className="pay-note">
            <Icon name="lock" size={16} />
            <span>{t("text")}</span>
          </p>
          <p className="pay-note pay-expiry">
            <Icon name="clock" size={16} />
            <span>{t("expiresHint")}</span>
          </p>
        </div>
      </section>

      {failed ? (
        <div className="pay-failed stack">
          <p className="alert error" role="alert">
            {t("failed")}
          </p>
          <div className="pay-actions">
            <button className="btn pay-retry" type="button" onClick={() => void start()}>
              {t("retry")}
            </button>
          </div>
        </div>
      ) : checkoutError ? (
        <ErrorState text={checkoutError} onRetry={() => void start()} />
      ) : checkout ? (
        <>
          <p className="pay-waiting" role="status">
            {t("waiting")}
          </p>
          <div className="iframe-wrap">
            <iframe src={checkout.iframe_url} title={t("frameTitle")} allow="payment" />
          </div>
        </>
      ) : (
        <LoadingState label={t("preparing")} />
      )}
    </div>
  );
}
