"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { PAID, isFinal, isUnauthorized, statusClass } from "@/lib/booking";
import { clockTime, dateTime, money } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import { usePoll } from "@/lib/poll";
import { regionLabel } from "@/lib/regions";
import { company } from "@/lib/site";
import type { Booking, BookingStatus, DriverLocation, RefundQuote } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import BookingNotFound from "./BookingNotFound";
import { ErrorState } from "./ErrorState";
import Icon from "./Icon";
import { useSessionExpired } from "./RequireLogin";
import { LoadingState } from "./States";
import { CHAT_OPEN, ChatPanel, EtaLine, FinishPanel, useTripEta, useUnread } from "./TripTools";

const TRACKABLE = new Set(["yolda", "vardi", "basladi"]);
const LEG_FLOW = ["beklemede", "atandi", "yolda", "vardi", "basladi", "bitti"];
const CANCELLABLE = new Set<BookingStatus>(["odeme_bekliyor", "onaylandi", "atandi"]);
/** Sürücü ilerledikçe (atandı → yolda → başladı) durum sayfa yenilenmeden güncellensin. */
const ACTIVE = new Set<BookingStatus>(["onaylandi", "atandi", "yolculukta"]);
const REFRESH_MS = 20_000;
/** Canlı konum yoklama aralığı. */
const POLL_MS = 5000;
/** Konum zamanı bu süreden uzun değişmediyse konum canlı gösterilmez (3 yoklama aralığı, K-44). */
const STALE_MS = 3 * POLL_MS;
/** Asılı istek bir sonraki yoklamadan önce iptal edilir: yoklamalar üst üste binmez. */
const REQUEST_TIMEOUT_MS = POLL_MS - 500;
/** Eskime denetimi yoklamadan bağımsız, saniyede bir (duvar saati). */
const TICK_MS = 1000;

/**
 * pending: ilk yanıt bekleniyor · live: konum taze · stale: eldeki konum eskidi ·
 * failed: konum hiç alınamadı (istek hatası) · none: sunucuda konum yok.
 */
type LiveMode = "pending" | "live" | "stale" | "failed" | "none";

/**
 * Sürücü konumu 5 sn'de bir yoklanır (jeton tarayıcıya verilmediği için WebSocket yok). K-44:
 * - Taze = son farklı konum zamanını (`at`) istemcinin ilk gördüğü andan bu yana en çok 3 aralık (15 sn).
 *   `at` değerleri yalnızca birbiriyle karşılaştırılır, istemci saatiyle kıyaslanmaz (saat farkı yok).
 * - Eskime yoklamanın bitmesini beklemez: saniyede bir duvar saatiyle denetlenir (asılı istek de eskitir).
 * - Yoklamalar üst üste binmez: istek sürerken yeni yoklama atlanır, istek aralıktan önce iptal edilir (`usePoll`,
 *   ödeme ekranıyla ortak).
 */
