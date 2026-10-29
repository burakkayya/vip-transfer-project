"use client";

import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";

interface Region {
  id: number;
  code: string;
  province: string;
  name: string;
  type: string;
  iata_code: string | null;
  latitude: string;
  longitude: string;
  is_active: boolean;
}

const PROVINCES = { antalya: "Antalya", mugla: "Muğla" };
const TYPES = { ilce: "İlçe", havalimani: "Havalimanı" };
const EMPTY = { code: "", province: "antalya", name: "", type: "ilce", iata_code: "", latitude: "", longitude: "", is_active: true };

/** Ekran 8: ilçe ve havalimanı yönetimi. Konum, mesafe hesabında bölge merkezi olarak kullanılır. */
export default function RegionsPage() {
  const { data, error, reload } = useData<Region[]>("admin/regions");
  const action = useAction();
  const [form, setForm] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [filter, setFilter] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { id, ...rest } = form;
    const body = { ...rest, iata_code: rest.iata_code || null };
    const ok = await action.run(
      () => api(id ? `admin/regions/${id}` : "admin/regions", { method: id ? "PUT" : "POST", body }),
      "Bölge kaydedildi.",
    );
    if (ok) {
      setForm(null);
      void reload();
    }
  }

  async function toggle(r: Region) {
    const { id, ...rest } = r;
    const ok = await action.run(() => api(`admin/regions/${id}`, { method: "PUT", body: { ...rest, is_active: !r.is_active } }));
    if (ok) void reload();
  }

  const rows = data?.filter((r) => !filter || r.province === filter) ?? null;

  return (
    <div className="stack">
      <PageHead title="Bölgeler">
        <Select value={filter} onChange={setFilter} options={PROVINCES} empty="Tüm iller" />
        {!form && <button className="btn small" onClick={() => setForm({ ...EMPTY })}>Yeni bölge</button>}
      </PageHead>
      <Msg message={action.message} />
      {form && (
        <form className="card row end" onSubmit={save}>
          <Field label="Kod"><input required pattern="[a-z0-9_]{2,50}" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="İl"><Select value={form.province} onChange={(v) => setForm({ ...form, province: v })} options={PROVINCES} /></Field>
          <Field label="Ad"><input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Tür"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={TYPES} /></Field>
          <Field label="IATA"><input maxLength={3} pattern="[A-Z]{3}" value={form.iata_code ?? ""} onChange={(e) => setForm({ ...form, iata_code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Enlem"><input required type="number" step="0.000001" min={35} max={39} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
          <Field label="Boylam"><input required type="number" step="0.000001" min={26} max={34} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Aktif</label>
          <button className="btn" type="submit" disabled={action.busy}>Kaydet</button>
          <button className="btn link" type="button" onClick={() => setForm(null)}>Vazgeç</button>
        </form>
      )}
      <ErrorBox error={error} />
      <Table
        rows={rows}
        rowKey={(r) => String(r.id)}
        columns={[
          { key: "name", title: "Ad", render: (r) => r.name },
          { key: "code", title: "Kod", render: (r) => <span className="mono">{r.code}</span> },
          { key: "prov", title: "İl", render: (r) => PROVINCES[r.province as keyof typeof PROVINCES] ?? r.province },
          { key: "type", title: "Tür", render: (r) => `${TYPES[r.type as keyof typeof TYPES] ?? r.type}${r.iata_code ? ` (${r.iata_code})` : ""}` },
          { key: "loc", title: "Konum", render: (r) => <span className="mono">{r.latitude}, {r.longitude}</span> },
          { key: "active", title: "Durum", render: (r) => <Badge value={r.is_active ? "aktif" : "pasif"} labels={{ aktif: "Aktif", pasif: "Pasif" }} /> },
          {
            key: "act",
            title: "",
            render: (r) => (
              <div className="row">
                <button className="btn small secondary" onClick={() => setForm({ ...r, iata_code: r.iata_code ?? "" })}>Düzenle</button>
                <button className="btn small secondary" onClick={() => toggle(r)}>{r.is_active ? "Kapat" : "Aç"}</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
