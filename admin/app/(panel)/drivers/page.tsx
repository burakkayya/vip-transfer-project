"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, ErrorBox, Field, PageHead, Select, Table, useData, usePager } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { dt } from "@/lib/format";
import { DOCUMENT_TYPE, DRIVER_STATUS, PHOTO_STATUS } from "@/lib/labels";

export interface DriverRow {
  id: string;
  full_name: string;
  phone: string;
  tursab_or_agency_no: string | null;
  status: string;
  is_online: boolean;
  missing_documents: string[];
  /** K-81: profil fotoğrafı onayı (fotoğraf yoksa null). */
  photo_status: string | null;
  photo_reject_reason: string | null;
  /** Onay isteğinde geri gönderilir; arada yeni fotoğraf yüklendiyse backend 409 döner. */
  photo_version: string | null;
  created_at: string;
}


/** Ekran 5: sürücü listesi ve başvuru kuyruğu. */
export default function DriversPage() {
  const [status, setStatus] = useState("basvuru");
  const [photoPending, setPhotoPending] = useState(false);
  const { limit, offset, setOffset, pager } = usePager();
  const { data, error } = useData<DriverRow[]>(
    withQuery("admin/drivers", { status, limit, offset, photo_pending: photoPending ? "true" : "" }),
  );

  return (
    <div className="stack">
      <PageHead title="Sürücüler" />
      <div className="card row end">
        <Field label="Durum">
          <Select value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={DRIVER_STATUS} empty="Tümü" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={photoPending} onChange={(e) => { setPhotoPending(e.target.checked); setOffset(0); }} />
          Fotoğrafı onay bekleyenler
        </label>
      </div>
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(r) => r.id}
        empty={status === "basvuru" ? "Bekleyen başvuru yok." : "Sürücü yok."}
        columns={[
          { key: "name", title: "Ad soyad", render: (r) => <Link href={`/drivers/${r.id}`}>{r.full_name}</Link> },
          { key: "phone", title: "Telefon", render: (r) => <span className="mono">{r.phone}</span> },
          { key: "tursab", title: "TÜRSAB / acente no", render: (r) => r.tursab_or_agency_no ?? "—" },
          { key: "status", title: "Durum", render: (r) => <Badge value={r.status} labels={DRIVER_STATUS} /> },
          { key: "online", title: "Çevrimiçi", render: (r) => (r.is_online ? "●" : "") },
          { key: "photo", title: "Fotoğraf", render: (r) => (r.photo_status ? <Badge value={r.photo_status} labels={PHOTO_STATUS} /> : "—") },
          {
            key: "missing",
            title: "Eksik belge",
            render: (r) =>
              r.missing_documents.length === 0 ? (
                <span className="badge ok">Tam</span>
              ) : (
                r.missing_documents.map((m) => DOCUMENT_TYPE[m] ?? m).join(", ")
              ),
          },
          { key: "created", title: "Kayıt", render: (r) => dt(r.created_at) },
        ]}
      />
      {pager(data?.length)}
    </div>
  );
}
