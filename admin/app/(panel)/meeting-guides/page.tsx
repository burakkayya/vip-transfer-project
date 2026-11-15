"use client";

import { useEffect, useState } from "react";
import { Badge, ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api, blobUrl, upload } from "@/lib/api";

interface Step {
  texts: Record<string, string>;
  has_photo: boolean;
  admin_photo_path: string | null;
}
interface Guide {
  id: number;
  region_id: number;
  region: string;
  terminal: string;
  is_active: boolean;
  updated_at: string;
  steps: Step[];
}
interface Region { id: number; name: string; type: string; iata_code: string | null; is_active: boolean }

/** Sitenin dilleri. Diğer dillerdeki metinler (backend on dil kabul eder) kaydederken korunur. */
const LANGS = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
];
const MAX_STEPS = 8;
const MAX_TEXT = 400;

/** Düzenlenen adım. `from`: kayıtlı rehberdeki sırası (fotoğraf onunla taşınır), yeni adımda null. `photo`: fotoğraf korunacak mı. */
interface DraftStep { key: string; texts: Record<string, string>; from: number | null; photo: boolean }
interface Draft { id?: number; region_id: string; terminal: string; is_active: boolean; steps: DraftStep[] }

let seq = 0;
const newKey = () => `s${++seq}`;
const emptyStep = (): DraftStep => ({ key: newKey(), texts: {}, from: null, photo: false });

function toDraft(g: Guide): Draft {
  return {
    id: g.id, region_id: String(g.region_id), terminal: g.terminal, is_active: g.is_active,
    steps: g.steps.map((s, i) => ({ key: newKey(), texts: { ...s.texts }, from: i, photo: s.has_photo })),
  };
}

