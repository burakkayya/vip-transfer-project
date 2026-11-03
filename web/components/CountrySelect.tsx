"use client";

import { countries } from "@/lib/site";

export default function CountrySelect(props: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  showDial?: boolean;
  /** Alanın altındaki ipucu; seçim kutusuna `aria-describedby` ile bağlanır. */
  hint?: string;
}) {
  const hintId = `${props.id}-hint`;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        value={props.value}
        aria-describedby={props.hint ? hintId : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {props.showDial ? `${c.name} (${c.dial})` : c.name}
          </option>
        ))}
      </select>
      {props.hint && (
        <span className="hint" id={hintId}>
          {props.hint}
        </span>
      )}
    </div>
  );
}
