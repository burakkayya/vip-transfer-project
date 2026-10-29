"use client";

import { countries } from "@/lib/site";

export default function CountrySelect(props: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  showDial?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {props.showDial ? `${c.name} (${c.dial})` : c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