function useDriverLocation(code: string, enabled: boolean) {
  const sessionExpired = useSessionExpired();
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [mode, setMode] = useState<LiveMode>("pending");
  /** Son farklı konum zamanı (sunucu değeri, yalnızca eşitlik için). */
  const lastAt = useRef<string | null>(null);
  /** `lastAt`'ın istemcide ilk görüldüğü an (istemci saati). */
  const seenAt = useRef<number | null>(null);

  const poll = usePoll(
    async ({ signal, current }) => {
      const fresh = () => seenAt.current !== null && Date.now() - seenAt.current <= STALE_MS;
      try {
        const loc = await api<DriverLocation | null>(`me/bookings/${code}/driver-location`, { signal });
        if (!current()) return;
        if (loc) {
          if (loc.at !== lastAt.current) {
            lastAt.current = loc.at;
            seenAt.current = Date.now();
            setLocation(loc);
          }
          // Konum zamanı değişmediyse tazelenmez: başarılı yanıt tek başına "canlı" demek değildir.
          setMode(fresh() ? "live" : "stale");
        } else {
          // Sunucuda konum yok (sürücü göndermiyor, kayıt süresi doldu): eldeki konum hemen eskir.
          seenAt.current = null;
          setMode((m) => (m === "live" || m === "stale" ? "stale" : "none"));
        }
      } catch (e) {
        if (!current()) return;
        if (isUnauthorized(e)) {
          sessionExpired();
          return;
        }
        // Eldeki konumu saat eskitir; hiç konum yoksa "konum yok" değil, hata durumu.
        setMode((m) => (m === "live" || m === "stale" ? m : "failed"));
      }
    },
    { enabled, intervalMs: POLL_MS, timeoutMs: REQUEST_TIMEOUT_MS, immediate: true },
  );

  useEffect(() => {
    if (!enabled) return;
    const tickId = setInterval(() => {
      if (seenAt.current !== null && Date.now() - seenAt.current > STALE_MS) {
        setMode((m) => (m === "live" ? "stale" : m));
      }
    }, TICK_MS);
    return () => {
      clearInterval(tickId);
      // İzleme kapanınca (veya bacak değişince) durum sıfırlanır; sonraki açılış "bekleniyor"dan başlar.
      // Süren yoklama isteğini `usePoll` iptal eder ve sonucunu yok sayar.
      lastAt.current = null;
      seenAt.current = null;
      setLocation(null);
      setMode("pending");
    };
  }, [enabled]);

  return { location, mode, refresh: poll };
}

