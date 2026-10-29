"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, ErrorBox, Field, PageHead, Select, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/labels";

interface Invoice { id: string; booking_id: string; type: string; gib_ref: string | null; status: string; issued_at: string | null; created_at: string }

/** Ekran 13: faturalar. e-Arşiv entegratörü seçilince kesim otomatik olacak (acik_konular.md). */
export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const { limit, offset, setOffset, pager } = usePager();
  const { data, error } = useData<Invoice[]>(withQuery("admin/invoices", { status, limit, offset }));

  return (
    <div className="stack">
      <PageHead title="Faturalar" />
      <p className="alert info">e-Arşiv entegratörü henüz bağlı değil. Ödenen her rezervasyon için fatura kaydı &quot;beklemede&quot; olarak oluşur.</p>
      <div className="card row end">
        <Field label="Durum">
          <Select value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={INVOICE_STATUS} empty="Tümü" />
        </Field>
      </div>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(i) => i.id}
        empty="Fatura yok."
        columns={[
          { key: "created", title: "Oluşturma", render: (i) => dt(i.created_at) },
          { key: "booking", title: "Rezervasyon", render: (i) => <Link href={`/bookings/${i.booking_id}`}>Detay</Link> },
          { key: "type", title: "Tür", render: (i) => i.type },
          { key: "gib", title: "GİB ref.", render: (i) => <span className="mono">{i.gib_ref ?? "—"}</span> },
          { key: "status", title: "Durum", render: (i) => <Badge value={i.status} labels={INVOICE_STATUS} /> },
          { key: "issued", title: "Kesim", render: (i) => dt(i.issued_at) },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
