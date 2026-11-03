"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { dateTime } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import type { DataRequest } from "@/lib/types";
import { ErrorState } from "./ErrorState";
import { useSessionExpired } from "./RequireLogin";
import { LoadingState } from "./States";

const TYPES = ["erisim", "duzeltme", "silme"] as const;
type RequestType = (typeof TYPES)[number];

/** Durum rozetinin rengi: sonuçlanan yeşil, reddedilen kırmızı, diğerleri nötr. */
function statusClass(s: string) {
  if (s === "tamamlandi") return "ok";
  if (s === "reddedildi") return "danger";
  return "";
}

/**
 * KVKK m.11 / GDPR veri talep formu ve talep listesi.
 * Tür önceden seçilmez (özellikle silme talebi bilinçli seçilmeli); seçmeden gönderimde alan hatası.
 * Liste kendi yükleniyor ve hata + "Tekrar dene" durumunu taşır; alınamazsa "talebiniz yok" denmez.
 */
export default function DataRequestPanel() {
  const t = useTranslations("dataRequest");
  const locale = useLocale();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [type, setType] = useState<RequestType | null>(null);
  const [typeError, setTypeError] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<DataRequest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [list, setList] = useState<DataRequest[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  /** Silme talebi gönderilmeden önce satır içi onay (rezervasyon iptaliyle aynı desen). */
  const [confirming, setConfirming] = useState(false);
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  /** Bir sonraki çizimden sonra odaklanacak öğe: onay açılınca başlığı, "Vazgeç"te gönder düğmesi. */
  const pendingFocus = useRef<"confirm" | "submit" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === "confirm" ? confirmTitle.current : submitRef.current)?.focus();
  });

  /** Yeni bir talebe başlanınca önceki sonuç ve hata kalkar. */
  function startNew() {
    setSent(null);
    setSubmitError(null);
  }

  // Oturum düştüyse (401) `RequireLogin` girişi yeniden gösterir.
  const load = useCallback(() => {
    setListError(null);
    setList(null);
    api<DataRequest[]>("me/data-requests")
      .then(setList)
      .catch((e) => (isUnauthorized(e) ? sessionExpired() : setListError(errorText(e))));
  }, [errorText, sessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setSent(null);
    setSubmitError(null);
    if (!type) {
      setTypeError(true);
      firstRadio.current?.focus();
      return;
    }
    // Silme talebi geri çekilemez: önce satır içi onay istenir.
    if (type === "silme" && !confirming) {
      setConfirming(true);
      pendingFocus.current = "confirm";
      return;
    }
    busy.current = true;
    setSending(true);
    try {
      const req = await api<DataRequest>("me/data-requests", {
        body: { request_type: type, note: note.trim() || null },
      });
      setList((l) => [req, ...(l ?? [])]);
      setNote("");
      setType(null);
      setConfirming(false);
      setSent(req);
    } catch (err) {
      if (isUnauthorized(err)) sessionExpired();
      else setSubmitError(errorText(err));
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const statusLabel = (s: string) => (t.has(`statuses.${s}`) ? t(`statuses.${s}`) : s);

  return (
    <div className="stack">
      <form className="card stack data-request-form" onSubmit={submit} noValidate aria-busy={sending || undefined}>
        <fieldset
          className="choice-group"
          aria-describedby={typeError ? "type-error" : undefined}
        >
          <legend>{t("type")}</legend>
          {TYPES.map((v, i) => (
            <div key={v} className="option-card">
              <input
                ref={i === 0 ? firstRadio : undefined}
                type="radio"
                id={`type-${v}`}
                name="request-type"
                value={v}
                checked={type === v}
                onChange={() => {
                  setType(v);
                  setTypeError(false);
                  if (v !== "silme") setConfirming(false);
                  startNew();
                }}
              />
              <label htmlFor={`type-${v}`}>{t(`types.${v}`)}</label>
            </div>
          ))}
          {typeError && (
            <span className="field-error" id="type-error" role="alert">
              {t("typeRequired")}
            </span>
          )}
        </fieldset>
        <div className="field">
          <label htmlFor="note">{t("note")}</label>
          <textarea
            id="note"
            rows={4}
            maxLength={1000}
            value={note}
            aria-describedby="note-hint"
            onChange={(e) => {
              setNote(e.target.value);
              startNew();
            }}
          />
          <span className="hint" id="note-hint">
            {t("noteHint", { count: 1000 - note.length })}
          </span>
        </div>
        {/* Başarı kalıcı canlı bölgede duyurulur; hata `role="alert"`. */}
        <div role="status" className="account-note">
          {sent && <p className="alert ok">{t("sentDue", { date: dateTime(sent.due_at, locale) })}</p>}
        </div>
        {submitError && (
          <p className="alert error" role="alert">
            {submitError}
          </p>
        )}
        {confirming ? (
          <section className="confirm-panel stack" aria-labelledby="delete-confirm-title">
            <h2 id="delete-confirm-title" tabIndex={-1} ref={confirmTitle}>
              {t("deleteConfirmTitle")}
            </h2>
            <p>{t("deleteConfirmText")}</p>
            <div className="cancel-actions">
              <button className="btn danger" type="submit" aria-disabled={sending || undefined}>
                {sending ? t("sending") : t("deleteConfirm")}
              </button>
              <button
                className="btn outline"
                type="button"
                onClick={() => {
                  setConfirming(false);
                  pendingFocus.current = "submit";
                }}
              >
                {t("keep")}
              </button>
            </div>
          </section>
        ) : (
          <div>
            <button ref={submitRef} className="btn" type="submit" disabled={sending}>
              {sending ? t("sending") : t("submit")}
            </button>
          </div>
        )}
      </form>

      <section className="card stack data-request-list" aria-labelledby="data-request-list-title">
        <h2 id="data-request-list-title">{t("list")}</h2>
        {listError ? (
          <ErrorState text={listError} onRetry={load} />
        ) : list === null ? (
          <LoadingState label={t("listLoading")} />
        ) : list.length === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          <ul className="request-list" aria-labelledby="data-request-list-title">
            {list.map((r) => (
              <li key={r.id}>
                <span className="request-type">{t(`types.${r.request_type}`)}</span>
                <span className={`badge ${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                <span className="hint">{t("due", { date: dateTime(r.due_at, locale) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
