"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, localToIso, money } from "@/lib/format";
import { DISCOUNT_TYPE } from "@/lib/labels";

interface Rule {
  id: number;
  vehicle_type_id: number;
  base_price_per_km: string;
  minimum_price: string;
  rounding_step: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}
interface Discount { id: number; type: string; value: string; valid_from: string; valid_to: string | null; is_active: boolean }
interface Policy { id: number; name: string; valid_from: string; is_active: boolean; tiers: { hours_before_pickup: number; refund_percent: number }[] }
interface VT { id: number; code: string; name: string }

const active = (x: { is_active: boolean }) => <Badge value={x.is_active ? "aktif" : "pasif"} labels={{ aktif: "Geçerli", pasif: "Kapalı" }} />;

/**
 * Ekran 9: fiyat kuralları, gidiş-dönüş indirimi, iptal politikaları.
 * Kurallar düzenlenmez, yeni sürüm eklenir; rezervasyonlar hesaplandıkları kuralı dondurur.
 */
export default function PricingPage() {
  const can = useCan();
  const isAdmin = can();
  const rules = useData<Rule[]>("admin/pricing-rules");
  const discounts = useData<Discount[]>("admin/round-trip-discounts");
  const policies = useData<Policy[]>("admin/cancellation-policies");
  const types = useData<VT[]>("admin/vehicle-types");
  const action = useAction();
  const vtName = (id: number) => types.data?.find((t) => t.id === id)?.name ?? id;

  const [rule, setRule] = useState({ vehicle_type_id: "", base_price_per_km: "1.10", minimum_price: "30", rounding_step: "5", valid_from: "" });
  const [discount, setDiscount] = useState({ type: "yuzde", value: "", valid_from: "" });
  const [policy, setPolicy] = useState({ name: "", tiers: [{ h: "48", p: "100" }, { h: "24", p: "50" }, { h: "0", p: "0" }], valid_from: "" });

  async function deactivate(path: string, reload: () => Promise<void>) {
    if (!confirm("Bu kural kapatılsın mı? Geçmiş rezervasyonlar etkilenmez.")) return;
    if (await action.run(() => api(path, { body: {} }), "Kapatıldı.")) void reload();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/pricing-rules", {
      body: { ...rule, vehicle_type_id: Number(rule.vehicle_type_id), valid_from: localToIso(rule.valid_from) },
    }), "Fiyat kuralı eklendi.");
    if (ok) void rules.reload();
  }

  async function addDiscount(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/round-trip-discounts", {
      body: { ...discount, valid_from: localToIso(discount.valid_from) },
    }), "İndirim eklendi.");
    if (ok) void discounts.reload();
  }

  async function addPolicy(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/cancellation-policies", {
      body: {
        name: policy.name,
        valid_from: localToIso(policy.valid_from),
        tiers: policy.tiers.map((t) => ({ hours_before_pickup: Number(t.h), refund_percent: Number(t.p) })),
      },
    }), "İptal politikası eklendi. Yalnızca yeni rezervasyonlara uygulanır.");
    if (ok) void policies.reload();
  }

  return (
    <div className="stack">
      <PageHead title="Fiyatlandırma" />
      <p className="hint">Formül: km × km fiyatı × araç çarpanı, minimum fiyat kontrolü, yuvarlama adımına yukarı yuvarlama (K-03, K-04).</p>
      <Msg message={action.message} />

      <h2>Fiyat kuralları</h2>
      <ErrorBox error={rules.error} />
      <Table
        rows={rules.data}
        rowKey={(r) => String(r.id)}
        columns={[
          { key: "vt", title: "Araç tipi", render: (r) => vtName(r.vehicle_type_id) },
          { key: "km", title: "Km fiyatı", align: "right", render: (r) => money(r.base_price_per_km, "EUR") },
          { key: "min", title: "Minimum", align: "right", render: (r) => money(r.minimum_price, "EUR") },
          { key: "step", title: "Yuvarlama", align: "right", render: (r) => r.rounding_step },
          { key: "from", title: "Başlangıç", render: (r) => dt(r.valid_from) },
          { key: "to", title: "Bitiş", render: (r) => dt(r.valid_to) },
          { key: "active", title: "", render: active },
          { key: "act", title: "", render: (r) => isAdmin && r.is_active && <button className="btn small secondary" onClick={() => deactivate(`admin/pricing-rules/${r.id}/deactivate`, rules.reload)}>Kapat</button> },
        ]}
      />
      {isAdmin && (
        <form className="card row end" onSubmit={addRule}>
          <Field label="Araç tipi">
            <select required value={rule.vehicle_type_id} onChange={(e) => setRule({ ...rule, vehicle_type_id: e.target.value })}>
              <option value="">Seçin</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Km fiyatı (€)"><input required type="number" step="0.01" min="0.01" value={rule.base_price_per_km} onChange={(e) => setRule({ ...rule, base_price_per_km: e.target.value })} /></Field>
          <Field label="Minimum (€)"><input required type="number" step="0.01" min="0" value={rule.minimum_price} onChange={(e) => setRule({ ...rule, minimum_price: e.target.value })} /></Field>
          <Field label="Yuvarlama adımı"><input required type="number" step="0.01" min="0.01" value={rule.rounding_step} onChange={(e) => setRule({ ...rule, rounding_step: e.target.value })} /></Field>
          <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={rule.valid_from} onChange={(e) => setRule({ ...rule, valid_from: e.target.value })} /></Field>
          <button className="btn" type="submit" disabled={action.busy}>Yeni kural ekle</button>
        </form>
      )}

      <h2>Gidiş-dönüş indirimi</h2>
      <ErrorBox error={discounts.error} />
      <Table
        rows={discounts.data}
        rowKey={(r) => String(r.id)}
        empty="Tanımlı indirim yok (gidiş-dönüş tam fiyat)."
        columns={[
          { key: "type", title: "Tür", render: (r) => DISCOUNT_TYPE[r.type] ?? r.type },
          { key: "value", title: "Değer", align: "right", render: (r) => (r.type === "yuzde" ? `%${r.value}` : money(r.value, "EUR")) },
          { key: "from", title: "Başlangıç", render: (r) => dt(r.valid_from) },
          { key: "to", title: "Bitiş", render: (r) => dt(r.valid_to) },
          { key: "active", title: "", render: active },
          { key: "act", title: "", render: (r) => isAdmin && r.is_active && <button className="btn small secondary" onClick={() => deactivate(`admin/round-trip-discounts/${r.id}/deactivate`, discounts.reload)}>Kapat</button> },
        ]}
      />
      {isAdmin && (
        <form className="card row end" onSubmit={addDiscount}>
          <Field label="Tür"><Select value={discount.type} onChange={(v) => setDiscount({ ...discount, type: v })} options={DISCOUNT_TYPE} /></Field>
          <Field label="Değer"><input required type="number" step="0.01" min="0" max={discount.type === "yuzde" ? 100 : undefined} value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} /></Field>
          <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={discount.valid_from} onChange={(e) => setDiscount({ ...discount, valid_from: e.target.value })} /></Field>
          <button className="btn" type="submit" disabled={action.busy}>İndirim ekle</button>
        </form>
      )}

      <h2>İptal politikaları</h2>
      <ErrorBox error={policies.error} />
      <Table
        rows={policies.data}
        rowKey={(r) => String(r.id)}
        columns={[
          { key: "name", title: "Ad", render: (r) => r.name },
          { key: "tiers", title: "Kademeler", render: (r) => r.tiers.map((t) => `≥${t.hours_before_pickup} sa → %${t.refund_percent}`).join(" · ") },
          { key: "from", title: "Başlangıç", render: (r) => dt(r.valid_from) },
          { key: "active", title: "", render: active },
        ]}
      />
      {isAdmin && (
        <form className="card stack" onSubmit={addPolicy}>
          <div className="row end">
            <Field label="Politika adı"><input required maxLength={100} value={policy.name} onChange={(e) => setPolicy({ ...policy, name: e.target.value })} /></Field>
            <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={policy.valid_from} onChange={(e) => setPolicy({ ...policy, valid_from: e.target.value })} /></Field>
          </div>
          {policy.tiers.map((t, i) => (
            <div key={i} className="row end">
              <Field label="Alıştan en az (saat)"><input required type="number" min={0} value={t.h} onChange={(e) => setPolicy({ ...policy, tiers: policy.tiers.map((x, j) => (j === i ? { ...x, h: e.target.value } : x)) })} /></Field>
              <Field label="İade (%)"><input required type="number" min={0} max={100} value={t.p} onChange={(e) => setPolicy({ ...policy, tiers: policy.tiers.map((x, j) => (j === i ? { ...x, p: e.target.value } : x)) })} /></Field>
              <button type="button" className="btn link" onClick={() => setPolicy({ ...policy, tiers: policy.tiers.filter((_, j) => j !== i) })}>Kaldır</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn secondary small" onClick={() => setPolicy({ ...policy, tiers: [...policy.tiers, { h: "", p: "" }] })}>Kademe ekle</button>
            <button className="btn" type="submit" disabled={action.busy}>Politika ekle</button>
          </div>
          <p className="hint">0 saat kademesi zorunludur (son kademe).</p>
        </form>
      )}
    </div>
  );
}
