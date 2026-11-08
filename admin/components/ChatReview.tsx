"use client";

import { useState } from "react";
import { Field, Msg, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";

interface Review {
  retention_days: number;
  legs: { leg_id: string; leg_order: number; driver_name: string | null; passenger_name: string }[];
  messages: { id: string; leg_id: string; sender: "customer" | "driver"; body: string; created_at: string; read_at: string | null; driver_name: string | null }[];
}

/**
 * K-55: şikâyet incelemesi için müşteri–sürücü yazışması. Kişisel veri içerdiği için yalnızca gerekçe (şikâyet
 * referansı) yazılarak açılır; her açılış denetim kaydına düşer. Personel okuması taraflara "okundu" göstermez.
 */
export default function ChatReview(props: { bookingId: string }) {
  const [reason, setReason] = useState("");
  const [data, setData] = useState<Review | null>(null);
  const action = useAction();

  async function open() {
    await action.run(async () => {
      setData(await api<Review>(`admin/bookings/${props.bookingId}/messages`, { body: { reason: reason.trim() } }));
    });
  }

  const multi = (data?.legs.length ?? 0) > 1;

  return (
    <section className="card stack" aria-labelledby="chat-review-title">
      <h2 id="chat-review-title">Müşteri–sürücü mesajları</h2>
      {!data ? (
        <>
          <p className="hint">
            Yazışma kişisel veri içerir. Yalnızca şikâyet veya talep incelemesi için açın; gerekçe denetim kaydına yazılır.
          </p>
          <form className="row end" onSubmit={(e) => { e.preventDefault(); void open(); }}>
            <div className="grow">
              <Field label="Gerekçe (şikâyet / talep referansı)" hint="En az 5 karakter; denetim kaydına yazılır">
                <input value={reason} maxLength={300} placeholder="ör. Şikâyet #42: erken bitirme"
                  onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <button className="btn secondary" type="submit" disabled={action.busy || reason.trim().length < 5}>
              Mesajları göster
            </button>
          </form>
          <Msg message={action.message} />
        </>
      ) : data.messages.length === 0 ? (
        <p className="muted">
          Bu rezervasyonda mesaj yok. Mesajlar yolculuktan {data.retention_days} gün sonra silinir.
        </p>
      ) : (
        <>
          <p className="hint">Mesajlar yolculuktan {data.retention_days} gün sonra silinir. Bu görüntüleme denetim kaydına yazıldı.</p>
          {data.legs.map((leg) => {
            const rows = data.messages.filter((m) => m.leg_id === leg.leg_id);
            if (rows.length === 0) return null;
            return (
              <div key={leg.leg_id} className="stack">
                {multi && <h3>{leg.leg_order}. bacak</h3>}
                <ol className="transcript" aria-label={`${leg.leg_order}. bacak mesajları`}>
                  {rows.map((m) => (
                    <li key={m.id} className={m.sender}>
                      <div className="transcript-meta">
                        <strong>{m.sender === "driver" ? `Sürücü · ${m.driver_name ?? leg.driver_name ?? "—"}` : `Müşteri · ${leg.passenger_name}`}</strong>
                        <span className="mono">{dt(m.created_at)}</span>
                        {m.read_at && <span className="hint">okundu {dt(m.read_at)}</span>}
                      </div>
                      <p>{m.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
