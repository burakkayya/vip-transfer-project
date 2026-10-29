"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";

type Value = string | number | boolean | string[] | Record<string, unknown>;

const DESCRIPTIONS: Record<string, string> = {
  scheduled_min_lead_hours: "Planlı rezervasyon için alıştan en az kaç saat önce (saat)",
  pending_payment_minutes: "Ödenmeyen rezervasyonun iptal süresi (dakika)",
  try_rounding_step: "TRY fiyat yuvarlama adımı (TL)",
  kvkk_disclosure_version: "KVKK aydınlatma metni sürümü",
  distance_sales_version: "Mesafeli satış ön bilgilendirme sürümü",
  required_driver_documents: "Sürücü için zorunlu belgeler",
  required_vehicle_documents: "Araç için zorunlu belgeler",
  document_expiry_warning_days: "Belge süresi uyarısı (gün önce)",
};

/** Ekran 19: sistem ayarları. Değer türü değiştirilemez; her değişiklik denetim kaydına yazılır. */
export default function SettingsPage() {
  const { data, error, reload } = useData<Record<string, Value>>("admin/settings");
  const action = useAction();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) setDrafts(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
  }, [data]);

  async function save(key: string) {
    const original = data![key];
    let value: Value;
    try {
      value = typeof original === "string" ? drafts[key] : JSON.parse(drafts[key]);
    } catch {
      action.setMessage({ ok: false, text: `${key}: geçerli JSON değil.` });
      return;
    }
    if (await action.run(() => api(`admin/settings/${key}`, { method: "PUT", body: { value } }), `${key} kaydedildi.`)) void reload();
  }

  const rows = data ? Object.keys(data).sort() : null;

  return (
    <div className="stack">
      <PageHead title="Sistem ayarları" />
      <p className="hint">Sayılar düz yazılır, listeler JSON olarak: [&quot;surucu_belgesi&quot;, &quot;src_belgesi&quot;].</p>
      <Msg message={action.message} />
      <ErrorBox error={error} />
      <Table
        rows={rows}
        rowKey={(k) => k}
        columns={[
          { key: "key", title: "Ayar", render: (k) => <><span className="mono">{k}</span><div className="hint">{DESCRIPTIONS[k]}</div></> },
          {
            key: "value",
            title: "Değer",
            render: (k) => (
              <input style={{ width: "100%", minWidth: 280 }} value={drafts[k] ?? ""} onChange={(e) => setDrafts({ ...drafts, [k]: e.target.value })} />
            ),
          },
          {
            key: "act",
            title: "",
            render: (k) => {
              const original = data![k];
              const changed = (typeof original === "string" ? original : JSON.stringify(original)) !== drafts[k];
              return <button className="btn small" disabled={!changed || action.busy} onClick={() => save(k)}>Kaydet</button>;
            },
          },
        ]}
      />
    </div>
  );
}
