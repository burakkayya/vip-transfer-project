"use client";

import Link from "next/link";
import DocumentReview, { Doc } from "@/components/DocumentReview";
import { Badge, ErrorBox, PageHead, Table, useData } from "@/components/ui";
import { d, todayLocal } from "@/lib/format";
import { DOCUMENT_STATUS, DOCUMENT_TYPE } from "@/lib/labels";

/** Ekran 7: inceleme bekleyen, süresi yaklaşan ve dolan belgeler. */
export default function DocumentsPage() {
  const pending = useData<Doc[]>("admin/documents?status=beklemede");
  const expiring = useData<Doc[]>("admin/documents/expiring");
  const today = todayLocal();

  return (
    <div className="stack">
      <PageHead title="Belge takibi" />

      <h2>Süresi yaklaşan ve dolan belgeler</h2>
      <ErrorBox error={expiring.error} />
      <Table
        rows={expiring.data}
        rowKey={(x) => x.id}
        empty="Süresi yaklaşan belge yok."
        columns={[
          { key: "type", title: "Belge", render: (x) => DOCUMENT_TYPE[x.doc_type] ?? x.doc_type },
          {
            key: "owner",
            title: "Sahibi",
            render: (x) =>
              x.owner_type === "driver" ? <Link href={`/drivers/${x.owner_id}`}>Sürücü</Link> : "Araç",
          },
          {
            key: "until",
            title: "Geçerlilik",
            render: (x) => (
              <span style={{ color: x.valid_until && x.valid_until < today ? "var(--danger)" : undefined }}>
                {d(x.valid_until)}
              </span>
            ),
          },
          { key: "status", title: "Durum", render: (x) => <Badge value={x.status} labels={DOCUMENT_STATUS} /> },
        ]}
      />
      <p className="hint">Süresi dolan zorunlu belgesi olan sürücü zamanlanmış görevle otomatik pasife alınır.</p>

      <h2>İnceleme bekleyenler</h2>
      <ErrorBox error={pending.error} />
      {pending.data?.length === 0 && <p className="muted">Bekleyen belge yok.</p>}
      {pending.data?.map((doc) => (
        <div key={doc.id} className="stack">
          {doc.owner_type === "driver" && <Link href={`/drivers/${doc.owner_id}`}>Sürücü detayına git</Link>}
          <DocumentReview doc={doc} onDone={pending.reload} />
        </div>
      ))}
    </div>
  );
}
