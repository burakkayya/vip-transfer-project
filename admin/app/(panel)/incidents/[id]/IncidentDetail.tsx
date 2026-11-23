"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import {
  ACTOR_TYPE,
  INCIDENT_KIND,
  INCIDENT_LEVEL,
  INCIDENT_SOURCE,
  INCIDENT_STATUS,
  PLATFORM,
  incidentTone,
} from "@/lib/labels";
import type { IncidentRow } from "../page";

interface Occurrence {
  id: string;
  occurred_at: string;
  request_id: string | null;
  booking_id: string | null;
  booking_code: string | null;
  context: Record<string, unknown>;
}

interface Detail extends IncidentRow {
  detail: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  occurrences: Occurrence[];
}

const SCENARIO_KEYS = new Set(["request_id", "method", "route", "platform", "app", "app_version", "actor_type",
  "actor_id", "status"]);

/** Bir tekrarın senaryosu: kim, hangi uygulamadan, hangi istekte, hangi ekranda. */
function Scenario({ o }: { o: Occurrence }) {
  const c = o.context;
  const str = (k: string) => (typeof c[k] === "string" || typeof c[k] === "number" ? String(c[k]) : null);
  const extra = Object.entries(c).filter(([k]) => !SCENARIO_KEYS.has(k));
  const actor = str("actor_type");
  return (
    <div className="stack tight">
      <span>
        {actor ? ACTOR_TYPE[actor] ?? actor : "Kullanıcı bilinmiyor"}
        {str("platform") && ` · ${PLATFORM[str("platform")!] ?? str("platform")}`}
        {str("app_version") && ` · sürüm ${str("app_version")}`}
      </span>
      {str("route") && <span className="mono">{str("method")} {str("route")} {str("status") && `→ ${str("status")}`}</span>}
      {extra.length > 0 && <pre className="json">{JSON.stringify(Object.fromEntries(extra), null, 1)}</pre>}
    </div>
  );
}

/** K-83: olay ayrıntısı. "İncelemeye al" ekibe kimin baktığını gösterir; "Çözüldü" not ister. */
export default function IncidentDetail({ id }: { id: string }) {
  const { data, error, reload } = useData<Detail>(`admin/incidents/${id}`);
  const [note, setNote] = useState("");
  const action = useAction();

  async function setStatus(status: "acknowledged" | "resolved" | "open") {
    const ok = await action.run(
      () => api(`admin/incidents/${id}/status`, { body: { status, note: note.trim() || undefined } }),
      status === "resolved" ? "Olay çözüldü olarak işaretlendi." : status === "open" ? "Olay yeniden açıldı." : "Olay incelemeye alındı.",
    );
    if (ok) {
      setNote("");
      await reload();
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Yükleniyor…</p>;

  return (
    <div className="stack">
      <PageHead title={data.title}>
        <Link className="btn link" href="/incidents">← Olaylar</Link>
      </PageHead>
      <section className="card stack" aria-labelledby="incident-summary">
        <h2 id="incident-summary">Özet</h2>
        <dl className="kv">
          <dt>Seviye</dt>
          <dd><span className={`badge ${incidentTone(data.level, data.status)}`}>{INCIDENT_LEVEL[data.level] ?? data.level}</span></dd>
          <dt>Durum</dt>
          <dd>{INCIDENT_STATUS[data.status] ?? data.status}</dd>
          <dt>Kaynak</dt>
          <dd>{INCIDENT_SOURCE[data.source] ?? data.source} · {INCIDENT_KIND[data.kind] ?? data.kind}</dd>
          <dt>Kod</dt>
          <dd className="mono">{data.code}</dd>
          <dt>Tekrar</dt>
          <dd>{data.occurrence_count} kez · ilk {dt(data.first_seen_at)} · son {dt(data.last_seen_at)}</dd>
          <dt>Son e-posta</dt>
          <dd>{data.last_notified_at ? dt(data.last_notified_at) : "Gönderilmedi"}</dd>
          {data.acknowledged_at && (<><dt>İnceleyen</dt><dd>{data.acknowledged_by ?? "—"} · {dt(data.acknowledged_at)}</dd></>)}
          {data.resolved_at && (<><dt>Çözen</dt><dd>{data.resolved_by ?? "—"} · {dt(data.resolved_at)}</dd></>)}
          {data.resolution_note && (<><dt>Çözüm notu</dt><dd>{data.resolution_note}</dd></>)}
        </dl>
        {data.detail && (
          <>
            <h3>Teknik ayrıntı</h3>
            <p className="hint">Kod konumu ya da uygulamanın gönderdiği hata metni (maskelenmiş).</p>
            <pre className="json">{data.detail}</pre>
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="incident-actions">
        <h2 id="incident-actions">İşlem</h2>
        <Field label="Not" hint="Çözüldü işaretlemek için zorunlu (en az 5 karakter): ne yapıldı, neden oldu">
          <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="row">
          {data.status === "open" && (
            <button className="btn secondary" disabled={action.busy} onClick={() => void setStatus("acknowledged")}>
              İncelemeye al
            </button>
          )}
          {data.status !== "resolved" ? (
            <button className="btn" disabled={action.busy || note.trim().length < 5} onClick={() => void setStatus("resolved")}>
              Çözüldü
            </button>
          ) : (
            <button className="btn secondary" disabled={action.busy} onClick={() => void setStatus("open")}>
              Yeniden aç
            </button>
          )}
        </div>
        <Msg message={action.message} />
      </section>

      <section className="stack" aria-labelledby="incident-occurrences">
        <h2 id="incident-occurrences">Senaryo (son {data.occurrences.length} tekrar)</h2>
        <Table
          rows={data.occurrences}
          rowKey={(o) => o.id}
          empty="Tekrar kaydı yok (180 gün sonra silinir)."
          columns={[
            { key: "at", title: "Zaman", render: (o) => dt(o.occurred_at) },
            { key: "scenario", title: "Senaryo", render: (o) => <Scenario o={o} /> },
            {
              key: "booking",
              title: "Rezervasyon",
              render: (o) => (o.booking_id ? (
                <Link href={`/bookings/${encodeURIComponent(o.booking_id)}#timeline`}>{o.booking_code ?? "Rezervasyon"}</Link>
              ) : "—"),
            },
            { key: "request", title: "İstek kimliği", render: (o) => <span className="mono">{o.request_id ?? "—"}</span> },
          ]}
        />
      </section>
    </div>
  );
}
