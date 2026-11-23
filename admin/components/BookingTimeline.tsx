"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, Msg, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { ACTOR_TYPE, DATA_KEY, PLATFORM, timelineLabel } from "@/lib/labels";

interface Item {
  at: string;
  source: "activity" | "trip_event" | "audit" | "incident" | "notification";
  event: string;
  actor_type: string;
  actor_id: string | null;
  actor_name?: string | null;
  leg_order: number | null;
  platform: string | null;
  app_version: string | null;
  request_id: string | null;
  data: Record<string, unknown>;
  location: { lat: number; lng: number } | null;
}

interface Timeline {
  booking_code: string;
  retention: { activity_days: number; location_days: number };
  items: Item[];
}

// Ayrıntıda gösterilmeyen teknik anahtarlar (kimlikler satırın kendisinde ya da başka ekranda).
const HIDDEN = new Set(["payment_id", "incident_id", "driver_id", "vehicle_id", "customer_id"]);

function details(item: Item): string {
  return Object.entries(item.data)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${DATA_KEY[k] ?? k}: ${v === true ? "evet" : v === false ? "hayır" : ACTOR_TYPE[String(v)] ?? String(v)}`)
    .join(" · ");
}

function actorText(item: Item): string {
  const who = ACTOR_TYPE[item.actor_type] ?? item.actor_type;
  if (item.actor_type === "staff" && item.actor_name) return `${who} (${item.actor_name})`;
  return who;
}

/**
 * K-83: rezervasyonun adım adım geçmişi (müşteri, sürücü, personel, sistem). Kişisel ayrıntı (aktör, konum)
 * içerdiği için yalnızca gerekçe yazılarak açılır; her açılış gerekçesiyle denetim kaydına düşer. Konum yalnızca
 * önemli anlarda (vardı, bitti, yolcu gelmedi) tutulur ve 180 gün sonra silinir.
 */
export default function BookingTimeline({ bookingId }: { bookingId: string }) {
  const [reason, setReason] = useState("");
  const [data, setData] = useState<Timeline | null>(null);
  const action = useAction();

  async function open() {
    await action.run(async () => {
      setData(await api<Timeline>(`admin/bookings/${bookingId}/timeline`, { body: { reason: reason.trim() } }));
    });
  }

  return (
    <section className="card stack" id="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Yolculuk geçmişi</h2>
      {!data ? (
        <>
          <p className="hint">
            Müşteri, sürücü ve personelin bu rezervasyondaki her adımı; hatalar ve giden bildirimler. Kişisel ayrıntı
            içerir: yalnızca şikâyet, talep ya da olay incelemesi için açın. Gerekçe denetim kaydına yazılır.
          </p>
          <form className="row end" onSubmit={(e) => { e.preventDefault(); void open(); }}>
            <div className="grow">
              <Field label="Gerekçe (şikâyet / talep / olay referansı)" hint="En az 5 karakter; denetim kaydına yazılır">
                <input value={reason} maxLength={300} placeholder="ör. Şikâyet #42: sürücü geç geldi"
                  onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <button className="btn secondary" type="submit" disabled={action.busy || reason.trim().length < 5}>
              Geçmişi göster
            </button>
          </form>
          <Msg message={action.message} />
        </>
      ) : (
        <>
          <p className="hint">
            Adımlar {data.retention.activity_days} gün, konumlar {data.retention.location_days} gün saklanır. Bu
            görüntüleme denetim kaydına yazıldı.
          </p>
          {data.items.length === 0 ? (
            <p className="muted">Kayıtlı adım yok.</p>
          ) : (
            <ol className="timeline" aria-label={`${data.booking_code} yolculuk geçmişi`}>
              {data.items.map((item, i) => (
                <li key={`${item.at}-${i}`} className={item.source === "incident" ? "timeline-incident" : undefined}>
                  <div className="timeline-meta">
                    <span className="mono">{dt(item.at)}</span>
                    {item.leg_order !== null && <span className="hint">{item.leg_order}. bacak</span>}
                  </div>
                  <div className="stack tight">
                    <strong>{timelineLabel(item.event)}</strong>
                    <span className="hint">
                      {actorText(item)}
                      {item.platform && ` · ${PLATFORM[item.platform] ?? item.platform}`}
                      {item.app_version && ` ${item.app_version}`}
                    </span>
                    {details(item) && <span className="hint">{details(item)}</span>}
                    {item.location && (
                      // Koordinat dış servise gönderilmez (K-83); gerekirse kopyalanıp elle açılır.
                      <span className="hint">
                        Konum: <span className="mono">{item.location.lat.toFixed(5)}, {item.location.lng.toFixed(5)}</span>
                      </span>
                    )}
                    {item.source === "incident" && typeof item.data.incident_id === "string" && (
                      <Link href={`/incidents/${encodeURIComponent(item.data.incident_id)}`}>Olayı aç</Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
