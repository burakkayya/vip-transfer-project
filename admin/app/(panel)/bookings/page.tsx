"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, ErrorBox, Field, PageHead, Select, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { BOOKING_STATUS, BOOKING_TYPE } from "@/lib/labels";

interface Row {
  id: string;
  booking_code: string;
  status: string;
  booking_type: string;
  pickup_at: string;
  route: string;
  total_amount: string;
  currency: string;
  customer_phone: string;
  created_at: string;
}

/** Ekran 3: rezervasyon listesi. Müşteri telefonu maskeli gelir. */
export default function BookingsPage() {
  const [filters, setFilters] = useState({ status: "", code: "", date_from: "", date_to: "" });
  const { limit, offset, setOffset, pager } = usePager();
  const { data, error } = useData<Row[]>(withQuery("admin/bookings", { ...filters, limit, offset }));
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };

  return (
    <div className="stack">
      <PageHead title="Rezervasyonlar" />
      <div className="card row end">
        <Field label="Durum">
          <Select value={filters.status} onChange={(v) => set("status", v)} options={BOOKING_STATUS} empty="Tümü" />
        </Field>
        <Field label="Kod">
          <input value={filters.code} placeholder="GA..." maxLength={8}
            onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Alış (başlangıç)">
          <input type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />
        </Field>
        <Field label="Alış (bitiş)">
          <input type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(r) => r.id}
        columns={[
          { key: "code", title: "Kod", render: (r) => <Link href={`/bookings/${r.id}`} className="mono">{r.booking_code}</Link> },
          { key: "status", title: "Durum", render: (r) => <Badge value={r.status} labels={BOOKING_STATUS} /> },
          { key: "type", title: "Tür", render: (r) => BOOKING_TYPE[r.booking_type] ?? r.booking_type },
          { key: "at", title: "Alış", render: (r) => dt(r.pickup_at) },
          { key: "route", title: "Rota", render: (r) => r.route },
          { key: "phone", title: "Müşteri", render: (r) => <span className="mono">{r.customer_phone}</span> },
          { key: "total", title: "Tutar", align: "right", render: (r) => money(r.total_amount, r.currency) },
          { key: "created", title: "Oluşturma", render: (r) => dt(r.created_at) },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
