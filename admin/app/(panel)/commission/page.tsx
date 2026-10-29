"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, localToIso, pct } from "@/lib/format";
import { COMMISSION_SCOPE } from "@/lib/labels";

interface Rule { id: number; scope: string; scope_ref_id: number | null; rate: string; valid_from: string; valid_to: string | null; is_active: boolean }
interface Named { id: number; name: string }

/** Ekran 10: komisyon kuralları. Öncelik: araç tipi, bölge, genel (K-02). */
export default function CommissionPage() {
  const isAdmin = useCan()();
  const rules = useData<Rule[]>("admin/commission-rules");
  // Bölge ve araç tipi adları operasyon uçlarından gelir; muhasebe rolünde yalnızca kimlik görünür.
  const regions = useData<Named[]>(isAdmin ? "admin/regions" : null);
  const types = useData<Named[]>(isAdmin ? "admin/vehicle-types" : null);
  const action = useAction();
  const [form, setForm] = useState({ scope: "genel", scope_ref_id: "", rate: "", valid_from: "" });

  const refName = (r: Rule) => {
    if (r.scope_ref_id === null) return "—";
    const list = r.scope === "bolge" ? regions.data : types.data;
    return list?.find((x) => x.id === r.scope_ref_id)?.name ?? `#${r.scope_ref_id}`;
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/commission-rules", {
      body: {
        scope: form.scope,
        scope_ref_id: form.scope === "genel" ? null : Number(form.scope_ref_id),
        rate: (Number(form.rate) / 100).toFixed(4),
        valid_from: localToIso(form.valid_from),
      },
    }), "Komisyon kuralı eklendi. Yalnızca yeni rezervasyonlara uygulanır.");
    if (ok) void rules.reload();
  }

  async function deactivate(id: number) {
    if (!confirm("Kural kapatılsın mı?")) return;
    if (await action.run(() => api(`admin/commission-rules/${id}/deactivate`, { body: {} }))) void rules.reload();
  }

  const refs = form.scope === "bolge" ? regions.data : form.scope === "arac_tipi" ? types.data : null;

  return (
    <div className="stack">
      <PageHead title="Komisyon kuralları" />
      <p className="hint">Örnek: %25 komisyonla 60 € işte sürücüye 45 € kalır. Oran rezervasyonda dondurulur.</p>
      <Msg message={action.message} />
      <ErrorBox error={rules.error} />
      <Table
        rows={rules.data}
        rowKey={(r) => String(r.id)}
        columns={[
          { key: "scope", title: "Kapsam", render: (r) => COMMISSION_SCOPE[r.scope] ?? r.scope },
          { key: "ref", title: "Referans", render: refName },
          { key: "rate", title: "Oran", align: "right", render: (r) => pct(r.rate) },
          { key: "from", title: "Başlangıç", render: (r) => dt(r.valid_from) },
          { key: "to", title: "Bitiş", render: (r) => dt(r.valid_to) },
          { key: "active", title: "", render: (r) => <Badge value={r.is_active ? "aktif" : "pasif"} labels={{ aktif: "Geçerli", pasif: "Kapalı" }} /> },
          { key: "act", title: "", render: (r) => isAdmin && r.is_active && <button className="btn small secondary" onClick={() => deactivate(r.id)}>Kapat</button> },
        ]}
      />
      {isAdmin && (
        <form className="card row end" onSubmit={add}>
          <Field label="Kapsam"><Select value={form.scope} onChange={(v) => setForm({ ...form, scope: v, scope_ref_id: "" })} options={COMMISSION_SCOPE} /></Field>
          {refs && (
            <Field label="Referans">
              <select required value={form.scope_ref_id} onChange={(e) => setForm({ ...form, scope_ref_id: e.target.value })}>
                <option value="">Seçin</option>
                {refs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Oran (%)"><input required type="number" step="0.01" min={0} max={99.99} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
          <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
          <button className="btn" type="submit" disabled={action.busy}>Kural ekle</button>
        </form>
      )}
    </div>
  );
}
