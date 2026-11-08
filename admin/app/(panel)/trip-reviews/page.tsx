"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, Field, PageHead, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt } from "@/lib/format";

interface Row {
  booking_id: string;
  booking_code: string;
  leg_order: number;
  route: string;
  pickup_at: string;
  started_at: string | null;
  finished_at: string;
  planned_minutes: number | null;
  actual_minutes: number | null;
  early: boolean;
  distance_km: string;
  driver_name: string | null;
}

/**
 * K-55: yolculuğu müşterinin kendisinin bitirdiği bacaklar (K-48). Planlanan sürenin yarısından kısa bitenler
 * "Erken" işaretlenir; detaydan gerekçeyle mesajlar açılarak şikâyet incelenir.
 */
export default function TripReviewsPage() {
  const [filters, setFilters] = useState({ date_from: "", date_to: "" });
  const [earlyOnly, setEarlyOnly] = useState(false);
  const { limit, offset, setOffset, pager } = usePager();
  // "Yalnızca erken" sunucuda süzülür; sayfalama süzülmüş liste üzerinden yapılır.
  const { data: rows, error } = useData<Row[]>(
    withQuery("admin/trips/customer-finished", { ...filters, early: earlyOnly || undefined, limit, offset }),
  );
  const data = rows;
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };

  return (
    <div className="stack">
      <PageHead title="Müşterinin bitirdiği yolculuklar" />
      <p className="muted">
        Yolcu araçtayken yolculuğu müşteri bitirdi: tamamlandı sayılır, iade yapılmaz (K-48). Şikâyette rezervasyon
        detayından mesajları gerekçeyle açabilirsiniz.
      </p>
      <div className="card row end">
        <Field label="Bitiş (başlangıç)">
          <input type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
        </Field>
        <Field label="Bitiş (son)">
          <input type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={earlyOnly} onChange={(e) => { setEarlyOnly(e.target.checked); setOffset(0); }} />
          Yalnızca erken bitenler
        </label>
      </div>
      <ErrorBox error={error} />
      <Table
        rows={rows}
        rowKey={(r) => `${r.booking_id}-${r.leg_order}`}
        empty="Bu aralıkta müşterinin bitirdiği yolculuk yok."
        columns={[
          { key: "code", title: "Kod", render: (r) => <Link href={`/bookings/${r.booking_id}`} className="mono">{r.booking_code}</Link> },
          { key: "route", title: "Rota", render: (r) => <>{r.route}{r.leg_order > 1 && <div className="hint">{r.leg_order}. bacak</div>}</> },
          { key: "driver", title: "Sürücü", render: (r) => r.driver_name ?? "—" },
          { key: "start", title: "Yolcu alındı", render: (r) => dt(r.started_at) },
          { key: "end", title: "Bitirildi", render: (r) => dt(r.finished_at) },
          {
            key: "dur",
            title: "Süre (gerçek / plan)",
            align: "right",
            render: (r) => (
              <span className="mono">
                {r.actual_minutes ?? "—"} / {r.planned_minutes ?? "—"} dk
              </span>
            ),
          },
          { key: "km", title: "Plan km", align: "right", render: (r) => r.distance_km },
          {
            key: "flag",
            title: "Durum",
            render: (r) => (r.early ? <span className="badge warn">Erken</span> : <span className="badge">Normal</span>),
          },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
