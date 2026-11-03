"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { PAID, PENDING_KEY, RESUME_KEY, isFinal, isUnauthorized, session } from "@/lib/booking";
import { dateTime, money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import { usePoll } from "@/lib/poll";
import { regionLabel } from "@/lib/regions";
import type { Booking, Checkout } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import BookingNotFound from "./BookingNotFound";
import { ErrorState } from "./ErrorState";
import Icon from "./Icon";
import { useSessionExpired } from "./RequireLogin";
import { EmptyState, LoadingState } from "./States";

/** Durum yoklama aralığı. */
const POLL_MS = 3000;
/** Asılı yoklama isteği bir sonrakinden önce iptal edilir ve başarısız sayılır. */
const POLL_TIMEOUT_MS = POLL_MS - 500;
/** Art arda bu kadar yoklama hatasından (iptal dahil) sonra otomatik güncelleme durur ve müşteriye söylenir. */
const MAX_POLL_FAILURES = 3;
/** Sağlayıcıdan "ok" ile dönüldükten sonra onayın beklendiği süre; dolunca müşteriye seçenek sunulur (yoklama sürer). */
const CONFIRM_WAIT_MS = 75_000;

/**
 * Ekran 6: ödeme. Kart bilgisi sağlayıcının iFrame'inde girilir (K-17).
 * Sonuç, sağlayıcının sunucumuza bildirimiyle kesinleşir; bu ekran rezervasyon durumunu yoklar.
 * Tutar API'nin döndürdüğü haliyle yalnızca biçimlenerek gösterilir.
 * Ödeme sayfası açıkken oturum düşerse (yoklama 401) iFrame kaldırılmaz: yoklama durur, engellemeyen bir not girişi
 * müşterinin eylemine bırakır. Yeniden girişte yeni ödeme açılmaz, aynı rezervasyon yoklanır (K-45).
 */
export default function PaymentPanel(props: { code: string; result?: "ok" | "fail" }) {
  const t = useTranslations("pay");
  const tb = useTranslations("bookings");
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [result, setResult] = useState(props.result);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; final: boolean } | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [failed, setFailed] = useState(props.result === "fail");
  const [pollPaused, setPollPaused] = useState(false);
  const [confirmSlow, setConfirmSlow] = useState(false);
  const [confirmRound, setConfirmRound] = useState(0);
  /** Ödeme sayfası açıkken oturum düştü: yoklama durdu, not gösteriliyor, iFrame yerinde. */
  const [sessionLost, setSessionLost] = useState(false);
  /** Yeniden girişten sonra: önceki ödeme sayfasının sonucu bekleniyor, otomatik yeni ödeme açılmadı. */
  const [resumed, setResumed] = useState(false);
  const started = useRef(false);
  const starting = useRef(false);
  const pollFailures = useRef(0);
  const checkoutOpen = useRef(false);
  useEffect(() => {
    checkoutOpen.current = checkout !== null;
  }, [checkout]);

  /** Sağlayıcı dönüşündeki `result` adresten kalkar: yenilemede eski sonuç tekrar gösterilmez. */
  const clearResult = useCallback(() => {
    setResult(undefined);
    const url = new URL(window.location.href);
    if (url.searchParams.has("result")) {
      url.searchParams.delete("result");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  // Aynı anda tek ödeme başlatma isteği: çift tıklama veya hızlı yeniden deneme ikinci ödeme açmaz.
  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setCheckoutError(null);
    setFailed(false);
    setCheckout(null);
    setResumed(false);
    try {
      const c = await api<Checkout>(`me/bookings/${props.code}/payments`, { body: {} });
      // Depolama engelliyse yalnızca sağlayıcı dönüşündeki kısayol kaybolur; ödeme sayfası yine açılır.
      session.set(PENDING_KEY, props.code);
      setCheckout(c);
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setCheckoutError(errorText(e));
    } finally {
      starting.current = false;
    }
  }, [props.code, errorText, sessionExpired]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const b = await api<Booking>(`me/bookings/${props.code}`);
      setBooking(b);
      // Ödeme sayfası açıkken oturum düşmüştü: yeni ödeme açılmaz, aynı rezervasyon yoklanır (K-45).
      const resume = session.get(RESUME_KEY) === props.code;
      session.remove(RESUME_KEY);
      if (b.status !== "odeme_bekliyor" || props.result) return;
      if (resume) setResumed(true);
      else void start();
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setLoadError({ text: errorText(e), final: isFinal(e) });
    }
  }, [props.code, props.result, start, errorText, sessionExpired]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  // Ödeme bildirimi gelene kadar durum yoklanır (ortak yoklama: üst üste binmez, asılı istek iptal edilip başarısız
  // sayılır). Art arda hatada durur. Oturum düşerse: ödeme sayfası açıksa engellemeyen not, değilse giriş.
  const poll = usePoll(
    async ({ signal, current }) => {
      try {
        const b = await api<Booking>(`me/bookings/${props.code}`, { signal });
        if (!current()) return;
        pollFailures.current = 0;
        setPollPaused(false);
        setBooking((prev) => (prev && prev.status === b.status ? prev : b));
      } catch (e) {
        if (!current()) return;
        if (isUnauthorized(e)) {
          if (checkoutOpen.current) {
            session.set(RESUME_KEY, props.code);
            setSessionLost(true);
          } else sessionExpired();
          return;
        }
        pollFailures.current += 1;
        if (pollFailures.current >= MAX_POLL_FAILURES) setPollPaused(true);
      }
    },
    {
      enabled: booking?.status === "odeme_bekliyor" && !pollPaused && !sessionLost,
      intervalMs: POLL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
    },
  );

  /** Durumu hemen yeniden okur; başarılıysa duran otomatik güncelleme yeniden başlar. */
  const refresh = useCallback(() => void poll(), [poll]);

  /** Giriş müşterinin eylemiyle açılır (ör. ödemeyi bitirdikten sonra); iFrame ancak o zaman kalkar. */
  function loginAgain() {
    session.set(RESUME_KEY, props.code);
    sessionExpired();
  }

  useEffect(() => {
    if (booking && PAID.has(booking.status)) {
      session.remove(PENDING_KEY);
      router.replace(`/bookings/${props.code}?paid=1`);
    }
  }, [booking, props.code, router]);

  // Sağlayıcıdan "ok" ile dönüldü, bildirim henüz işlenmedi: onay beklenir, süre dolunca seçenek sunulur.
  const confirming =
    result === "ok" && booking?.status === "odeme_bekliyor" && !checkout && !checkoutError && !failed;
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirmSlow(true), CONFIRM_WAIT_MS);
    return () => clearTimeout(id);
  }, [confirming, confirmRound]);

  function refreshConfirmation() {
    setConfirmSlow(false);
    setConfirmRound((r) => r + 1);
    refresh();
  }

  function retryPayment() {
    clearResult();
    setConfirmSlow(false);
    void start();
  }

  if (loadError) {
    return (
      <div className="pay stack">
        {loadError.final ? (
          // Detaydaki gibi: rezervasyon yok veya bu müşterinin değil; yeniden deneme yerine çıkış yolları.
          <BookingNotFound announce level={2} />
        ) : (
          <ErrorState text={loadError.text} onRetry={() => void load()} />
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

      {sessionLost && (
        <div className="alert info pay-session" role="status">
          <span>{t("sessionLost")}</span>
          <button className="btn secondary small" type="button" onClick={loginAgain}>
            {t("loginAgain")}
          </button>
        </div>
      )}

      {pollPaused && !sessionLost && (
        <div className="alert info pay-paused" role="status">
          <span>{t("pollPaused")}</span>
          <button className="btn secondary small" type="button" onClick={refresh}>
            {t("refresh")}
          </button>
        </div>
      )}

      {failed ? (
        <div className="pay-failed stack">
          <p className="alert error" role="alert">
            {t("failed")}
          </p>
          <div className="pay-actions">
            <button className="btn pay-retry" type="button" onClick={retryPayment}>
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
      ) : resumed ? (
        <div className="pay-resumed stack">
          <p className="alert info" role="status">
            {t("resumed")}
          </p>
          <div className="pay-actions">
            <button className="btn secondary" type="button" onClick={retryPayment}>
              {t("backToPayment")}
            </button>
          </div>
        </div>
      ) : confirming ? (
        confirmSlow ? (
          <div className="pay-confirm-slow stack">
            <p className="alert info" role="status">
              {t("confirmSlow")}
            </p>
            <div className="pay-actions">
              <button className="btn" type="button" onClick={refreshConfirmation}>
                {t("refresh")}
              </button>
              <button className="btn secondary" type="button" onClick={retryPayment}>
                {t("backToPayment")}
              </button>
            </div>
          </div>
        ) : (
          <LoadingState label={t("confirming")} />
        )
      ) : (
        <LoadingState label={t("preparing")} />
      )}
    </div>
  );
}
