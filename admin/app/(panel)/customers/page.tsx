"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { ErrorBox, Field, Msg, PageHead, Table, useAction, useData, usePager } from "@/components/ui";
import { api, withQuery } from "@/lib/api";
import { dt } from "@/lib/format";

interface Customer {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  country_code: string | null;
  locale: string;
  currency: string;
  booking_count: number;
  created_at: string;
  deleted: boolean;
}

/** Ekran 14: müşteriler. Hassas alanlar maskeli; telefonla yalnızca tam eşleşme araması yapılır. */
export default function CustomersPage() {
  const isAdmin = useCan()();
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const { limit, offset, setOffset, pager } = usePager();
  const { data, error, reload } = useData<Customer[]>(withQuery("admin/customers", { phone: query, limit, offset }));
  const action = useAction();

  async function anonymize(c: Customer) {
    if (!confirm("Müşterinin kişisel verileri kalıcı olarak silinecek. Rezervasyon ve fatura kayıtları saklanır. Devam edilsin mi?")) return;
    const ok = await action.run(() => api(`admin/customers/${c.id}/anonymize`, { body: {} }), "Kişisel veriler silindi.");
    if (ok) void reload();
  }

  return (
    <div className="stack">
      <PageHead title="Müşteriler" />
      <Msg message={action.message} />
      <form className="card row end" onSubmit={(e) => { e.preventDefault(); setQuery(phone.trim()); setOffset(0); }}>
        <Field label="Telefon (tam numara)" hint="Uluslararası biçimde: +4915112345678">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+90..." />
        </Field>
        <button className="btn" type="submit">Ara</button>
        {query && <button className="btn link" type="button" onClick={() => { setPhone(""); setQuery(""); }}>Temizle</button>}
      </form>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(c) => c.id}
        columns={[
          { key: "name", title: "Ad", render: (c) => (c.deleted ? <span className="badge danger">Silindi</span> : c.full_name ?? "—") },
          { key: "phone", title: "Telefon", render: (c) => <span className="mono">{c.phone || "—"}</span> },
          { key: "email", title: "E-posta", render: (c) => <span className="mono">{c.email ?? "—"}</span> },
          { key: "country", title: "Ülke / dil", render: (c) => `${c.country_code ?? "—"} · ${c.locale} · ${c.currency}` },
          { key: "count", title: "Rezervasyon", align: "right", render: (c) => c.booking_count },
          { key: "created", title: "Kayıt", render: (c) => dt(c.created_at) },
          {
            key: "act",
            title: "",
            render: (c) => isAdmin && !c.deleted && (
              <button className="btn small danger" disabled={action.busy} onClick={() => anonymize(c)}>Verileri sil</button>
            ),
          },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
