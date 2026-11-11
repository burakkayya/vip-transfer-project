"use client";

import { useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";

interface Place {
  id: number;
  name: string;
  subtitle: string;
  region_id: number;
  region_name: string;
  latitude: string;
  longitude: string;
  google_place_id: string | null;
  is_active: boolean;
}
interface Region { id: number; name: string; is_active: boolean }
interface Candidate { place_id: string; picks: number; label: string }
interface UsageCell { paid: number; cached: number; local: number }
interface UsageDay { day: string; routes: UsageCell; places_autocomplete: UsageCell; places_details: UsageCell; flights: UsageCell }

const EMPTY = { name: "", subtitle: "", region_id: "", latitude: "", longitude: "", is_active: true };
type Form = typeof EMPTY & { id?: number; google_place_id?: string | null };

function cell(c: UsageCell) {
  const free = c.cached + c.local;
  return `${c.paid} ücretli · ${free} ücretsiz`;
}

/** Popüler yerler (K-61): adres aramasında ücretli servise gitmeden önerilen kendi listemiz. */
export default function PopularPlacesPage() {
  const { data, error, reload } = useData<Place[]>("admin/popular-places");
  const regions = useData<Region[]>("admin/regions");
  const candidates = useData<Candidate[]>("admin/popular-places/candidates");
  const usage = useData<UsageDay[]>("admin/api-usage?days=7");
  const action = useAction();
  const [form, setForm] = useState<Form | null>(null);
  const [promote, setPromote] = useState<(Candidate & { name: string; subtitle: string }) | null>(null);

  const regionOptions = Object.fromEntries(
    (regions.data ?? []).filter((r) => r.is_active).map((r) => [String(r.id), r.name]),
  );

  function body(f: Form, active = f.is_active) {
    return {
      name: f.name, subtitle: f.subtitle, region_id: Number(f.region_id), latitude: f.latitude,
      longitude: f.longitude, google_place_id: f.google_place_id ?? null, is_active: active,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await action.run(
      () => api(form.id ? `admin/popular-places/${form.id}` : "admin/popular-places",
        { method: form.id ? "PUT" : "POST", body: body(form) }),
      "Yer kaydedildi.",
    );
    if (ok) {
      setForm(null);
      void reload();
    }
  }

  async function toggle(p: Place) {
    const ok = await action.run(() => api(`admin/popular-places/${p.id}`,
      { method: "PUT", body: body({ ...p, region_id: String(p.region_id) }, !p.is_active) }));
    if (ok) void reload();
  }

  async function doPromote(e: React.FormEvent) {
    e.preventDefault();
    if (!promote) return;
    const ok = await action.run(
      () => api("admin/popular-places/promote",
        { method: "POST", body: { place_id: promote.place_id, name: promote.name, subtitle: promote.subtitle } }),
      "Yer listeye alındı.",
    );
    if (ok) {
      setPromote(null);
      void reload();
      void candidates.reload();
    }
  }

  async function dismiss(c: Candidate) {
    const ok = await action.run(() => api("admin/popular-places/candidates/dismiss",
      { method: "POST", body: { place_id: c.place_id } }));
    if (ok) void candidates.reload();
  }

  function startPromote(c: Candidate) {
    const [first, ...rest] = c.label.split(",");
    setPromote({ ...c, name: (first ?? "").trim().slice(0, 150), subtitle: rest.join(",").trim().slice(0, 200) });
  }

  return (
    <div className="stack">
      <PageHead title="Popüler yerler">
        {!form && <button className="btn small" onClick={() => setForm({ ...EMPTY })}>Yeni yer</button>}
      </PageHead>
      <p className="muted">
        Bu listedeki oteller ve buluşma noktaları adres aramasında ilk sırada, ücretli arama servisine gidilmeden önerilir.
        Müşteri yazmaya devam ederse tam arama yine yapılır.
      </p>
      <Msg message={action.message} />
      {form && (
        <form className="card row end" onSubmit={save}>
          <Field label="Ad"><input required minLength={2} maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Açıklama" hint="Örn. Lara, Muratpaşa, Antalya"><input maxLength={200} value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></Field>
          <Field label="Bölge"><Select value={form.region_id} onChange={(v) => setForm({ ...form, region_id: v })} options={regionOptions} empty="Seçin" /></Field>
          <Field label="Enlem"><input required type="number" step="0.000001" min={35} max={39} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
          <Field label="Boylam"><input required type="number" step="0.000001" min={26} max={34} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Aktif</label>
          <button className="btn" type="submit" disabled={action.busy || !form.region_id}>Kaydet</button>
          <button className="btn link" type="button" onClick={() => setForm(null)}>Vazgeç</button>
        </form>
      )}
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(p) => String(p.id)}
        empty="Henüz popüler yer yok. Aşağıdaki adaylardan ekleyebilir ya da elle girebilirsiniz."
        columns={[
          { key: "name", title: "Ad", render: (p) => p.name },
          { key: "sub", title: "Açıklama", render: (p) => p.subtitle },
          { key: "region", title: "Bölge", render: (p) => p.region_name },
          { key: "loc", title: "Konum", render: (p) => <span className="mono">{p.latitude}, {p.longitude}</span> },
          { key: "active", title: "Durum", render: (p) => <Badge value={p.is_active ? "aktif" : "pasif"} labels={{ aktif: "Aktif", pasif: "Pasif" }} /> },
          {
            key: "act",
            title: "",
            render: (p) => (
              <div className="row">
                <button className="btn small secondary" onClick={() => setForm({ ...p, region_id: String(p.region_id) })}>Düzenle</button>
                <button className="btn small secondary" onClick={() => toggle(p)}>{p.is_active ? "Kapat" : "Aç"}</button>
              </div>
            ),
          },
        ]}
      />

      <h2>Adaylar: müşterilerin en çok seçtiği adresler</h2>
      {promote && (
        <form className="card row end" onSubmit={doPromote}>
          <Field label="Ad"><input required minLength={2} maxLength={150} value={promote.name} onChange={(e) => setPromote({ ...promote, name: e.target.value })} /></Field>
          <Field label="Açıklama"><input maxLength={200} value={promote.subtitle} onChange={(e) => setPromote({ ...promote, subtitle: e.target.value })} /></Field>
          <button className="btn" type="submit" disabled={action.busy}>Listeye al</button>
          <button className="btn link" type="button" onClick={() => setPromote(null)}>Vazgeç</button>
        </form>
      )}
      <ErrorBox error={candidates.error} />
      <Table
        rows={candidates.data}
        rowKey={(c) => c.place_id}
        empty="Henüz aday yok. Müşteriler adres seçtikçe burada birikir."
        columns={[
          { key: "label", title: "Adres", render: (c) => c.label || c.place_id },
          { key: "picks", title: "Seçilme", render: (c) => c.picks },
          {
            key: "act",
            title: "",
            render: (c) => (
              <div className="row">
                <button className="btn small secondary" onClick={() => startPromote(c)}>Listeye al</button>
                <button className="btn small secondary" onClick={() => dismiss(c)}>Gizle</button>
              </div>
            ),
          },
        ]}
      />

      <h2>Ücretli servis kullanımı (son 7 gün)</h2>
      <p className="muted">Ücretsiz: önbellekten ya da popüler yer listesinden karşılanan istekler.</p>
      <ErrorBox error={usage.error} />
      <Table
        rows={usage.data}
        rowKey={(u) => u.day}
        columns={[
          { key: "day", title: "Gün", render: (u) => u.day },
          { key: "routes", title: "Rota", render: (u) => cell(u.routes) },
          { key: "ac", title: "Adres arama", render: (u) => cell(u.places_autocomplete) },
          { key: "det", title: "Adres seçimi", render: (u) => cell(u.places_details) },
          { key: "fl", title: "Uçuş", render: (u) => cell(u.flights) },
        ]}
      />
    </div>
  );
}
