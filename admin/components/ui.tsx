"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { tone } from "@/lib/labels";

/** GET isteğini yükler; `reload` ile yeniler. `path` null ise istek atılmaz. */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Bir işlemi çalıştırır, hata ve başarı mesajını tutar. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (success) setMessage({ ok: true, text: success });
      return true;
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, setMessage, run };
}

export function Badge({ value, labels }: { value: string; labels?: Record<string, string> }) {
  return <span className={`badge ${tone(value)}`}>{labels?.[value] ?? value}</span>;
}

export function Msg({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return <p className={`alert ${message.ok ? "ok" : "error"}`}>{message.text}</p>;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <p className="alert error">{error}</p> : null;
}

export interface Column<T> {
  key: string;
  title: string;
  render: (row: T) => React.ReactNode;
  align?: "right";
}

export function Table<T>(props: { rows: T[] | null; columns: Column<T>[]; rowKey: (r: T) => string; empty?: string }) {
  if (props.rows === null) return <p className="muted">Yükleniyor…</p>;
  if (props.rows.length === 0) return <p className="muted">{props.empty ?? "Kayıt yok."}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={props.rowKey(r)}>
              {props.columns.map((c) => (
                <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** limit/offset sayfalama. */
export function usePager(limit = 50) {
  const [offset, setOffset] = useState(0);
  const pager = (count: number | undefined) => (
    <div className="row pager">
      <button className="btn secondary small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
        ← Önceki
      </button>
      <span className="muted">
        {offset + 1}–{offset + (count ?? 0)}
      </span>
      <button className="btn secondary small" disabled={(count ?? 0) < limit} onClick={() => setOffset(offset + limit)}>
        Sonraki →
      </button>
    </div>
  );
  return { limit, offset, setOffset, pager };
}

export function Field(props: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export function Select(props: {
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
  empty?: string;
}) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.empty !== undefined && <option value="">{props.empty}</option>}
      {Object.entries(props.options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function PageHead(props: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1>{props.title}</h1>
      <div className="row">{props.children}</div>
    </div>
  );
}
