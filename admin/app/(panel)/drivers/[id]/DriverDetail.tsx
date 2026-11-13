"use client";

import Link from "next/link";
import { use, useState } from "react";
import DocumentReview, { Doc } from "@/components/DocumentReview";
import { Badge, ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { DOCUMENT_TYPE, DRIVER_STATUS, VEHICLE_STATUS } from "@/lib/labels";
import type { DriverRow } from "../page";

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

type Detail = DriverRow & { vehicles: Vehicle[]; documents: Doc[] };

/** Ekran 5: sürücü detayı, belge inceleme, onay/red, askıya alma. */
export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useData<Detail>(`admin/drivers/${id}`);
  const action = useAction();
  const [reason, setReason] = useState("");

  if (!data) return <ErrorBox error={error} />;

  async function setStatus(status: string) {
    const ok = await action.run(
      () => api(`admin/drivers/${id}/status`, { body: { status, reason: reason.trim() || null } }),
      `Durum: ${DRIVER_STATUS[status]}`,
    );
    if (ok) void reload();
  }

  async function setVehicleStatus(vehicleId: string, status: string) {
    const ok = await action.run(() => api(`admin/vehicles/${vehicleId}/status`, { body: { status } }));
    if (ok) void reload();
  }

  const pendingDocs = data.documents.filter((x) => x.status === "beklemede");
  const otherDocs = data.documents.filter((x) => x.status !== "beklemede");

  return (
    <div className="stack">
      <PageHead title={data.full_name}>
        <Badge value={data.status} labels={DRIVER_STATUS} />
        <Link href="/drivers" className="btn secondary small">Listeye dön</Link>
      </PageHead>
      <Msg message={action.message} />

      <div className="grid cols-2">
        <div className="card">
          <dl className="kv">
            <dt>Telefon</dt><dd className="mono">{data.phone}</dd>
            <dt>TÜRSAB / acente no</dt><dd>{data.tursab_or_agency_no ?? "—"}</dd>
            <dt>Çevrimiçi</dt><dd>{data.is_online ? "Evet" : "Hayır"}</dd>
            <dt>Kayıt</dt><dd>{dt(data.created_at)}</dd>
            <dt>Eksik belgeler</dt>
            <dd>{data.missing_documents.length ? data.missing_documents.map((m) => DOCUMENT_TYPE[m] ?? m).join(", ") : "Yok"}</dd>
          </dl>
        </div>
        <div className="card stack">
          <h2>Durum değiştir</h2>
          <Field label="Gerekçe (askı ve pasifte önerilir)">
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn" disabled={action.busy || data.status === "onayli"} onClick={() => setStatus("onayli")}>
              Onayla
            </button>
            <button className="btn secondary" disabled={action.busy || data.status === "askida"} onClick={() => setStatus("askida")}>
              Askıya al
            </button>
            <button className="btn danger" disabled={action.busy || data.status === "pasif"} onClick={() => setStatus("pasif")}>
              Pasif yap
            </button>
          </div>
          <p className="hint">Onay için tüm zorunlu belgelerin onaylı ve geçerli olması gerekir.</p>
        </div>
      </div>

      <h2>Araçlar</h2>
      <Table
        rows={data.vehicles}
        rowKey={(v) => v.id}
        empty="Kayıtlı araç yok."
        columns={[
          { key: "plate", title: "Plaka", render: (v) => <span className="mono">{v.plate}</span> },
          { key: "model", title: "Araç", render: (v) => `${v.brand} ${v.model} ${v.year ?? ""}` },
          { key: "type", title: "Tip / kapasite", render: (v) => `${v.vehicle_type} · ${v.capacity}` },
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

      <h2>İnceleme bekleyen belgeler</h2>
      {pendingDocs.length === 0 && <p className="muted">Yok.</p>}
      {pendingDocs.map((doc) => <DocumentReview key={doc.id} doc={doc} onDone={reload} />)}

      {otherDocs.length > 0 && (
        <>
          <h2>Diğer belgeler</h2>
          {otherDocs.map((doc) => <DocumentReview key={doc.id} doc={doc} onDone={reload} />)}
        </>
      )}
    </div>
  );
}
