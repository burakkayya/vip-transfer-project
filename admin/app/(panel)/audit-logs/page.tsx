"use client";

import { useState } from "react";
import { ErrorBox, Field, PageHead, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt, localToIso } from "@/lib/format";

interface Log {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: unknown;
  ip: string | null;
  created_at: string;
}

const EMPTY = { action: "", entity_type: "", entity_id: "", actor_id: "", date_from: "", date_to: "" };

/** Ekran 18: denetim kayıtları. Kayıtlar değiştirilemez (veritabanı tetikleyicisi). */
export default function AuditLogsPage() {
  const [form, setForm] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const { limit, offset, setOffset, pager } = usePager(100);
  const { data, error } = useData<Log[]>(
    withQuery("admin/audit-logs", {
      ...filters,
      date_from: localToIso(filters.date_from),
      date_to: localToIso(filters.date_to),
      limit,
      offset,
    }),
  );

  return (
    <div className="stack">
      <PageHead title="Denetim kayıtları" />
      <form className="card row end" onSubmit={(e) => { e.preventDefault(); setFilters(form); setOffset(0); }}>
        <Field label="İşlem (önek)"><input placeholder="booking." value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} /></Field>
        <Field label="Varlık türü"><input placeholder="booking" value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} /></Field>
        <Field label="Varlık kimliği"><input value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} /></Field>
        <Field label="Kullanıcı kimliği"><input value={form.actor_id} onChange={(e) => setForm({ ...form, actor_id: e.target.value })} /></Field>
        <Field label="Başlangıç"><input type="datetime-local" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></Field>
        <Field label="Bitiş"><input type="datetime-local" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></Field>
        <button className="btn" type="submit">Filtrele</button>
        <button className="btn link" type="button" onClick={() => { setForm(EMPTY); setFilters(EMPTY); }}>Temizle</button>
      </form>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(l) => l.id}
        columns={[
          { key: "at", title: "Zaman", render: (l) => dt(l.created_at) },
          { key: "action", title: "İşlem", render: (l) => <span className="mono">{l.action}</span> },
          { key: "entity", title: "Varlık", render: (l) => <span className="mono">{l.entity_type ?? "—"} {l.entity_id ?? ""}</span> },
          {
            key: "actor",
            title: "Kullanıcı",
            render: (l) => l.actor_id ? (
              <button className="btn link mono" onClick={() => { const f = { ...form, actor_id: l.actor_id! }; setForm(f); setFilters(f); }}>
                {l.actor_id.slice(0, 8)}
              </button>
            ) : "sistem",
          },
          { key: "ip", title: "IP", render: (l) => <span className="mono">{l.ip ?? "—"}</span> },
          { key: "changes", title: "Değişiklik", render: (l) => (l.changes ? <pre className="json">{JSON.stringify(l.changes, null, 1)}</pre> : "—") },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