/** Kayıtlı adımın fotoğrafını personel ucundan çeker (herkese açık uç pasif rehberi vermez). */
function StepPhoto({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    blobUrl(path)
      .then((r) => {
        url = r.url;
        if (live) setSrc(r.url);
        else URL.revokeObjectURL(r.url);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed) return <span className="hint">Fotoğraf yüklenemedi.</span>;
  if (!src) return <span className="guide-photo placeholder" aria-hidden />;
  // Kaynak oturumlu blob adresi: next/image optimizasyonu blob: adresini işleyemez.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="guide-photo" src={src} alt={alt} />;
}

/** Buluşma rehberi (K-62): havalimanı ve terminal başına en çok 8 fotoğraflı adım, müşterinin dilinde. */
export default function MeetingGuidesPage() {
  const { data, error, reload } = useData<Guide[]>("admin/meeting-guides");
  const regions = useData<Region[]>("admin/regions");
  const action = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Guide | null>(null);

  const airports = (regions.data ?? []).filter((r) => r.type === "havalimani" && r.is_active);
  const airportOptions = Object.fromEntries(airports.map((r) => [String(r.id), r.iata_code ? `${r.name} (${r.iata_code})` : r.name]));
  const covered = new Set((data ?? []).map((g) => g.region_id));
  const missing = airports.filter((a) => !covered.has(a.id));

  function edit(g: Guide) {
    setSaved(g);
    setDraft(toDraft(g));
  }

  function create(regionId = "") {
    setSaved(null);
    setDraft({ region_id: regionId, terminal: "", is_active: true, steps: [emptyStep()] });
  }

  function patchStep(i: number, next: Partial<DraftStep>) {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...next } : s)) });
  }

  function move(i: number, by: -1 | 1) {
    if (!draft) return;
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + by, 0, s);
    setDraft({ ...draft, steps });
  }

  function remove(i: number) {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) });
  }

  const dirty = (() => {
    if (!draft) return false;
    if (!saved) return true;
    // Fotoğraf bayrağı da sayılır: "Fotoğrafı kaldır" kaydedilmeden yükleme açılmaz.
    return JSON.stringify(toDraft(saved).steps.map(({ texts, from, photo }) => ({ texts, from, photo })))
      !== JSON.stringify(draft.steps.map(({ texts, from, photo }) => ({ texts, from, photo })))
      || draft.terminal !== saved.terminal || draft.is_active !== saved.is_active || draft.region_id !== String(saved.region_id);
  })();

  const invalid = !draft || !draft.region_id || draft.steps.length === 0
    || draft.steps.some((s) => !Object.values(s.texts).some((t) => t.trim()));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || invalid) return;
    const body = {
      region_id: Number(draft.region_id),
      terminal: draft.terminal.trim(),
      is_active: draft.is_active,
      steps: draft.steps.map((s) => ({ texts: s.texts, photo_from: s.photo ? s.from : null })),
    };
    let result: Guide | null = null;
    const ok = await action.run(async () => {
      result = await api<Guide>(draft.id ? `admin/meeting-guides/${draft.id}` : "admin/meeting-guides",
        { method: draft.id ? "PUT" : "POST", body });
    }, draft.id ? "Rehber kaydedildi." : "Rehber eklendi. Şimdi adımlara fotoğraf ekleyebilirsiniz.");
    if (ok && result) {
      edit(result);
      void reload();
    }
  }

  async function setPhoto(i: number, file: File | undefined) {
    if (!draft?.id || !file) return;
    let result: Guide | null = null;
    const ok = await action.run(async () => {
      result = await upload<Guide>(`admin/meeting-guides/${draft.id}/steps/${i}/photo`, file);
    }, "Fotoğraf yüklendi. Konum ve cihaz bilgisi silindi.");
    if (ok && result) {
      edit(result);
      void reload();
    }
  }

  async function toggle(g: Guide) {
    const ok = await action.run(() => api(`admin/meeting-guides/${g.id}`, {
      method: "PUT",
      body: {
        region_id: g.region_id, terminal: g.terminal, is_active: !g.is_active,
        steps: g.steps.map((s, i) => ({ texts: s.texts, photo_from: s.has_photo ? i : null })),
      },
    }));
    if (ok) void reload();
  }

  return (
    <div className="stack">
      <PageHead title="Buluşma rehberi">
        {!draft && <button className="btn small" onClick={() => create()}>Yeni rehber</button>}
      </PageHead>
      <p className="muted">
        Müşteri havalimanı alışında, uçuşu inince ya da &quot;İndim&quot; deyince bu adımları kendi dilinde görür
        (yoksa İngilizce, o da yoksa Türkçe). Terminal boşsa rehber havalimanının tüm terminalleri içindir.
      </p>
      <Msg message={action.message} />

      {draft && (
        <form className="card stack" onSubmit={save} aria-label={draft.id ? "Rehberi düzenle" : "Yeni rehber"}>
          <div className="row end">
            <Field label="Havalimanı">
              <Select value={draft.region_id} onChange={(v) => setDraft({ ...draft, region_id: v })} options={airportOptions} empty="Seçin" />
            </Field>
            <Field label="Terminal" hint="Örn. Dış Hatlar, T2. Boş bırakılabilir.">
              <input maxLength={40} value={draft.terminal} onChange={(e) => setDraft({ ...draft, terminal: e.target.value })} />
            </Field>
            <label className="row"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> Müşteriye göster</label>
          </div>

          <ol className="guide-steps">
            {draft.steps.map((s, i) => (
              <li key={s.key} className="guide-step">
                <div className="row spread">
                  <h3>Adım {i + 1}</h3>
                  <div className="row">
                    <button type="button" className="btn small secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Adım ${i + 1}: yukarı taşı`}>Yukarı</button>
                    <button type="button" className="btn small secondary" onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} aria-label={`Adım ${i + 1}: aşağı taşı`}>Aşağı</button>
                    <button type="button" className="btn small secondary" onClick={() => remove(i)} disabled={draft.steps.length === 1} aria-label={`Adım ${i + 1}: sil`}>Sil</button>
                  </div>
                </div>
                <div className="guide-step-body">
                  <div className="grid guide-texts">
                    {LANGS.map((l) => (
                      <Field key={l.code} label={l.label}>
                        <textarea rows={2} maxLength={MAX_TEXT} lang={l.code} value={s.texts[l.code] ?? ""}
                          onChange={(e) => patchStep(i, { texts: { ...s.texts, [l.code]: e.target.value } })} />
                      </Field>
                    ))}
                  </div>
                  <div className="guide-photo-col">
                    {s.photo && s.from !== null && saved?.steps[s.from]?.admin_photo_path ? (
                      <StepPhoto path={saved.steps[s.from].admin_photo_path!} alt={`Adım ${i + 1} fotoğrafı`} />
                    ) : (
                      <span className="guide-photo placeholder">Fotoğraf yok</span>
                    )}
                    {draft.id && !dirty && s.from !== null ? (
                      <label className="btn small secondary file-btn">
                        {s.photo ? "Fotoğrafı değiştir" : "Fotoğraf ekle"}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden"
                          onChange={(e) => { void setPhoto(i, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                    ) : (
                      <span className="hint">{draft.id ? "Fotoğraf için önce kaydedin." : "Fotoğraf, rehber eklendikten sonra yüklenir."}</span>
                    )}
                    {s.photo && (
                      <button type="button" className="btn small link" onClick={() => patchStep(i, { photo: false })}>Fotoğrafı kaldır</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="row spread">
            <button type="button" className="btn small secondary" disabled={draft.steps.length >= MAX_STEPS}
              onClick={() => setDraft({ ...draft, steps: [...draft.steps, emptyStep()] })}>
              Adım ekle ({draft.steps.length}/{MAX_STEPS})
            </button>
            <div className="row">
              <button className="btn" type="submit" disabled={action.busy || invalid || !dirty}>Kaydet</button>
              <button className="btn link" type="button" onClick={() => { setDraft(null); setSaved(null); }}>Kapat</button>
            </div>
          </div>
          {invalid && <span className="hint">Havalimanı seçin; her adıma en az bir dilde metin yazın.</span>}
        </form>
      )}

      <ErrorBox error={error ?? regions.error} />
      <Table
        rows={data}
        rowKey={(g) => String(g.id)}
        empty="Henüz rehber yok."
        columns={[
          { key: "airport", title: "Havalimanı", render: (g) => g.region },
          { key: "terminal", title: "Terminal", render: (g) => g.terminal || <span className="muted">Tümü</span> },
          { key: "steps", title: "Adım", render: (g) => g.steps.length },
          { key: "photos", title: "Fotoğraf", render: (g) => `${g.steps.filter((s) => s.has_photo).length}/${g.steps.length}` },
          {
            key: "langs", title: "Eksik dil", render: (g) => {
              const gaps = LANGS.filter((l) => g.steps.some((s) => !s.texts[l.code]?.trim())).map((l) => l.code.toUpperCase());
              return gaps.length ? gaps.join(", ") : <span className="muted">Yok</span>;
            },
          },
          { key: "active", title: "Durum", render: (g) => <Badge value={g.is_active ? "aktif" : "pasif"} labels={{ aktif: "Görünür", pasif: "Gizli" }} /> },
          {
            key: "act", title: "", render: (g) => (
              <div className="row">
                <button className="btn small secondary" onClick={() => edit(g)}>Düzenle</button>
                <button className="btn small secondary" onClick={() => toggle(g)}>{g.is_active ? "Gizle" : "Göster"}</button>
              </div>
            ),
          },
        ]}
      />

      {missing.length > 0 && (
        <>
          <h2>Rehberi olmayan havalimanları</h2>
          <div className="row">
            {missing.map((a) => (
              <button key={a.id} className="btn small secondary" onClick={() => create(String(a.id))}>
                {a.iata_code ?? a.name} için rehber ekle
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
