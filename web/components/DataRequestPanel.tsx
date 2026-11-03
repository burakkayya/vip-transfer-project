"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { dateTime } from "@/lib/format";
import { useApiError } from "@/lib/hooks";
import type { DataRequest } from "@/lib/types";
import { useSessionExpired } from "./RequireLogin";

const TYPES = ["erisim", "duzeltme", "silme"] as const;

/** KVKK m.11 / GDPR veri talep formu. */
export default function DataRequestPanel() {
  const t = useTranslations("dataRequest");
  const locale = useLocale();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [type, setType] = useState<(typeof TYPES)[number]>("erisim");
  const [note, setNote] = useState("");
  const [list, setList] = useState<DataRequest[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Oturum düştüyse (401) `RequireLogin` girişi yeniden gösterir; diğer liste hataları şimdilik yutulur (B-W9).
  useEffect(() => {
    api<DataRequest[]>("me/data-requests")
      .then(setList)
      .catch((e) => isUnauthorized(e) && sessionExpired());
  }, [sessionExpired]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const req = await api<DataRequest>("me/data-requests", {
        body: { request_type: type, note: note.trim() || null },
      });
      setList((l) => [req, ...l]);
      setNote("");
      setMessage({ ok: true, text: t("sent") });
    } catch (err) {
      if (isUnauthorized(err)) sessionExpired();
      else setMessage({ ok: false, text: errorText(err) });
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="type">{t("type")}</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`types.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="note">{t("note")}</label>
          <textarea id="note" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {message && <p className={`alert ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
        <div>
          <button className="btn" type="submit">
            {t("submit")}
          </button>
        </div>
      </form>
      {list.length > 0 && (
        <div className="card stack">
          <h2>{t("list")}</h2>
          {list.map((r) => (
            <div key={r.id} className="row spread">
              <span>{t(`types.${r.request_type}`)}</span>
              <span className="badge">{t(`statuses.${r.status}`)}</span>
              <span className="hint">{t("due", { date: dateTime(r.due_at, locale) })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
