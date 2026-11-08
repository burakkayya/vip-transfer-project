"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { clockTime } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import { usePoll } from "@/lib/poll";
import type { Booking, Chat, ChatMessage, LegStatus, TripEta } from "@/lib/types";
import Icon from "./Icon";
import { useSessionExpired } from "./RequireLogin";

/** Sohbetin açık olduğu bacak durumları (backend `messages.OPEN_STATUSES`). */
export const CHAT_OPEN = new Set<LegStatus>(["atandi", "yolda", "vardi", "basladi"]);
const ETA_STATUSES = new Set<LegStatus>(["yolda", "vardi", "basladi"]);
const ETA_POLL_MS = 15_000;
const UNREAD_POLL_MS = 15_000;
const CHAT_POLL_MS = 4_000;
const QUICK = ["chatQ1", "chatQ2", "chatQ3", "chatQ4"] as const;
/** Sürücü uygulaması Türkçedir (K-36): hazır cevap başka dilde gönderilirse Türkçe karşılığı eklenir. */
const QUICK_TR: Record<(typeof QUICK)[number], string> = {
  chatQ1: "Geliyorum",
  chatQ2: "Bagajları alıyorum",
  chatQ3: "Kapıdayım",
  chatQ4: "Neredesiniz?",
};

/**
 * Sürücünün kalan süresi (K-51). Yolcu alınana kadar alışa, yolculukta varışa dakika; sürücü geldiyse "geldi".
 * Süre bilinmiyorsa (tahmin henüz yok) satır hiç gösterilmez.
 */
export function useTripEta(code: string, enabled: boolean) {
  const [eta, setEta] = useState<TripEta | null>(null);
  usePoll(
    async ({ signal, current }) => {
      try {
        const r = await api<TripEta>(`me/bookings/${code}/eta`, { signal });
        if (current()) setEta(r);
      } catch {
        // Tahmin yardımcı bilgidir: hata gösterilmez, sonraki yoklamada yeniden denenir.
      }
    },
    { enabled, intervalMs: ETA_POLL_MS, timeoutMs: ETA_POLL_MS - 1000, immediate: true },
  );
  useEffect(() => {
    if (!enabled) setEta(null);
  }, [enabled]);
  return eta;
}

export function EtaLine(props: { eta: TripEta | null; legId: string; status: LegStatus }) {
  const t = useTranslations("bookings");
  const { eta } = props;
  if (!ETA_STATUSES.has(props.status)) return null;
  let text: string | null = null;
  if (props.status === "vardi") text = t("etaArrived");
  else if (eta && eta.leg_id === props.legId && eta.eta_minutes !== null) {
    const min = Math.max(1, eta.eta_minutes);
    text = props.status === "basladi" ? t("etaTrip", { min }) : t("eta", { min });
  }
  if (!text) return null;
  // Dakika değişimleri duyurulmaz (gürültü); yalnızca "sürücü geldi" durum mesajı olarak okunur.
  return (
    <p className="eta-line" role={props.status === "vardi" ? "status" : undefined}>
      <Icon name="clock" size={18} />
      <strong>{text}</strong>
    </p>
  );
}

/** Okunmamış sürücü mesajı sayısı (sohbet kapalıyken 15 sn'de bir). */
export function useUnread(code: string, enabled: boolean) {
  const [unread, setUnread] = useState(0);
  const poll = usePoll(
    async ({ signal, current }) => {
      try {
        const r = await api<{ unread: number }>(`me/bookings/${code}/messages/unread`, { signal });
        if (current()) setUnread(r.unread);
      } catch {
        // rozet yardımcı bilgidir
      }
    },
    { enabled, intervalMs: UNREAD_POLL_MS, timeoutMs: UNREAD_POLL_MS - 1000, immediate: true },
  );
  return { unread, setUnread, refresh: poll };
}

/**
 * Müşteri–sürücü sohbeti (K-50). Telefon numarası paylaşılmaz. Açıkken 4 sn'de bir yenilenir; açmak sürücünün
 * mesajlarını okundu sayar. Yolculuk bitince yalnızca okunur.
 */
