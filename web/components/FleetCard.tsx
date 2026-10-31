"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import Icon, { vehicleIcon } from "./Icon";

type Variant = { key: string; label: string; image: string };

/** Filo kartı. Birden fazla renk seçeneği olan araçta (minibüs: beyaz/siyah) görsel değiştirilebilir. */
export default function FleetCard(props: {
  code: string;
  name: string;
  capacity: number;
  luggage: number;
  tag?: string;
  cta: string;
  variants: Variant[];
}) {
  const [active, setActive] = useState(0);
  const v = props.variants[active];
  return (
    <div className="fleet-card">
      <Link href={`/book?vehicle=${props.code}`} className="media" aria-label={`${props.name} · ${props.cta}`}>
        {props.tag && <span className="tag">{props.tag}</span>}
        {v ? (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={v.key}
              src={v.image}
              alt={`${props.name} ${props.variants.length > 1 ? v.label : ""}`.trim()}
              loading="lazy"
              width={1200}
              height={760}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            />
          </AnimatePresence>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Icon name={vehicleIcon(props.code)} size={56} />
          </div>
        )}
      </Link>
      <div className="meta">
        <div className="row spread">
          <h3>{props.name}</h3>
          {props.variants.length > 1 && (
            <div className="swatches" role="radiogroup" aria-label={props.name}>
              {props.variants.map((x, i) => (
                <button
                  key={x.key}
                  type="button"
                  role="radio"
                  aria-checked={i === active}
                  aria-label={x.label}
                  title={x.label}
                  className={`swatch ${x.key} ${i === active ? "on" : ""}`}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
          )}
        </div>
        <p className="specs">
          <span><Icon name="users" size={15} /> {props.capacity}</span>
          <span><Icon name="bag" size={15} /> {props.luggage}</span>
        </p>
        <Link href={`/book?vehicle=${props.code}`} className="fleet-cta">
          {props.cta} <Icon name="arrow" size={16} />
        </Link>
      </div>
    </div>
  );
}
