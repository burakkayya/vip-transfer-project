"use client";

import { useEffect, useState } from "react";
import { api, blobUrl, download } from "@/lib/api";
import { d } from "@/lib/format";
import { DOCUMENT_STATUS, DOCUMENT_TYPE } from "@/lib/labels";
import { Badge, Field, Msg, useAction } from "./ui";

export interface Doc {
  id: string;
  owner_type: string;
  owner_id: string;
  doc_type: string;
  content_type: string;
  valid_until: string | null;
  status: string;
  created_at: string;
}

/** Belge önizleme ve onay/red. Her görüntüleme backend'de denetim kaydına yazılır. */
export default function DocumentReview(props: { doc: Doc; onDone: () => void }) {
  const { doc } = props;
  const action = useAction();
  const [preview, setPreview] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState(doc.valid_until ?? "");
  const [note, setNote] = useState("");

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function show() {
    await action.run(async () => {
      if (doc.content_type.startsWith("image/")) setPreview((await blobUrl(`admin/documents/${doc.id}/file`)).url);
      else await download(`admin/documents/${doc.id}/file`, `${doc.doc_type}.pdf`);
    });
  }

  async function review(decision: "onayli" | "reddedildi") {
    const ok = await action.run(() =>
      api(`admin/documents/${doc.id}/review`, {
        body: { decision, valid_until: validUntil || null, note: note.trim() || null },
      }),
    );
    if (ok) props.onDone();
  }

  return (
    <div className="card stack">
      <div className="row spread">
        <strong>{DOCUMENT_TYPE[doc.doc_type] ?? doc.doc_type}</strong>
        <Badge value={doc.status} labels={DOCUMENT_STATUS} />
      </div>
      <div className="hint">
        {doc.owner_type === "driver" ? "Sürücü" : "Araç"} belgesi · yüklenme {d(doc.created_at)} · geçerlilik{" "}
        {d(doc.valid_until)}
      </div>
      <div>
        <button className="btn secondary small" onClick={show} disabled={action.busy}>
          {doc.content_type.startsWith("image/") ? "Görüntüle" : "PDF indir"}
        </button>
      </div>
      {preview && <img className="doc-preview" src={preview} alt="belge" />}
      {doc.status === "beklemede" && (
        <div className="row end">
          <Field label="Geçerlilik bitişi">
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Not (red gerekçesi)">
              <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <button className="btn" disabled={action.busy || !validUntil} onClick={() => review("onayli")}>
            Onayla
          </button>
          <button className="btn danger" disabled={action.busy || !note.trim()} onClick={() => review("reddedildi")}>
            Reddet
          </button>
        </div>
      )}
      <Msg message={action.message} />
    </div>
  );
}
