"use client";

import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData, usePager } from "@/components/ui";
import { api, download, withQuery } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { LEDGER_STATUS, PAYOUT_STATUS } from "@/lib/labels";

interface Entry {
  id: string;
  driver_id: string;
  leg_id: string;
  gross: string;
  commission: string;
  net: string;
  currency: string;
  net_try: string | null;
  status: string;
  created_at: string;
}
interface Payout { id: string; driver_id: string; total_try: string; status: string; paid_at: string | null; created_at: string }

/**
 * Ekran 12: sürücü hakedişleri ve ödeme dosyaları. Otomatik aktarım (split) açılana kadar
 * ödeme, banka toplu ödeme dosyasıyla yapılır ve burada "ödendi" işaretlenir.
 */
export default function PayoutsPage() {
  const [ledgerStatus, setLedgerStatus] = useState("beklemede");
  const { limit, offset, setOffset, pager } = usePager();
  const ledger = useData<Entry[]>(withQuery("admin/ledger", { status: ledgerStatus, limit, offset }));
  const payouts = useData<Payout[]>("admin/payouts");
  const action = useAction();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const short = (id: string) => id.slice(0, 8);

  async function createPayouts() {
    if (!confirm("Bekleyen tüm hakedişler sürücü bazında ödeme kaydına dönüştürülsün mü?")) return;
    const ok = await action.run(async () => {
      const r = await api<Payout[]>("admin/payouts", { body: {} });
      action.setMessage({ ok: true, text: `${r.length} ödeme kaydı oluşturuldu.` });
    });
    if (ok) {
      void ledger.reload();
      void payouts.reload();
    }
  }

  async function markPaid(id: string) {
    const ok = await action.run(
      () => api(withQuery(`admin/payouts/${id}/mark-paid`, { provider_ref: refs[id] }), { body: {} }),
      "Ödendi olarak işaretlendi.",
    );
    if (ok) {
      void payouts.reload();
      void ledger.reload();
    }
  }

  return (
    <div className="stack">
      <PageHead title="Sürücü hakedişleri">
        <button className="btn" onClick={createPayouts} disabled={action.busy}>Ödeme kayıtlarını oluştur</button>
        <button className="btn secondary" disabled={action.busy}
          onClick={() => action.run(() => download("admin/payouts/export.csv", "hakedis.csv"))}>
          Banka dosyası (CSV)
        </button>
      </PageHead>
      <p className="hint">Banka dosyası IBAN içerir; indirme denetim kaydına yazılır. EUR hakedişleri ödeme kaydı oluşturulurken güncel kurla TL&apos;ye çevrilir.</p>
      <Msg message={action.message} />

      <h2>Ödeme kayıtları</h2>
      <ErrorBox error={payouts.error} />
      <Table
        rows={payouts.data}
        rowKey={(p) => p.id}
        empty="Ödeme kaydı yok."
        columns={[
          { key: "id", title: "Kayıt", render: (p) => <span className="mono">{short(p.id)}</span> },
          { key: "driver", title: "Sürücü", render: (p) => <a href={`/drivers/${p.driver_id}`}>{short(p.driver_id)}</a> },
          { key: "total", title: "Toplam", align: "right", render: (p) => money(p.total_try, "TRY") },
          { key: "status", title: "Durum", render: (p) => <Badge value={p.status} labels={PAYOUT_STATUS} /> },
          { key: "created", title: "Oluşturma", render: (p) => dt(p.created_at) },
          { key: "paid", title: "Ödeme", render: (p) => dt(p.paid_at) },
          {
            key: "act",
            title: "",
            render: (p) => p.status === "beklemede" && (
              <div className="row">
                <input placeholder="Dekont / ref." style={{ width: 130 }} value={refs[p.id] ?? ""}
                  onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })} />
                <button className="btn small" disabled={action.busy} onClick={() => markPaid(p.id)}>Ödendi</button>
              </div>
            ),
          },
        ]}
      />

      <h2>Hakediş kayıtları</h2>
      <div className="card row end">
        <Field label="Durum">
          <Select value={ledgerStatus} onChange={(v) => { setLedgerStatus(v); setOffset(0); }} options={LEDGER_STATUS} empty="Tümü" />
        </Field>
      </div>
      <ErrorBox error={ledger.error} />
      <Table
        rows={ledger.data}
        rowKey={(e) => e.id}
        empty="Kayıt yok."
        columns={[
          { key: "created", title: "Tarih", render: (e) => dt(e.created_at) },
          { key: "driver", title: "Sürücü", render: (e) => <a href={`/drivers/${e.driver_id}`}>{short(e.driver_id)}</a> },
          { key: "gross", title: "Brüt", align: "right", render: (e) => money(e.gross, e.currency) },
          { key: "comm", title: "Komisyon", align: "right", render: (e) => money(e.commission, e.currency) },
          { key: "net", title: "Net", align: "right", render: (e) => money(e.net, e.currency) },
          { key: "try", title: "Net (TL)", align: "right", render: (e) => (e.net_try ? money(e.net_try, "TRY") : "kur bekliyor") },
          { key: "status", title: "Durum", render: (e) => <Badge value={e.status} labels={LEDGER_STATUS} /> },
        ]}
      />
      {pager(ledger.data?.length)}
    </div>
  );
}
