"use client";

import { useRef } from "react";

/**
 * Seçenek düğmeleri radyo grubu (WAI-ARIA radio deseni): tek sekme durağı, ok tuşları seçimi değiştirir ve odağı
 * seçilene taşır. Transfer formundaki yön seçici ve günlük kiralamadaki paket seçici bunu kullanır.
 */
export default function Segmented<T extends string | boolean>(props: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  labelledBy?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = props.options.findIndex((o) => o.value === props.value);

  function onKey(e: React.KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    // Sağdan sola dilde (Arapça) sağ ok bir önceki seçeneğe gider.
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const dir = rtl && (e.key === "ArrowRight" || e.key === "ArrowLeft") ? -step : step;
    const n = props.options.length;
    const next = (Math.max(index, 0) + dir + n) % n;
    props.onChange(props.options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={props.label} aria-labelledby={props.labelledBy}>
      {props.options.map((o, i) => {
        const on = o.value === props.value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={on ? "on" : ""}
            onClick={() => props.onChange(o.value)}
            onKeyDown={onKey}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
