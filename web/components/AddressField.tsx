"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApiError } from "@/lib/hooks";
import { provinceName } from "@/lib/regions";
import { regionEndpoint } from "@/lib/trip";
import type { Endpoint, PlaceDetails, PlaceSuggestion, Region } from "@/lib/types";
import Icon from "./Icon";

type Option =
  | { kind: "region"; key: string; region: Region; title: string; subtitle: string }
  | { kind: "place"; key: string; place: PlaceSuggestion; title: string; subtitle: string };

const fold = (s: string) =>
  s.replace(/ı/g, "i").replace(/İ/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function newSession() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

/**
 * Adres seçimi (ekran 2-3). Havalimanı ve ilçeler anında listelenir; otel ve adresler
 * backend üzerinden Google Places ile aranır. Seçilen adresin ilçesi fiyatı belirler.
 */
export default function AddressField(props: {
  id: string;
  label: string;
  icon: "pin" | "plane";
  regions: Region[];
  value: Endpoint | null;
  onChange: (e: Endpoint | null) => void;
  /** Formun bildirdiği hata (ör. gönderimde boş alan). */
  error?: string | null;
}) {
  const t = useTranslations("trip");
  const locale = useLocale();
  const errorText = useApiError();
  const listId = useId();
  const errorId = `${props.id}-error`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSession());
  const box = useRef<HTMLDivElement>(null);

  const airports = useMemo(() => props.regions.filter((r) => r.type === "havalimani"), [props.regions]);

  const options: Option[] = useMemo(() => {
    const q = fold(query.trim());
    const regionHits = (q ? props.regions.filter((r) => fold(`${r.name} ${r.iata_code ?? ""}`).includes(q)) : airports)
      .slice(0, 6)
      .map<Option>((r) => ({
        kind: "region",
        key: `r${r.id}`,
        region: r,
        title: r.iata_code ? `${r.name} (${r.iata_code})` : r.name,
        subtitle: r.type === "havalimani" ? t("quickAirports") : `${t("districtsGroup")} · ${provinceName(r.province)}`,
      }));
    // Bölge listesinde zaten olan yerleri (ör. havalimanı) adres sonuçlarında tekrar gösterme.
    const shown = new Set(regionHits.map((o) => fold(o.title)));
    const placeHits = places
      .filter((p) => !shown.has(fold(p.title)))
      .map<Option>((p) => ({ kind: "place", key: p.place_id, place: p, title: p.title, subtitle: p.subtitle }));
    return [...regionHits, ...placeHits];
  }, [query, props.regions, airports, places, t]);

  // Yazma durunca adres araması (ücretli API: en az 3 karakter, 300 ms gecikme).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setPlaces([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = new URLSearchParams({ q, session: session.current, lang: locale });
        setPlaces(await api<PlaceSuggestion[]>(`places/autocomplete?${qs}`));
        setError(null);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, locale, errorText]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function choose(o: Option) {
    setOpen(false);
    setError(null);
    if (o.kind === "region") {
      props.onChange(regionEndpoint(o.region));
    } else {
      try {
        const qs = new URLSearchParams({ session: session.current, lang: locale });
        const d = await api<PlaceDetails>(`places/${encodeURIComponent(o.place.place_id)}?${qs}`);
        props.onChange({ label: o.title, region: d.region, place_token: d.place_token });
      } catch (e) {
        setError(errorText(e));
        return;
      }
    }
    setQuery("");
    setPlaces([]);
    session.current = newSession();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Kapalı liste önce açılır (ilk öneri etkin); açıksa bir sonrakine geçer.
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      void choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const shownError = props.error ?? error;
  const optionId = (i: number) => `${listId}-o${i}`;
  const showList = open && !props.value;

  return (
    <div className={`field address ${props.icon === "plane" ? "from" : "to"}`} ref={box}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.value ? (
        <div className="address-chosen">
          <span className={`marker ${props.icon === "plane" ? "origin" : "destination"}`} aria-hidden />
          <div>
            <strong>{props.value.label}</strong>
            <span className="hint">{t("regionHint", { region: props.value.region.name })}</span>
          </div>
          <button type="button" className="icon-btn" aria-label={t("clear")} onClick={() => props.onChange(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : (
        <div className="address-input">
          <span className={`marker ${props.icon === "plane" ? "origin" : "destination"}`} aria-hidden />
          <input
            id={props.id}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && options[active] ? optionId(active) : undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={shownError ? errorId : undefined}
            autoComplete="off"
            placeholder={props.label}
            aria-label={`${props.label}: ${t("searchPlaceholder")}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
          />
        </div>
      )}
      {showList && (
        <ul className="suggestions" id={listId} role="listbox">
          {query.trim().length < 3 && <li className="tip-row" role="presentation">{t("searchPlaceholder")}</li>}
          {options.map((o, i) => (
            <li
              key={o.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(o);
              }}
            >
              <Icon name={o.kind === "region" && o.region.type === "havalimani" ? "plane" : "pin"} size={18} />
              <span>
                <strong>{o.title}</strong>
                <small>{o.subtitle}</small>
              </span>
            </li>
          ))}
          {searching && <li className="muted-row">{t("searching")}</li>}
          {!searching && query.trim().length >= 3 && options.length === 0 && <li className="muted-row">{t("noResults")}</li>}
        </ul>
      )}
      {shownError && <span className="field-error" id={errorId} role={props.error ? "alert" : undefined}>{shownError}</span>}
    </div>
  );
}
