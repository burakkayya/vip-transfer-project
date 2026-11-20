"use client";

import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, localToIso, money } from "@/lib/format";

interface DailyRate {
  id: number;
  vehicle_type_id: number;
  full_day_price: string;
  half_day_price: string;
  full_day_hours: number;
  half_day_hours: number;
  full_day_km: number;
  half_day_km: number;
  extra_hour_price: string;
  extra_km_price: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

const EMPTY = {
  vehicle_type_id: "",
  full_day_price: "",
  half_day_price: "",
  full_day_hours: "10",
  half_day_hours: "5",
  full_day_km: "250",
  half_day_km: "120",
  extra_hour_price: "",
  extra_km_price: "",
  valid_from: "",
};

/**
 * K-29 şoförlü günlük kiralama fiyatları (EUR). Sürümlüdür: düzenlenmez, yeni sürüm eklenir; araç tipi başına en
 * yeni geçerli sürüm kullanılır, rezervasyon hesaplandığı sürümü dondurur. Aşım ücretleri müşteriye bilgi olarak
 * gösterilir, otomatik tahsil edilmez.
 */
export default function DailyRates(props: { isAdmin: boolean; vtName: (id: number) => string | number; types: { id: number; name: string }[] | null | undefined }) {
  const rates = useData<DailyRate[]>("admin/daily-rates");
  const action = useAction();
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/daily-rates", {
      body: {
        ...form,
        vehicle_type_id: Number(form.vehicle_type_id),
        full_day_hours: Number(form.full_day_hours),
        half_day_hours: Number(form.half_day_hours),
        full_day_km: Number(form.full_day_km),
        half_day_km: Number(form.half_day_km),
        valid_from: localToIso(form.valid_from),
      },
    }), "Günlük kiralama fiyatı eklendi. Yalnızca yeni rezervasyonlara uygulanır.");
    if (ok) {
      setForm(EMPTY);
      void rates.reload();
    }
  }

  async function deactivate(id: number) {
    if (!confirm("Bu fiyat sürümü kapatılsın mı? Geçmiş rezervasyonlar etkilenmez.")) return;
    if (await action.run(() => api(`admin/daily-rates/${id}/deactivate`, { body: {} }), "Kapatıldı.")) void rates.reload();
  }

  return (
    <section className="stack" aria-labelledby="daily-rates-title">
      <h2 id="daily-rates-title">Günlük kiralama fiyatları</h2>
      <p className="hint">
        Şoförlü günlük kiralama (K-29): gün fiyatı × gün sayısı, 5&apos;in katına yuvarlanır. Saat ve km sınırını aşan kullanım
        müşteriye bilgi olarak gösterilir, otomatik tahsil edilmez.
      </p>
      <ErrorBox error={rates.error} />
      <Msg message={action.message} />
      <Table
        rows={rates.data}
        rowKey={(r) => String(r.id)}
        empty="Tanımlı günlük fiyat yok; günlük kiralama satışta görünmez."
        columns={[
          { key: "vt", title: "Araç tipi", render: (r) => props.vtName(r.vehicle_type_id) },
          { key: "full", title: "Tam gün", align: "right", render: (r) => `${money(r.full_day_price, "EUR")} · ${r.full_day_hours} sa · ${r.full_day_km} km` },
          { key: "half", title: "Yarım gün", align: "right", render: (r) => `${money(r.half_day_price, "EUR")} · ${r.half_day_hours} sa · ${r.half_day_km} km` },
          { key: "extra", title: "Aşım", align: "right", render: (r) => `${money(r.extra_hour_price, "EUR")}/sa · ${money(r.extra_km_price, "EUR")}/km` },
          { key: "from", title: "Başlangıç", render: (r) => dt(r.valid_from) },
          { key: "to", title: "Bitiş", render: (r) => dt(r.valid_to) },
          { key: "active", title: "", render: (r) => <Badge value={r.is_active ? "aktif" : "pasif"} labels={{ aktif: "Geçerli", pasif: "Kapalı" }} /> },
          {
            key: "act",
            title: "",
            render: (r) => props.isAdmin && r.is_active && (
              <button className="btn small secondary" onClick={() => deactivate(r.id)}>Kapat</button>
            ),
          },
        ]}
      />
      {props.isAdmin && (
        <form className="card stack" onSubmit={add}>
          <div className="row end">
            <Field label="Araç tipi">
              <select required value={form.vehicle_type_id} onChange={(e) => set("vehicle_type_id", e.target.value)}>
                <option value="">Seçin</option>
                {props.types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Tam gün (€)"><input required type="number" step="0.01" min="0.01" value={form.full_day_price} onChange={(e) => set("full_day_price", e.target.value)} /></Field>
            <Field label="Saat"><input required type="number" min="2" max="16" value={form.full_day_hours} onChange={(e) => set("full_day_hours", e.target.value)} /></Field>
            <Field label="Km"><input required type="number" min="10" max="1000" value={form.full_day_km} onChange={(e) => set("full_day_km", e.target.value)} /></Field>
          </div>
          <div className="row end">
            <Field label="Yarım gün (€)"><input required type="number" step="0.01" min="0.01" value={form.half_day_price} onChange={(e) => set("half_day_price", e.target.value)} /></Field>
            <Field label="Saat"><input required type="number" min="1" max="12" value={form.half_day_hours} onChange={(e) => set("half_day_hours", e.target.value)} /></Field>
            <Field label="Km"><input required type="number" min="5" max="1000" value={form.half_day_km} onChange={(e) => set("half_day_km", e.target.value)} /></Field>
          </div>
          <div className="row end">
            <Field label="Aşım saati (€)"><input required type="number" step="0.01" min="0" value={form.extra_hour_price} onChange={(e) => set("extra_hour_price", e.target.value)} /></Field>
            <Field label="Aşım km (€)"><input required type="number" step="0.01" min="0" value={form.extra_km_price} onChange={(e) => set("extra_km_price", e.target.value)} /></Field>
            <Field label="Geçerlilik başlangıcı" hint="Boş: hemen"><input type="datetime-local" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} /></Field>
            <button className="btn" type="submit" disabled={action.busy}>Yeni fiyat ekle</button>
          </div>
        </form>
      )}
    </section>
  );
}
