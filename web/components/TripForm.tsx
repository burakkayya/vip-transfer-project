"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { inputFromNow } from "@/lib/format";
import type { Trip } from "@/lib/trip";
import { saveTrip } from "@/lib/trip";
import type { Region } from "@/lib/types";
import { useRouter } from "@/i18n/navigation";
import AddressField from "./AddressField";
import Icon from "./Icon";

export function useRegions(initial: Region[]) {
  const [regions, setRegions] = useState(initial);
  useEffect(() => {
    if (initial.length === 0) api<Region[]>("regions").then(setRegions).catch(() => undefined);
  }, [initial.length]);
  return regions;
}

function Stepper(props: { id: string; label: string; icon: "users" | "bag"; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="stepper">
        <Icon name={props.icon} />
        <button type="button" aria-label="-" onClick={() => props.onChange(Math.max(props.min, props.value - 1))} disabled={props.value <= props.min}>−</button>
        <input id={props.id} type="number" inputMode="numeric" min={props.min} max={props.max} value={props.value}
          onChange={(e) => props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value) || props.min)))} />
        <button type="button" aria-label="+" onClick={() => props.onChange(Math.min(props.max, props.value + 1))} disabled={props.value >= props.max}>+</button>
      </div>
    </div>
  );
}

/** Rota, tarih, yolcu ve bagaj. Ana sayfada /book'a geçer, rezervasyon sayfasında rotayı günceller. */
export default function TripForm(props: { regions: Region[]; initial: Trip; onSubmit?: (trip: Trip) => void; compact?: boolean }) {
  const t = useTranslations("trip");
  const router = useRouter();
  const regions = useRegions(props.regions);
  const [trip, setTrip] = useState<Trip>(props.initial);
  const [minAt, setMinAt] = useState<string | undefined>(undefined);
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setTrip((s) => ({ ...s, [k]: v }));

  // "Şimdi" istemcide hesaplanır (sunucu çiziminde farklı saat olmasın).
  useEffect(() => setMinAt(inputFromNow(0)), []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trip.from || !trip.to) return;
    saveTrip(trip);
    if (props.onSubmit) props.onSubmit(trip);
    else router.push("/book");
  }

  return (
    <form onSubmit={submit} className={`trip-form ${props.compact ? "compact" : ""}`}>
      <div className="segmented" role="radiogroup">
        <button type="button" role="radio" aria-checked={!trip.roundTrip} className={!trip.roundTrip ? "on" : ""} onClick={() => set("roundTrip", false)}>
          {t("oneWay")}
        </button>
        <button type="button" role="radio" aria-checked={trip.roundTrip} className={trip.roundTrip ? "on" : ""} onClick={() => set("roundTrip", true)}>
          {t("roundTrip")}
        </button>
      </div>

      <div className="route-row">
        <span className="route-rail" aria-hidden><i /><b /><i /></span>
        <AddressField id="from" label={t("from")} icon="plane" regions={regions} value={trip.from} onChange={(v) => set("from", v)} />
        <button type="button" className="swap" aria-label={t("swap")} title={t("swap")}
          onClick={() => setTrip((s) => ({ ...s, from: s.to, to: s.from }))}>
          <Icon name="swap" />
        </button>
        <AddressField id="to" label={t("to")} icon="pin" regions={regions} value={trip.to} onChange={(v) => set("to", v)} />
      </div>

      <div className="details-row">
        <div className="field when">
          <label htmlFor="at">{t("pickupAt")}</label>
          <div className="with-icon">
            <Icon name="calendar" />
            <input id="at" type="datetime-local" required min={minAt} value={trip.at} onChange={(e) => set("at", e.target.value)} />
          </div>
          <span className="hint">{t("pickupHint")}</span>
        </div>
        {trip.roundTrip && (
          <div className="field ret">
            <label htmlFor="ret">{t("returnAt")}</label>
            <div className="with-icon">
              <Icon name="calendar" />
              <input id="ret" type="datetime-local" required min={trip.at} value={trip.returnAt} onChange={(e) => set("returnAt", e.target.value)} />
            </div>
          </div>
        )}
        <Stepper id="pax" label={t("passengers")} icon="users" value={trip.pax} min={1} max={50} onChange={(n) => set("pax", n)} />
        <Stepper id="lug" label={t("luggage")} icon="bag" value={trip.lug} min={0} max={50} onChange={(n) => set("lug", n)} />
        <button className="btn primary big" type="submit" disabled={!trip.from || !trip.to}>
          {t("submit")} <Icon name="arrow" size={18} />
        </button>
      </div>
    </form>
  );
}
