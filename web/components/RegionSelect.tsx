"use client";

import { useTranslations } from "next-intl";
import { provinceName, regionLabel } from "@/lib/regions";
import type { Region } from "@/lib/types";

export default function RegionSelect(props: {
  id: string;
  label: string;
  regions: Region[];
  value: number | "";
  onChange: (id: number | "") => void;
}) {
  const t = useTranslations("trip");
  const airports = props.regions.filter((r) => r.type === "havalimani");
  const provinces = [...new Set(props.regions.filter((r) => r.type === "ilce").map((r) => r.province))];
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        required
        value={props.value}
        onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : "")}
      >
        <option value="">{t("choose")}</option>
        <optgroup label={t("airports")}>
          {airports.map((r) => (
            <option key={r.id} value={r.id}>
              {regionLabel(r)}
            </option>
          ))}
        </optgroup>
        {provinces.map((p) => (
          <optgroup key={p} label={t("districts", { province: provinceName(p) })}>
            {props.regions
              .filter((r) => r.type === "ilce" && r.province === p)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
