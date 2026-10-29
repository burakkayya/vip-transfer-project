"use client";

import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api, withQuery } from "@/lib/api";
import { dt } from "@/lib/format";
import { DATA_REQUEST_STATUS, DATA_REQUEST_TYPE } from "@/lib/labels";

interface Req {
  id: string;
  customer_id: string;
  request_type: string;
  status: string;
  note: string | null;
  due_at: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Ekran 16: KVKK/GDPR veri talepleri. Yasal süre 30 gün.
 * Silme talebinde kişisel veriler Müşteriler ekranından admin tarafından silinir.
 */
export default function DataRequestsPage() {
  const [status, setStatus] = useState("acik");
  const { data, error, reload } = useData<Req[]>(withQuery("admin/data-requests", { status }));
  const action = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const now = Date.now();

  async function update(r: Req, next: string) {
    const ok = await action.run(
      () => api(`admin/data-requests/${r.id}`, { body: { status: next, note: notes[r.id]?.trim() || null } }),
      `Talep: ${DATA_REQUEST_STATUS[next]}`,
    );
    if (ok) void reload();
  }

  return (
    <div className="stack">
      <PageHead title="KVKK veri talepleri" />
      <Msg message={action.message} />
      <div className="card row end">
        <Field label="Durum">
          <Select value={status} onChange={setStatus} options={DATA_REQUEST_STATUS} empty="Tümü" />
        </Field>
      </div>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(r) => r.id}
        empty="Talep yok."
        columns={[
          { key: "created", title: "Başvuru", render: (r) => dt(r.created_at) },
          { key: "type", title: "Tür", render: (r) => DATA_REQUEST_TYPE[r.request_type] ?? r.request_type },
          { key: "customer", title: "Müşteri", render: (r) => <span className="mono">{r.customer_id.slice(0, 8)}</span> },
          {
            key: "due",
            title: "Son tarih",
            render: (r) => (
              <span style={{ color: !r.completed_at && new Date(r.due_at).getTime() < now + 5 * 86400_000 ? "var(--danger)" : undefined }}>
                {dt(r.due_at)}
              </span>
            ),
          },
          { key: "status", title: "Durum", render: (r) => <Badge value={r.status} labels={DATA_REQUEST_STATUS} /> },
          { key: "note", title: "Not", render: (r) => r.note ?? "—" },
          {
            key: "act",
            title: "",
            render: (r) => !r.completed_at && (
              <div className="row">
                <input placeholder="Not" style={{ width: 140 }} value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                {r.status === "acik" && <button className="btn small secondary" onClick={() => update(r, "isleniyor")}>İşleme al</button>}
                <button className="btn small" onClick={() => update(r, "tamamlandi")}>Tamamla</button>
                <button className="btn small danger" onClick={() => update(r, "reddedildi")}>Reddet</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
