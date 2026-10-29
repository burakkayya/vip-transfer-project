"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData, usePager } from "@/components/ui";
import { api, withQuery } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { PAYMENT_STATUS, REFUND_STATUS } from "@/lib/labels";

interface Payment {
  id: string;
  booking_id: string;
  provider: string;
  merchant_oid: string;
  amount: string;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  refunded: string;
}
interface Refund {
  id: string;
  payment_id: string;
  amount: string;
  refund_percent: number;
  status: string;
  reason: string;
  provider_ref: string | null;
  created_at: string;
}

/** Ekran 11: ödemeler ve iadeler. Başarısız iade tekrar denenebilir. */
export default function PaymentsPage() {
  const [status, setStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const { limit, offset, setOffset, pager } = usePager();
  const payments = useData<Payment[]>(withQuery("admin/payments", { status, limit, offset }));
  const refunds = useData<Refund[]>(withQuery("admin/refunds", { status: refundStatus }));
  const action = useAction();
  const currencyOf = (paymentId: string) => payments.data?.find((p) => p.id === paymentId)?.currency ?? "EUR";

  async function retry(id: string) {
    const ok = await action.run(async () => {
      const r = await api<{ status: string }>(`admin/refunds/${id}/retry`, { body: {} });
      action.setMessage({ ok: r.status === "tamamlandi", text: `İade sonucu: ${REFUND_STATUS[r.status] ?? r.status}` });
    });
    if (ok) void refunds.reload();
  }

  return (
    <div className="stack">
      <PageHead title="Ödemeler ve iadeler" />
      <Msg message={action.message} />

      <div className="card row end">
        <Field label="Ödeme durumu">
          <Select value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={PAYMENT_STATUS} empty="Tümü" />
        </Field>
      </div>
      <ErrorBox error={payments.error} />
      <Table
        rows={payments.data}
        rowKey={(p) => p.id}
        columns={[
          { key: "oid", title: "Sipariş no", render: (p) => <span className="mono">{p.merchant_oid}</span> },
          { key: "booking", title: "Rezervasyon", render: (p) => <Link href={`/bookings/${p.booking_id}`}>Detay</Link> },
          { key: "provider", title: "Sağlayıcı", render: (p) => p.provider },
          { key: "amount", title: "Tutar", align: "right", render: (p) => money(p.amount, p.currency) },
          { key: "refunded", title: "İade", align: "right", render: (p) => (Number(p.refunded) ? money(p.refunded, p.currency) : "—") },
          { key: "status", title: "Durum", render: (p) => <Badge value={p.status} labels={PAYMENT_STATUS} /> },
          { key: "paid", title: "Ödeme", render: (p) => dt(p.paid_at) },
          { key: "created", title: "Deneme", render: (p) => dt(p.created_at) },
        ]}
      />
      {pager(payments.data?.length)}

      <h2>İadeler</h2>
      <div className="card row end">
        <Field label="İade durumu">
          <Select value={refundStatus} onChange={setRefundStatus} options={REFUND_STATUS} empty="Tümü" />
        </Field>
      </div>
      <ErrorBox error={refunds.error} />
      <Table
        rows={refunds.data}
        rowKey={(r) => r.id}
        empty="İade yok."
        columns={[
          { key: "created", title: "Tarih", render: (r) => dt(r.created_at) },
          { key: "amount", title: "Tutar", align: "right", render: (r) => money(r.amount, currencyOf(r.payment_id)) },
          { key: "pct", title: "Oran", align: "right", render: (r) => `%${r.refund_percent}` },
          { key: "reason", title: "Gerekçe", render: (r) => r.reason },
          { key: "ref", title: "Sağlayıcı ref.", render: (r) => <span className="mono">{r.provider_ref ?? "—"}</span> },
          { key: "status", title: "Durum", render: (r) => <Badge value={r.status} labels={REFUND_STATUS} /> },
          {
            key: "act",
            title: "",
            render: (r) => r.status === "basarisiz" && (
              <button className="btn small" disabled={action.busy} onClick={() => retry(r.id)}>Tekrar dene</button>
            ),
          },
        ]}
      />
    </div>
  );
}