/** Ekran 7 ve 9: rezervasyon özeti, detay ve iptal. Tutar ve iade API'den gelir, yalnızca biçimlenir. */
export default function BookingDetail(props: { code: string; justPaid?: boolean }) {
  const t = useTranslations("bookings");
  const tb = useTranslations("book");
  const tf = useTranslations("footer");
  const locale = useLocale();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; final: boolean } | null>(null);
  const [refund, setRefund] = useState<RefundQuote | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const busyRef = useRef(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /**
   * Bir sonraki çizimden sonra odaklanacak öğe (panel açılınca başlık, kapanınca açan düğme, iptalde sonuç,
   * yükleme hatasında "Tekrar dene"den sonra rezervasyon başlığı).
   */
  const pendingFocus = useRef<"panel" | "open" | "notice" | "error" | "title" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const el = { panel: panelHeadingRef, open: openRef, notice: noticeRef, error: errorRef, title: titleRef }[target]
      .current;
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
  });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setBooking(await api<Booking>(`me/bookings/${props.code}`));
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setLoadError({ text: isFinal(e) ? t("notFound") : errorText(e), final: isFinal(e) });
    }
  }, [props.code, t, errorText, sessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const tracking = booking?.legs.some((l) => TRACKABLE.has(l.status)) ?? false;
  const live = useDriverLocation(props.code, tracking);
  const eta = useTripEta(props.code, tracking);
  const [chatOpen, setChatOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);
  const hasDriver = booking?.legs.some((l) => l.driver) ?? false;
  const chatLive = booking?.legs.some((l) => l.driver && CHAT_OPEN.has(l.status)) ?? false;
  const unread = useUnread(props.code, chatLive && !chatOpen);
  const canFinish = booking?.legs.some((l) => l.status === "basladi") ?? false;

  // Etkin rezervasyon 20 sn'de bir sessizce yenilenir (durum, sürücü ataması). Hata gösterilmez.
  usePoll(
    async ({ signal, current }) => {
      try {
        const b = await api<Booking>(`me/bookings/${props.code}`, { signal });
        if (current()) setBooking(b);
      } catch (e) {
        if (current() && isUnauthorized(e)) sessionExpired();
      }
    },
    { enabled: booking !== null && ACTIVE.has(booking.status), intervalMs: REFRESH_MS, timeoutMs: REFRESH_MS - 2000 },
  );

  async function previewCancel() {
    if (previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    setActionError(null);
    try {
      setRefund(await api<RefundQuote>(`me/bookings/${props.code}/cancellation`));
      pendingFocus.current = "panel";
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setPreviewError(errorText(e));
    } finally {
      setPreviewing(false);
    }
  }

  function keepBooking() {
    setRefund(null);
    setActionError(null);
    pendingFocus.current = "open";
  }

  // Aynı anda tek iptal isteği: çift tıklama ikinci istek göndermez. Düğme odağını kaybetmesin diye
  // `disabled` yerine `aria-disabled` kullanılır.
  async function confirmCancel() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      setBooking(await api<Booking>(`me/bookings/${props.code}/cancel`, { body: {} }));
      setRefund(null);
      setCancelled(true);
      pendingFocus.current = "notice";
    } catch (e) {
      if (isUnauthorized(e)) {
        sessionExpired();
        return;
      }
      setActionError(errorText(e));
      if (e instanceof ApiError && e.code === "not_cancellable") {
        // Durum başka yerden değişmiş: panel kapanır, güncel rezervasyon okunur.
        setRefund(null);
        pendingFocus.current = "error";
        void load();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="booking-detail">
        {loadError.final ? (
          <BookingNotFound announce />
        ) : (
          <ErrorState
            text={loadError.text}
            onRetry={() => {
              pendingFocus.current = "title";
              void load();
            }}
          />
        )}
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="booking-detail">
        <LoadingState label={t("loading")} />
      </div>
    );
  }

  const fmt = (a: string) => money(a, booking.currency, locale);
  const showPaid = props.justPaid && PAID.has(booking.status) && !cancelled;
  const canCancel = CANCELLABLE.has(booking.status);
  const multi = booking.legs.length > 1;

  return (
    <div className="booking-detail stack">
      {showPaid && (
        <div className="alert ok booking-paid">
          <strong>{t("confirmedTitle")}</strong>
          <span>{t("confirmedText")}</span>
        </div>
      )}
      {cancelled && (
        <p className="alert ok" role="status" tabIndex={-1} ref={noticeRef}>
          {t("cancelled")}
        </p>
      )}
      {finished && (
        <p className="alert ok" role="status" tabIndex={-1} ref={noticeRef}>
          {t("finishDone")}
        </p>
      )}

      <section className="card elevated booking-head" aria-labelledby="booking-code">
        <div className="booking-head-main">
          <span className="label">{t("code")}</span>
          <h1 className="booking-code" id="booking-code" tabIndex={-1} ref={titleRef}>
            {booking.booking_code}
          </h1>
          <p className="muted booking-meta">
            {booking.vehicle_type.name} · {t("people", { passengers: booking.passenger_count, luggage: booking.luggage_count })}
          </p>
        </div>
        <div className="booking-head-side">
          <span className={`badge ${statusClass(booking.status)}`}>{t(`status.${booking.status}`)}</span>
          <div className="booking-total-box">
            <span className="booking-total-label">{t("total")}</span>
            <p className="price booking-total">{fmt(booking.total_amount)}</p>
          </div>
        </div>
      </section>

      {booking.legs.map((leg) => {
        const idx = LEG_FLOW.indexOf(leg.status);
        const titleId = `leg-${leg.id}`;
        return (
          <section key={leg.id} className="card stack booking-leg" aria-labelledby={titleId}>
            <div className="leg-head">
              <h2 className="leg-title" id={titleId}>
                {multi && <span className="leg-order">{leg.leg_order}. </span>}
                {regionLabel(leg.pickup_region)} → {regionLabel(leg.dropoff_region)}
              </h2>
              <p className="leg-when">
                <Icon name="calendar" size={16} />
                <span>{dateTime(leg.pickup_at, locale)}</span>
              </p>
            </div>
            {leg.status !== "iptal" && (
              <ol className="timeline" aria-label={t("progress")}>
                {LEG_FLOW.map((st, i) => (
                  <li
                    key={st}
                    className={`${i <= idx ? "done" : ""} ${i === idx ? "current" : ""}`}
                    aria-current={i === idx ? "step" : undefined}
                  >
                    {t(`legStatus.${st}`)}
                  </li>
                ))}
              </ol>
            )}
            {(leg.pickup_address || leg.dropoff_address || leg.flight) && (
              <dl className="summary booking-facts">
                {(leg.pickup_address || leg.dropoff_address) && (
                  <>
                    <dt>
                      <Icon name="pin" size={16} /> {t("address")}
                    </dt>
                    <dd>{[leg.pickup_address, leg.dropoff_address].filter(Boolean).join(" → ")}</dd>
                  </>
                )}
                {leg.flight && (
                  <>
                    <dt>
                      <Icon name="plane" size={16} /> {t("flight")}
                    </dt>
                    <dd className="tabular">{leg.flight.flight_no}</dd>
                  </>
                )}
              </dl>
            )}
            {leg.driver ? (
              <div className="driver-card">
                <span className="avatar" aria-hidden="true">
                  {leg.driver.first_name.slice(0, 1)}
                </span>
                <div className="driver-text">
                  <span className="sr-only">{t("driver")}: </span>
                  <strong>{leg.driver.first_name}</strong>
                  <div className="muted">
                    {leg.driver.vehicle} · <strong className="tabular">{leg.driver.plate}</strong>
                  </div>
                </div>
              </div>
            ) : (
              leg.status !== "iptal" && (
                <p className="muted leg-note">
                  <Icon name="clock" size={16} />
                  <span>{t("driverPending")}</span>
                </p>
              )
            )}
            {leg.driver && <EtaLine eta={eta} legId={leg.id} status={leg.status} />}
            {TRACKABLE.has(leg.status) && <LiveBox {...live} />}
          </section>
        );
      })}

      {(hasDriver || canFinish) && !chatOpen && !finishing && (
        <div className="booking-actions trip-actions">
          {hasDriver && (
            <button className="btn primary" type="button" onClick={() => setChatOpen(true)}>
              <Icon name="chat" size={18} /> {chatLive ? t("chatOpen") : t("chatHistory")}
              {unread.unread > 0 && (
                <span className="count-badge">
                  {unread.unread}
                  <span className="sr-only"> {t("chatUnread")}</span>
                </span>
              )}
            </button>
          )}
          {canFinish && (
            <button className="btn secondary" type="button" onClick={() => setFinishing(true)}>
              <Icon name="check" size={18} /> {t("finishButton")}
            </button>
          )}
        </div>
      )}
      {chatOpen && (
        <ChatPanel
          code={props.code}
          onRead={() => unread.setUnread(0)}
          onClose={() => {
            setChatOpen(false);
            void unread.refresh();
          }}
        />
      )}
      {finishing && (
        <FinishPanel
          code={props.code}
          onCancel={() => setFinishing(false)}
          onDone={(b) => {
            setBooking(b);
            setFinishing(false);
            setFinished(true);
            pendingFocus.current = "notice";
          }}
        />
      )}

      <section className="card" aria-label={t("details")}>
        <dl className="summary booking-facts">
          <dt>
            <Icon name="user" size={16} /> {t("passenger")}
          </dt>
          <dd>{booking.passenger_name}</dd>
          {booking.note && (
            <>
              <dt>
                <Icon name="list" size={16} /> {t("note")}
              </dt>
              <dd>{booking.note}</dd>
            </>
          )}
          <dt>
            <Icon name="clock" size={16} /> {t("createdAt")}
          </dt>
          <dd>{dateTime(booking.created_at, locale)}</dd>
        </dl>
      </section>

      {actionError && !refund && (
        <p className="alert error" role="alert" tabIndex={-1} ref={errorRef}>
          {actionError}
        </p>
      )}
      {previewError && <ErrorState text={previewError} onRetry={() => void previewCancel()} />}

      {(booking.status === "odeme_bekliyor" || (canCancel && !refund)) && (
        <div className="booking-actions">
          {booking.status === "odeme_bekliyor" && (
            <Link className="btn primary big" href={`/bookings/${booking.booking_code}/pay`}>
              <Icon name="card" size={18} /> {t("payNow")}
            </Link>
          )}
          {canCancel && !refund && (
            <button
              ref={openRef}
              className="btn secondary booking-cancel-open"
              type="button"
              aria-disabled={previewing || undefined}
              onClick={() => void previewCancel()}
            >
              {previewing ? t("cancelLoading") : t("cancel")}
            </button>
          )}
        </div>
      )}

      {refund && (
        <section className="card stack cancel-panel" aria-labelledby="cancel-title">
          <h2 id="cancel-title" tabIndex={-1} ref={panelHeadingRef}>
            {t("cancel")}
          </h2>
          {booking.status === "odeme_bekliyor" ? (
            <p className="cancel-text">{t("cancelNoPay")}</p>
          ) : (
            <>
              <div className="cancel-summary">
                <span className="cancel-refund-label">{t("refundAmount")}</span>
                <p className="price cancel-refund">{fmt(refund.refund_amount)}</p>
              </div>
              <p className="cancel-text">
                {t("cancelPreview", { percent: refund.refund_percent })}
                {refund.guarantee_applied && <> {t("cancelGuarantee")}</>}
              </p>
            </>
          )}
          <p className="cancel-policy">
            {tb("cancelTiers")}{" "}
            <Link href="/legal/cancellation">{tf("cancellation")}</Link>
          </p>
          {actionError && (
            <p className="alert error cancel-error" role="alert" tabIndex={-1} ref={errorRef}>
              {actionError}
            </p>
          )}
          <div className="cancel-actions">
            <button
              className="btn danger"
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void confirmCancel()}
            >
              {busy ? t("cancelling") : t("cancelConfirm")}
            </button>
            <button className="btn outline" type="button" onClick={keepBooking}>
              {t("keep")}
            </button>
          </div>
        </section>
      )}

      {booking.status !== "iptal" && booking.status !== "tamamlandi" && (
        <p className="hint booking-change">
          {t.rich("changeText", {
            email: company.email,
            mail: (chunks) => <a href={`mailto:${company.email}`}>{chunks}</a>,
          })}
        </p>
      )}
    </div>
  );
}

