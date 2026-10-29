"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData, usePager } from "@/components/ui";
import { api, withQuery } from "@/lib/api";
import { DOCUMENT_TYPE, VEHICLE_STATUS } from "@/lib/labels";

interface Vehicle {
  id: string;
  plate: string;
  vehicle_type: string;
  brand: string;
  model: string;
  year: number | null;
  capacity: number;
  status: string;
  missing_documents: string[];
}

interface VehicleType {
  id: number;
  code: string;
  name: string;
  capacity: number;
  luggage_capacity: number;
  price_multiplier: string;
  is_active: boolean;
}

const EMPTY_VT = { code: "", name: "", capacity: 3, luggage_capacity: 3, price_multiplier: "1.00", is_active: true };

/** Ekran 6: araçlar ve araç tipleri. Araç tipi ve çarpan yalnızca admin tarafından değiştirilir. */
export default function VehiclesPage() {
  const can = useCan();
  const [status, setStatus] = useState("");
  const { limit, offset, setOffset, pager } = usePager();
  const vehicles = useData<Vehicle[]>(withQuery("admin/vehicles", { status, limit, offset }));
  const types = useData<VehicleType[]>("admin/vehicle-types");
  const action = useAction();
  const [editing, setEditing] = useState<(typeof EMPTY_VT & { id?: number }) | null>(null);

  async function setVehicleStatus(id: string, s: string) {
    const ok = await action.run(() => api(`admin/vehicles/${id}/status`, { body: { status: s } }));
    if (ok) void vehicles.reload();
  }

  async function saveType(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, ...body } = editing;
    const ok = await action.run(
      () => api(id ? `admin/vehicle-types/${id}` : "admin/vehicle-types", { method: id ? "PUT" : "POST", body }),
      "Araç tipi kaydedildi. Yeni çarpan yalnızca yeni fiyat tekliflerine uygulanır.",
    );
    if (ok) {
      setEditing(null);
      void types.reload();
    }
  }

  return (
    <div className="stack">
      <PageHead title="Araçlar ve araç tipleri" />
      <Msg message={action.message} />

      <h2>Araç tipleri</h2>
      <ErrorBox error={types.error} />
      <Table
        rows={types.data}
        rowKey={(t) => String(t.id)}
        columns={[
          { key: "code", title: "Kod", render: (t) => <span className="mono">{t.code}</span> },
          { key: "name", title: "Ad", render: (t) => t.name },
          { key: "cap", title: "Yolcu / bagaj", render: (t) => `${t.capacity} / ${t.luggage_capacity}` },
          { key: "mult", title: "Fiyat çarpanı", align: "right", render: (t) => t.price_multiplier },
          { key: "active", title: "Durum", render: (t) => <Badge value={t.is_active ? "aktif" : "pasif"} labels={VEHICLE_STATUS} /> },
          {
            key: "act",
            title: "",
            render: (t) =>
              can() && (
                <button className="btn small secondary" onClick={() => setEditing({ ...t })}>Düzenle</button>
              ),
          },
        ]}
      />
      {can() && !editing && (
        <div>
          <button className="btn secondary small" onClick={() => setEditing({ ...EMPTY_VT })}>Yeni araç tipi</button>
        </div>
      )}
      {editing && (
        <form className="card row end" onSubmit={saveType}>
          <Field label="Kod">
            <input required pattern="[a-z0-9_]{2,30}" value={editing.code} disabled={Boolean(editing.id)}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
          </Field>
          <Field label="Ad">
            <input required maxLength={100} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Yolcu">
            <input type="number" min={1} max={50} value={editing.capacity}
              onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })} />
          </Field>
          <Field label="Bagaj">
            <input type="number" min={0} max={50} value={editing.luggage_capacity}
              onChange={(e) => setEditing({ ...editing, luggage_capacity: Number(e.target.value) })} />
          </Field>
          <Field label="Çarpan">
            <input type="number" step="0.01" min="0.01" max="10" value={editing.price_multiplier}
              onChange={(e) => setEditing({ ...editing, price_multiplier: e.target.value })} />
          </Field>
          <label className="row">
            <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
            Aktif
          </label>
          <button className="btn" type="submit" disabled={action.busy}>Kaydet</button>
          <button className="btn link" type="button" onClick={() => setEditing(null)}>Vazgeç</button>
        </form>
      )}

      <h2>Araçlar</h2>
      <div className="card row end">
        <Field label="Durum">
          <Select value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={VEHICLE_STATUS} empty="Tümü" />
        </Field>
        <span className="hint">Araçlar sürücü uygulamasından eklenir, belgeleri sürücü detayında incelenir.</span>
      </div>
      <ErrorBox error={vehicles.error} />
      <Table
        rows={vehicles.data}
        rowKey={(v) => v.id}
        columns={[
          { key: "plate", title: "Plaka", render: (v) => <span className="mono">{v.plate}</span> },
          { key: "model", title: "Araç", render: (v) => `${v.brand} ${v.model} ${v.year ?? ""}` },
          { key: "type", title: "Tip", render: (v) => v.vehicle_type },
          { key: "cap", title: "Kapasite", align: "right", render: (v) => v.capacity },
          { key: "status", title: "Durum", render: (v) => <Badge value={v.status} labels={VEHICLE_STATUS} /> },
          {
            key: "missing",
            title: "Eksik belge",
            render: (v) => (v.missing_documents.length ? v.missing_documents.map((m) => DOCUMENT_TYPE[m] ?? m).join(", ") : "Yok"),
          },
          {
            key: "act",
            title: "",
            render: (v) => (
              <div className="row">
                <button className="btn small" disabled={v.status === "aktif"} onClick={() => setVehicleStatus(v.id, "aktif")}>Aktif</button>
                <button className="btn small secondary" disabled={v.status === "pasif"} onClick={() => setVehicleStatus(v.id, "pasif")}>Pasif</button>
              </div>
            ),
          },
        ]}
      />
      {pager(vehicles.data?.length)}
    </div>
  );
}