export function ChatPanel(props: { code: string; onClose: () => void; onRead: () => void }) {
  const t = useTranslations("bookings");
  const locale = useLocale();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [chat, setChat] = useState<Chat | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastCount = useRef(0);
  const sendingRef = useRef(false);
  /** Bu panelde gönderilen mesajlar: gönderimden önce başlamış bir yoklama yanıtı bunları silmesin. */
  const sentRef = useRef<ChatMessage[]>([]);
  const { onRead } = props;

  const poll = usePoll(
    async ({ signal, current }) => {
      try {
        const c = await api<Chat>(`me/bookings/${props.code}/messages`, { signal });
        if (!current()) return;
        setChat(withSent(c, sentRef.current));
        setLoadError(null);
        onRead();
      } catch (e) {
        if (!current()) return;
        if (isUnauthorized(e)) sessionExpired();
        else setLoadError((prev) => (chat ? prev : errorText(e)));
      }
    },
    { enabled: true, intervalMs: CHAT_POLL_MS, timeoutMs: CHAT_POLL_MS - 500, immediate: true },
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Yeni mesaj gelince liste en alta kayar (yalnızca sayı değişince).
  useEffect(() => {
    const n = chat?.messages.length ?? 0;
    if (n !== lastCount.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    lastCount.current = n;
  }, [chat]);

  const send = useCallback(
    async (body: string) => {
      const value = body.trim();
      if (!value || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      try {
        const msg = await api<ChatMessage>(`me/bookings/${props.code}/messages`, { body: { body: value } });
        sentRef.current = [...sentRef.current, msg];
        setChat((c) => (c ? withSent(c, [msg]) : c));
        // Gönderim sürerken yazılmaya devam edilen metin silinmez.
        setText((t) => (t.trim() === value ? "" : t));
      } catch (e) {
        if (isUnauthorized(e)) sessionExpired();
        else {
          setSendError(errorText(e));
          if (e instanceof ApiError && e.code === "chat_closed") void poll();
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [props.code, sessionExpired, errorText, poll],
  );

  const lastMine = chat ? [...chat.messages].reverse().find((m) => m.sender === "customer") : undefined;

  return (
    <section className="card stack chat-panel" aria-labelledby="chat-title">
      <div className="chat-head">
        <h2 id="chat-title" tabIndex={-1} ref={headingRef}>
          {chat ? t("chatWith", { name: chat.other_name }) : t("chatTitle")}
        </h2>
        <button className="btn outline small" type="button" onClick={props.onClose}>
          <Icon name="close" size={16} /> {t("chatClose")}
        </button>
      </div>

      {loadError && !chat && (
        <p className="alert error" role="alert">
          {loadError}
        </p>
      )}
      {!chat && !loadError && <p className="muted">{t("chatLoading")}</p>}

      {chat && (
        <>
          {/* Canlı bölge boşken de DOM'da kalır: ilk gelen mesaj da duyurulur. Klavyeyle kaydırılabilir (tabIndex). */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className="chat-scroll" ref={listRef} role="log" aria-live="polite" aria-label={t("chatTitle")} tabIndex={0}>
            {chat.messages.length === 0 ? (
              <p className="muted chat-empty">{t("chatEmpty")}</p>
            ) : (
              <ol className="chat-list">
                {chat.messages.map((m) => (
                  <li key={m.id} className={m.sender === "customer" ? "mine" : "theirs"}>
                    <span className="sr-only">{m.sender === "customer" ? t("chatYou") : chat.other_name}: </span>
                    <p className="chat-bubble">{m.body}</p>
                    <span className="chat-time">
                      {clockTime(m.created_at, locale).slice(0, 5)}
                      {m.id === lastMine?.id && m.read_at && <> · {t("chatRead")}</>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {chat.open ? (
            <form
              className="stack chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <div className="chat-quick" role="group" aria-label={t("chatQuick")}>
                {QUICK.map((k) => (
                  <button key={k} className="chip" type="button" aria-disabled={sending || undefined}
                    onClick={() => void send(locale === "tr" ? t(k) : `${t(k)} (${QUICK_TR[k]})`)}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="chat-input">
                {t("chatPlaceholder")}
              </label>
              <div className="chat-compose">
                <textarea
                  id="chat-input"
                  rows={2}
                  maxLength={1000}
                  value={text}
                  placeholder={t("chatPlaceholder")}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send(text);
                    }
                  }}
                />
                <button className="btn primary" type="submit" aria-disabled={sending || !text.trim() || undefined}>
                  {sending ? t("chatSending") : t("chatSend")}
                </button>
              </div>
              {sendError && (
                <p className="alert error" role="alert">
                  {sendError}
                </p>
              )}
            </form>
          ) : (
            <p className="muted chat-closed">
              <Icon name="lock" size={16} /> {t("chatClosed")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Sunucu listesine yerelde gönderilmiş ama henüz listede olmayan mesajları ekler (kimliğe göre tekil, zamana göre). */
function withSent(chat: Chat, sent: ChatMessage[]): Chat {
  const ids = new Set(chat.messages.map((m) => m.id));
  const missing = sent.filter((m) => !ids.has(m.id));
  if (missing.length === 0) return chat;
  const messages = [...chat.messages, ...missing].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { ...chat, messages };
}

/**
 * Yolculuğu bitirme (K-48): yolcu araçtayken müşteri her an bitirebilir; tamamlandı sayılır, iade yoktur.
 * İptal paneliyle aynı desen: önce açıklama ve onay, eşit görünür "Vazgeç".
 */
export function FinishPanel(props: { code: string; onDone: (b: Booking) => void; onCancel: () => void }) {
  const t = useTranslations("bookings");
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      props.onDone(await api<Booking>(`me/bookings/${props.code}/finish`, { body: {} }));
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      else setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="card stack cancel-panel" aria-labelledby="finish-title">
      <h2 id="finish-title" tabIndex={-1} ref={headingRef}>
        {t("finishTitle")}
      </h2>
      <p className="cancel-text">{t("finishText")}</p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="cancel-actions">
        <button className="btn primary" type="button" aria-disabled={busy || undefined} onClick={() => void confirm()}>
          {busy ? t("finishing") : t("finishConfirm")}
        </button>
        <button className="btn outline" type="button" onClick={props.onCancel}>
          {t("finishCancel")}
        </button>
      </div>
    </section>
  );
}