/** Canlı takip kutusu. Yalnızca durum değiştiğinde duyurulur (her 5 sn'lik güncellemede değil). */
function LiveBox(props: { location: DriverLocation | null; mode: LiveMode; refresh: () => Promise<void> }) {
  const t = useTranslations("bookings");
  const locale = useLocale();
  const { location, mode } = props;
  const isLive = mode === "live";
  const failing = mode === "stale" || mode === "failed";
  const title = failing ? t("liveStale") : mode === "pending" ? t("liveLoading") : t("live");
  return (
    <div className={`live-box is-${mode}${failing ? " stale" : ""}`}>
      {/* Yalnızca durum değişince duyurulur; saat ayrı satırdadır, her güncellemede okunmaz. */}
      <p className="live-title" role="status">
        <span className={isLive ? "live-dot" : "live-dot-off"} aria-hidden="true" />
        <strong>{title}</strong>
      </p>
      {location && (mode === "live" || mode === "stale") && (
        <p className="live-meta">
          <span>{t("liveUpdated", { time: clockTime(location.at, locale) })}</span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            {isLive ? t("openMap") : t("openMapLast")}
            <span className="sr-only"> ({t("newTab")})</span>
          </a>
        </p>
      )}
      {mode === "none" && <p className="live-meta">{t("liveNone")}</p>}
      {(failing || mode === "none") && (
        <div>
          <button className="btn secondary small" type="button" onClick={() => void props.refresh()}>
            {t("liveRefresh")}
          </button>
        </div>
      )}
    </div>
  );
}
