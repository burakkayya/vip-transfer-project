"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DocumentReview, { Doc } from "@/components/DocumentReview";
import { Badge, ErrorBox, Field, Msg, PageHead, useAction, useData } from "@/components/ui";
import { api, blobUrl } from "@/lib/api";
import { d, dt } from "@/lib/format";
import { DOCUMENT_STATUS, DOCUMENT_TYPE, DRIVER_DOCS, DRIVER_STATUS, VEHICLE_DOCS, VEHICLE_PHOTOS, VEHICLE_STATUS } from "@/lib/labels";
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

type Detail = DriverRow & {
  whatsapp_phone: string | null;
  operating_province: string | null;
  vehicles: Vehicle[];
  documents: Doc[];
};

const PROVINCE: Record<string, string> = {
  antalya: "Antalya", mugla: "Muğla", istanbul: "İstanbul", ankara: "Ankara", izmir: "İzmir", nevsehir: "Nevşehir", kayseri: "Kayseri",
};

/** Bir sahibin belirli türdeki belgeleri, en yeni önce. */
function docsOf(all: Doc[], ownerId: string, type: string): Doc[] {
  return all.filter((x) => x.owner_id === ownerId && x.doc_type === type).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Zorunlu belge satırı: en son yüklenen sürüm inceleme kartıyla; eski sürümler açılır listede. */
function RequiredDoc(props: { label: string; docs: Doc[]; onDone: () => void }) {
  const [latest, ...older] = props.docs;
  return (
    <div className="required-doc">
      {latest ? <DocumentReview doc={latest} onDone={props.onDone} /> : (
        <div className="card row spread">
          <strong>{props.label}</strong>
          <span className="badge warn">Yüklenmedi</span>
        </div>
      )}
      {older.length > 0 && (
        <details className="older-docs">
          <summary>Önceki {older.length} sürüm</summary>
          {older.map((doc) => <DocumentReview key={doc.id} doc={doc} onDone={props.onDone} />)}
        </details>
      )}
    </div>
  );
}

/** Araç fotoğrafı: görüntü kendiliğinden yüklenir (her görüntüleme denetim kaydına yazılır). */
function Photo(props: { label: string; doc?: Doc }) {
  const [src, setSrc] = useState<string | null>(null);
  const id = props.doc?.id;
  useEffect(() => {
    if (!id) return;
    let url: string | null = null;
    let live = true;
    void blobUrl(`admin/documents/${id}/file`).then((r) => {
      url = r.url;
      if (live) setSrc(r.url);
      else URL.revokeObjectURL(r.url);
    }).catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return (
    <figure className="vehicle-photo">
      <div className="vehicle-photo-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- yetkili uçtan gelen blob önizlemesi */}
        {src ? <img src={src} alt={`${props.label} fotoğrafı`} /> : <span className="muted">{props.doc ? "Yükleniyor…" : "Yüklenmedi"}</span>}
      </div>
      <figcaption className="row spread">
        <span>{props.label}</span>
        {props.doc ? <Badge value={props.doc.status} labels={DOCUMENT_STATUS} /> : null}
      </figcaption>
    </figure>
  );
}

/**
 * K-78 sürücü detayı: "Sürücü detayları" (iletişim, il, kişisel belgeler) ve her araç için "Araç detayları"
 * (fotoğraflar, ruhsat, muayene, sigorta). Belgeler tek tek onaylanır; sürücü tüm zorunlu belgeler onaylı ve
 * geçerliyken onaylanabilir. `id` sayfa (sunucu) bileşeninde UUID olarak doğrulanmış gelir (WEB-06).
 */
export default function DriverDetail({ id }: { id: string }) {
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

  const pending = data.documents.filter((x) => x.status === "beklemede").length;
  const known = new Set([...DRIVER_DOCS, ...Object.keys(VEHICLE_PHOTOS), ...VEHICLE_DOCS]);
  const extra = data.documents.filter((x) => !known.has(x.doc_type));

  return (
    <div className="stack">
      <PageHead title={data.full_name}>
        <Badge value={data.status} labels={DRIVER_STATUS} />
        <Link href="/drivers" className="btn secondary small">Listeye dön</Link>
      </PageHead>
      <Msg message={action.message} />

      <div className="grid cols-2">
        <div className="card stack">
          <h2>Başvuru durumu</h2>
          <dl className="kv">
            <dt>İnceleme bekleyen</dt><dd>{pending ? `${pending} belge` : "Yok"}</dd>
            <dt>Eksik sürücü belgesi</dt>
            <dd>{data.missing_documents.length ? data.missing_documents.map((m) => DOCUMENT_TYPE[m] ?? m).join(", ") : "Yok"}</dd>
            <dt>Kayıt</dt><dd>{dt(data.created_at)}</dd>
          </dl>
        </div>
        <div className="card stack">
          <h2>Durum değiştir</h2>
          <Field label="Gerekçe (askı ve pasifte önerilir)">
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn" disabled={action.busy || data.status === "onayli"} onClick={() => setStatus("onayli")}>Onayla</button>
            <button className="btn secondary" disabled={action.busy || data.status === "askida"} onClick={() => setStatus("askida")}>Askıya al</button>
            <button className="btn danger" disabled={action.busy || data.status === "pasif"} onClick={() => setStatus("pasif")}>Pasif yap</button>
          </div>
          <p className="hint">Onay için tüm zorunlu sürücü belgeleri onaylı ve geçerli, en az bir araç aktif olmalı.</p>
        </div>
      </div>

      <section className="stack detail-section" aria-labelledby="driver-details">
        <h2 id="driver-details">Sürücü detayları</h2>
        <div className="card">
          <dl className="kv">
            <dt>Telefon</dt><dd className="mono">{data.phone}</dd>
            <dt>WhatsApp</dt><dd className="mono">{data.whatsapp_phone ?? "—"}</dd>
            <dt>Çalıştığı il</dt><dd>{data.operating_province ? PROVINCE[data.operating_province] ?? data.operating_province : "—"}</dd>
            <dt>TÜRSAB / acente no</dt><dd>{data.tursab_or_agency_no ?? "—"}</dd>
            <dt>Çevrimiçi</dt><dd>{data.is_online ? "Evet" : "Hayır"}</dd>
          </dl>
        </div>
        <h3>Kişisel belgeler</h3>
        {DRIVER_DOCS.map((t) => (
          <RequiredDoc key={t} label={DOCUMENT_TYPE[t]} docs={docsOf(data.documents, data.id, t)} onDone={reload} />
        ))}
      </section>

      <section className="stack detail-section" aria-labelledby="vehicle-details">
        <h2 id="vehicle-details">Araç detayları</h2>
        {data.vehicles.length === 0 && <p className="muted">Kayıtlı araç yok.</p>}
        {data.vehicles.map((v) => (
          <div key={v.id} className="stack">
            <div className="card row spread">
              <div className="stack tight">
                <strong><span className="mono plate">{v.plate}</span> {v.brand} {v.model} {v.year ?? ""}</strong>
                <span className="hint">
                  {v.vehicle_type} · {v.capacity} yolcu · eksik: {v.missing_documents.length ? v.missing_documents.map((m) => DOCUMENT_TYPE[m] ?? m).join(", ") : "yok"}
                </span>
              </div>
              <div className="row">
                <Badge value={v.status} labels={VEHICLE_STATUS} />
                <button className="btn small" disabled={action.busy || v.status === "aktif"} onClick={() => setVehicleStatus(v.id, "aktif")}>Aktif</button>
                <button className="btn small secondary" disabled={action.busy || v.status === "pasif"} onClick={() => setVehicleStatus(v.id, "pasif")}>Pasif</button>
              </div>
            </div>
            <h3>Araç fotoğrafları</h3>
            <div className="vehicle-photos">
              {Object.entries(VEHICLE_PHOTOS).map(([t, label]) => (
                <Photo key={t} label={label} doc={docsOf(data.documents, v.id, t)[0]} />
              ))}
            </div>
            {Object.keys(VEHICLE_PHOTOS).map((t) => docsOf(data.documents, v.id, t)[0]).filter((x) => x?.status === "beklemede").map((x) => (
              <DocumentReview key={x!.id} doc={x!} onDone={reload} />
            ))}
            <h3>Araç belgeleri</h3>
            {VEHICLE_DOCS.map((t) => (
              <RequiredDoc key={t} label={DOCUMENT_TYPE[t]} docs={docsOf(data.documents, v.id, t)} onDone={reload} />
            ))}
          </div>
        ))}
      </section>

      {extra.length > 0 && (
        <section className="stack">
          <h2>Diğer belgeler</h2>
          {extra.map((doc) => <DocumentReview key={doc.id} doc={doc} onDone={reload} />)}
          <p className="hint">Zorunlu listede olmayan eski belge türleri (ör. SRC). Son güncelleme {d(extra[0].created_at)}.</p>
        </section>
      )}
    </div>
  );
}
