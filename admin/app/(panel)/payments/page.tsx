"use client";

import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData, usePager } from "@/components/ui";
import { api, withQuery } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { PAYMENT_PROVIDER, PAYMENT_STATUS, REFUND_STATUS, UNKNOWN_REFUND_ACTION } from "@/lib/labels";

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
  manual: boolean;
}
/** K-74: tutar ya da para birimi denetimine takılan başarılı bildirim; kart çekilmiş olabilir. */
interface UnderReview {
  id: string;
  booking_id: string;
  booking_code: string;
  booking_status: string;
  merchant_oid: string;
  amount: string;
  currency: string;
  failure_reason: string | null;
  created_at: string;
  refunds: Refund[];
}

/** Ekran 11: ödemeler ve iadeler. Başarısız iade tekrar denenebilir; belirsiz iadede admin mutabakatla karar verir. */
export default function PaymentsPage() {
  // Düğme görünürlüğü için; asıl yetki kontrolü backend'de (REV-A-6).
  const isAdmin = useMe().roles.includes("admin");
  const [status, setStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const { limit, offset, setOffset, pager } = usePager();
  const payments = useData<Payment[]>(withQuery("admin/payments", { status, limit, offset }));
  const refunds = useData<Refund[]>(withQuery("admin/refunds", { status: refundStatus }));
  const review = useData<UnderReview[]>("admin/payments/under-review");
  const action = useAction();
  const currencyOf = (paymentId: string) =>
    payments.data?.find((p) => p.id === paymentId)?.currency ?? review.data?.find((p) => p.id === paymentId)?.currency ?? "EUR";
  function reloadAll() {
    void refunds.reload();
    void payments.reload();
    void review.reload();
  }

  async function retry(id: string, reconciled = false) {
    const ok = await action.run(async () => {
      const r = await api<{ status: string }>(`admin/refunds/${id}/retry`, { body: reconciled ? { reconciled: true } : {} });
      action.setMessage({ ok: r.status === "tamamlandi", text: `İade sonucu: ${REFUND_STATUS[r.status] ?? r.status}` });
    });
    if (ok) {
      reloadAll();
    }
  }

  /** REV-A-6: belirsiz iade, PayTR panelinde gerçekleşmediği doğrulandıktan sonra yeniden denenir (yalnızca admin). */
  async function retryUnknown(r: Refund) {
    if (!confirm(UNKNOWN_REFUND_ACTION.retryConfirm)) return;
    await retry(r.id, true);
  }

  /** REV-A-6: PayTR panelinde gerçekleşmiş görünen belirsiz iade sağlayıcı çağrılmadan kapatılır (yalnızca admin). */
  async function completeUnknown(r: Refund) {
    if (!confirm(UNKNOWN_REFUND_ACTION.completeConfirm)) return;
    const reference = prompt(UNKNOWN_REFUND_ACTION.referencePrompt)?.trim() || null;
    const ok = await action.run(
      () => api(`admin/refunds/${r.id}/mark-completed`, { body: { confirmed: true, reference } }),
      "İade tamamlandı işaretlendi.",
    );
    if (ok) {
      reloadAll();
    }
  }

  function refundActions(r: Refund) {
    if (r.manual) {
      return r.status === "beklemede" ? (
        <button className="btn small" disabled={action.busy} onClick={() => completeManual(r)}>Elle iade yapıldı</button>
      ) : null;
    }
    if (r.status === "basarisiz") {
      return <button className="btn small" disabled={action.busy} onClick={() => retry(r.id)}>Tekrar dene</button>;
    }
    if (r.status === "belirsiz") {
      if (!isAdmin) return <span className="muted">{UNKNOWN_REFUND_ACTION.adminOnly}</span>;
      return (
        <div className="row">
          <button className="btn small" disabled={action.busy} onClick={() => retryUnknown(r)}>{UNKNOWN_REFUND_ACTION.retry}</button>
          <button className="btn small" disabled={action.busy} onClick={() => completeUnknown(r)}>{UNKNOWN_REFUND_ACTION.complete}</button>
        </div>
      );
    }
    return null;
  }

  /** K-54: elle tahsilatın iadesi havale/nakit ile yapıldıktan sonra kapatılır. */
  async function completeManual(r: Refund) {
    const reference = prompt(`${money(r.amount, currencyOf(r.payment_id))} iadesi yapıldı mı? Dekont veya makbuz bilgisini yazın:`);
    if (!reference || reference.trim().length < 2) return;
    const ok = await action.run(
      () => api(`admin/refunds/${r.id}/complete-manual`, { body: { reference: reference.trim() } }),
      "Elle iade kapatıldı.",
    );
    if (ok) {
      reloadAll();
    }
  }

  return (
    <div className="stack">
      <PageHead title="Ödemeler ve iadeler" />
      <Msg message={action.message} />

      <section className="stack" aria-labelledby="h-review">
        <h2 id="h-review">İncelemedeki ödemeler</h2>
        <p className="muted">
          Tutarı ya da para birimi tutmayan başarılı bildirimler. Kart çekilmiş olabilir; iade tamamlanana kadar rezervasyon
          ödeme beklemede kalır, yeni ödeme sayfası açılmaz ve otomatik iptal edilmez.
        </p>
        <ErrorBox error={review.error} />
        <Table
          rows={review.data}
          rowKey={(p) => p.id}
          empty="İncelemede ödeme yok."
          columns={[
            { key: "created", title: "Bildirim", render: (p) => dt(p.created_at) },
            { key: "booking", title: "Rezervasyon", render: (p) => <Link href={`/bookings/${p.booking_id}`} className="mono">{p.booking_code}</Link> },
            { key: "reason", title: "Neden", render: (p) => p.failure_reason ?? "—" },
            { key: "amount", title: "Beklenen", align: "right", render: (p) => money(p.amount, p.currency) },
            {
              key: "refund",
              title: "İade",
              render: (p) =>
                p.refunds.length === 0 ? (
                  <span className="muted">İade kaydı yok</span>
                ) : (
                  <div className="stack">
                    {p.refunds.map((r) => (
                      <div key={r.id} className="row">
                        <span>{money(r.amount, p.currency)}</span>
                        <Badge value={r.status} labels={REFUND_STATUS} />
                        {refundActions(r)}
                      </div>
                    ))}
                  </div>
                ),
            },
          ]}
        />
      </section>

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
          { key: "provider", title: "Sağlayıcı", render: (p) => PAYMENT_PROVIDER[p.provider] ?? p.provider },
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
            render: refundActions,
          },
        ]}
      />
    </div>
  );
}
