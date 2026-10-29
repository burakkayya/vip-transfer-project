"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import type { Booking, Checkout } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";

export const PENDING_KEY = "ga_pending_booking";
const PAID = new Set(["onaylandi", "atandi", "yolculukta", "tamamlandi"]);

/**
 * Ekran 6: ödeme. Kart bilgisi sağlayıcının iFrame'inde girilir (K-17).
 * Sonuç, sağlayıcının sunucumuza bildirimiyle kesinleşir; bu ekran rezervasyon durumunu yoklar.
 */
export default function PaymentPanel(props: { code: string; result?: "ok" | "fail" }) {
  const t = useTranslations("pay");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [failed, setFailed] = useState(props.result === "fail");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    setFailed(false);
    try {
      const c = await api<Checkout>(`me/bookings/${props.code}/payments`, { body: {} });
      sessionStorage.setItem(PENDING_KEY, props.code);
      setCheckout(c);
    } catch (e) {
      setError(errorText(e));
    }
  }, [props.code, errorText]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<Booking>(`me/bookings/${props.code}`)
      .then((b) => {
        setBooking(b);
        if (b.status === "odeme_bekliyor" && !props.result) void start();
      })
      .catch((e) => setError(errorText(e)));
  }, [props.code, props.result, start, errorText]);

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

  if (error) {
    return (
      <div className="stack">
        <p className="alert error">{error}</p>
        <Link href={`/bookings/${props.code}`}>{props.code}</Link>
      </div>
    );
  }
  if (!booking) return null;
  if (booking.status !== "odeme_bekliyor") {
    return (
      <div className="stack">
        <p className="alert info">{t("notNeeded")}</p>
        <Link className="btn" href={`/bookings/${props.code}`}>
          {props.code}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card row spread">
        <div>
          <div className="muted">{t("amount")}</div>
          <div className="price">{money(booking.total_amount, booking.currency, locale)}</div>
        </div>
        <div className="hint" style={{ maxWidth: 420 }}>
          {t("text")}
          <br />
          {t("expiresHint")}
        </div>
      </div>
      {failed && <p className="alert error">{t("failed")}</p>}
      {checkout && !failed && (
        <div className="iframe-wrap">
          <iframe src={checkout.iframe_url} title={t("title")} allow="payment" />
        </div>
      )}
      <div className="row">
        {checkout && !failed && <span className="muted">{t("waiting")}</span>}
        <button className="btn secondary" type="button" onClick={start}>
          {t("retry")}
        </button>
      </div>
    </div>
  );
}
