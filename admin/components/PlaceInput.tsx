"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { api, errorMessage, withQuery } from "@/lib/api";

export interface Region {
  id: number;
  code: string;
  name: string;
  province: string;
  type: string;
}

/** Backend `PlaceIn`: ya adres aramasından imzalı jeton ya da doğrudan ilçe/havalimanı. */
export type PlaceValue =
  | { kind: "place"; place_token: string; label: string; region: string; note: string }
  | { kind: "region"; region_id: number; label: string; note: string };

export function placeBody(p: PlaceValue) {
  const address = p.note.trim() || undefined;
  return p.kind === "place" ? { place_token: p.place_token, address } : { region_id: p.region_id, address };
}

interface Suggestion {
  place_id: string;
  title: string;
  subtitle: string;
}

/** Alış veya varış noktası: adres/otel araması (Google Places, backend üzerinden) veya ilçe/havalimanı seçimi. */
export default function PlaceInput(props: {
  label: string;
  regions: Region[];
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
}) {
  const [mode, setMode] = useState<"search" | "region">(props.value?.kind === "region" ? "region" : "search");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
  const byProvince = useMemo(() => {
    const m = new Map<string, Region[]>();
    for (const r of props.regions) m.set(r.province, [...(m.get(r.province) ?? []), r]);
    return [...m.entries()];
  }, [props.regions]);

  useEffect(() => {
    if (mode !== "search" || q.trim().length < 2 || props.value) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      api<Suggestion[]>(withQuery("admin/places/autocomplete", { q: q.trim(), session: session.current }))
        .then((r) => { setItems(r); setError(null); })
        .catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode, props.value]);

  async function pick(s: Suggestion) {
    try {
      const d = await api<{ place_token: string; address: string; region: { name: string } }>(
        withQuery(`admin/places/${encodeURIComponent(s.place_id)}`, { session: session.current }),
      );
      props.onChange({ kind: "place", place_token: d.place_token, label: d.address, region: d.region.name, note: "" });
      setItems([]);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const note = props.value?.note ?? "";
  return (
    <fieldset className="card stack place">
      <legend>{props.label}</legend>
      <div className="row" role="radiogroup" aria-label={`${props.label} seçim şekli`}>
        <label className="check">
          <input type="radio" checked={mode === "search"} onChange={() => { setMode("search"); props.onChange(null); }} />
          Adres veya otel ara
        </label>
        <label className="check">
          <input type="radio" checked={mode === "region"} onChange={() => { setMode("region"); props.onChange(null); }} />
          İlçe / havalimanı seç
        </label>
      </div>

      {props.value ? (
        <div className="row spread">
          <div>
            <strong>{props.value.label}</strong>
            {props.value.kind === "place" && <div className="hint">Bölge: {props.value.region}</div>}
          </div>
          <button type="button" className="btn secondary small" onClick={() => { props.onChange(null); setQ(""); }}>
            Değiştir
          </button>
        </div>
      ) : mode === "search" ? (
        <div className="stack">
          <Field label="Arama" hint="En az 2 harf: otel adı, adres veya havalimanı">
            <input value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} placeholder="ör. Rixos Downtown" />
          </Field>
          {items.length > 0 && (
            <ul className="suggest" role="listbox" aria-label="Adres önerileri">
              {items.map((s) => (
                <li key={s.place_id}>
                  <button type="button" onClick={() => void pick(s)}>
                    <strong>{s.title}</strong> <span className="hint">{s.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Field label="İlçe veya havalimanı">
          <select value="" onChange={(e) => {
            const r = props.regions.find((x) => x.id === Number(e.target.value));
            if (r) props.onChange({ kind: "region", region_id: r.id, label: `${r.name} (${r.province})`, note: "" });
          }}>
            <option value="">Seçin</option>
            {byProvince.map(([province, rs]) => (
              <optgroup key={province} label={province}>
                {rs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      )}

      {props.value && (
        <Field label="Adres notu (sürücüye gösterilir)" hint="Otel adı, oda no, kapı, buluşma noktası">
          <input value={note} maxLength={120}
            onChange={(e) => props.value && props.onChange({ ...props.value, note: e.target.value })} />
        </Field>
      )}
      {error && <p className="alert error">{error}</p>}
    </fieldset>
  );
}
