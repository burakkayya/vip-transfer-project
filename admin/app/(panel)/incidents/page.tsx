"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, Field, PageHead, Select, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt } from "@/lib/format";
import { INCIDENT_KIND, INCIDENT_LEVEL, INCIDENT_SOURCE, INCIDENT_STATUS, incidentTone } from "@/lib/labels";

export interface IncidentRow {
  id: string;
  level: string;
  source: string;
  kind: string;
  code: string;
  title: string;
  status: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  last_notified_at: string | null;
}

const STATUS_FILTER: Record<string, string> = { active: "Çözülmemiş", ...INCIDENT_STATUS };

/**
 * K-83: olaylar. Aynı hata tek satırda toplanır (tekrar sayısı); yeni ya da yeniden açılan hata ve kritik olaylar
 * e-postayla da bildirilir. Ayrıntıda her tekrarın senaryosu (istek, platform, ilgili rezervasyon) görünür.
 */
export default function IncidentsPage() {
  const [status, setStatus] = useState("active");
  const [level, setLevel] = useState("");
  const [source, setSource] = useState("");
  const { limit, offset, setOffset, pager } = usePager(50);
  const { data, error } = useData<{ total: number; items: IncidentRow[] }>(
    withQuery("admin/incidents", { status, level, source, limit, offset }),
  );

  return (
    <div className="stack">
      <PageHead title="Olaylar" />
      <p className="hint">
        Sunucu, zamanlanmış işler, web sitesi, admin paneli ve mobil uygulamalardaki hatalar. Ayrıntı kişisel veri
        içermeyecek biçimde maskelenir.
      </p>
      <div className="card row end">
        <Field label="Durum">
          <Select value={status} options={STATUS_FILTER} onChange={(v) => { setStatus(v); setOffset(0); }} />
        </Field>
        <Field label="Seviye">
          <Select value={level} options={INCIDENT_LEVEL} empty="Tümü" onChange={(v) => { setLevel(v); setOffset(0); }} />
        </Field>
        <Field label="Kaynak">
          <Select value={source} options={INCIDENT_SOURCE} empty="Tümü" onChange={(v) => { setSource(v); setOffset(0); }} />
        </Field>
      </div>
      <ErrorBox error={error} />
      {data && <p className="muted">{data.total} olay</p>}
      <Table
        rows={data?.items ?? (error ? [] : null)}
        rowKey={(i) => i.id}
        empty="Bu süzgece uyan olay yok."
        columns={[
          {
            key: "level",
            title: "Seviye",
            render: (i) => <span className={`badge ${incidentTone(i.level, i.status)}`}>{INCIDENT_LEVEL[i.level] ?? i.level}</span>,
          },
          {
            key: "title",
            title: "Olay",
            render: (i) => (
              <div className="stack tight">
                <Link href={`/incidents/${encodeURIComponent(i.id)}`}>{i.title}</Link>
                <span className="hint">{INCIDENT_KIND[i.kind] ?? i.kind} · {INCIDENT_SOURCE[i.source] ?? i.source}</span>
              </div>
            ),
          },
          { key: "count", title: "Tekrar", align: "right", render: (i) => i.occurrence_count },
          { key: "last", title: "Son görülme", render: (i) => dt(i.last_seen_at) },
          { key: "status", title: "Durum", render: (i) => INCIDENT_STATUS[i.status] ?? i.status },
        ]}
      />
      {pager(data?.items.length)}
    </div>
  );
}
