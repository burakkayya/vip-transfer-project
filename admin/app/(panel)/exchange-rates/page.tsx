"use client";

import { useState } from "react";
import { ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, localToIso } from "@/lib/format";

interface Rate { id: number; base: string; quote: string; rate: string; source: string; valid_from: string }

/** EUR/TRY kuru. TRY fiyatları ve EUR hakedişlerinin TL karşılığı bu kurla hesaplanır. */
export default function ExchangeRatesPage() {
  const { data, error, reload } = useData<Rate[]>("admin/exchange-rates");
  const action = useAction();
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(
      () => api("admin/exchange-rates", { body: { rate, valid_from: localToIso(validFrom) } }),
      "Kur eklendi.",
    );
    if (ok) {
      setRate("");
      void reload();
    }
  }

  return (
    <div className="stack">
      <PageHead title="Döviz kuru (EUR/TRY)" />
      <p className="hint">Kur kaynağı (manuel veya TCMB) açık konudur, şimdilik elle girilir. TRY rezervasyonlar kuru dondurur.</p>
      <Msg message={action.message} />
      <form className="card row end" onSubmit={add}>
        <Field label="1 EUR = ? TRY"><input required type="number" step="0.0001" min="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <button className="btn" type="submit" disabled={action.busy}>Kur ekle</button>
      </form>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(r) => String(r.id)}
        empty="Kur girilmemiş. TRY fiyat gösterilemez."
        columns={[
          { key: "pair", title: "Parite", render: (r) => `${r.base}/${r.quote}` },
          { key: "rate", title: "Kur", align: "right", render: (r) => Number(r.rate).toLocaleString("tr-TR", { minimumFractionDigits: 4 }) },
          { key: "src", title: "Kaynak", render: (r) => r.source },
          { key: "from", title: "Geçerlilik", render: (r) => dt(r.valid_from) },
        ]}
      />
    </div>
  );
}
