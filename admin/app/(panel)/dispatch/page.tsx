"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, ErrorBox, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { BOOKING_TYPE } from "@/lib/labels";

interface Pending {
  leg_id: string;
  booking_code: string;
  booking_type: string;
  pickup_at: string;
  pickup: string;
  dropoff: string;
  vehicle_type: string;
  passengers: number;
}

interface Candidate {
  driver_id: string;
  driver_name: string;
  is_online: boolean;
  vehicle_id: string;
  plate: string;
  vehicle: string;
}

/** Ekran 4: bekleyen işler ve uygun sürücüler. Planlı işte manuel atama, anlık işte teklif gönderimi. */
function Dispatch() {
  const search = useSearchParams();
  const pending = useData<Pending[]>("admin/dispatch/pending");
  const online = useData<{ id: string; full_name: string }[]>("admin/drivers/online");
  const [legId, setLegId] = useState<string | null>(search.get("leg"));
  const candidates = useData<Candidate[]>(legId ? `admin/dispatch/legs/${legId}/candidates` : null);
  const action = useAction();
  const leg = pending.data?.find((p) => p.leg_id === legId);

  useEffect(() => {
    const id = setInterval(() => {
      void pending.reload();
      void online.reload();
    }, 20_000);
    return () => clearInterval(id);
  }, [pending.reload, online.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(c: Candidate) {
    if (!legId) return;
    const ok = await action.run(
      () => api(`admin/dispatch/legs/${legId}/assign`, { body: { driver_id: c.driver_id, vehicle_id: c.vehicle_id } }),
      `${c.driver_name} atandı.`,
    );
    if (ok) {
      setLegId(null);
      void pending.reload();
    }
  }

  async function offer() {
    if (!legId) return;
    await action.run(async () => {
      const r = await api<{ sent: number }>(`admin/dispatch/legs/${legId}/offer`, { body: {} });
      action.setMessage({ ok: r.sent > 0, text: `${r.sent} çevrimiçi sürücüye teklif gönderildi.` });
    });
  }

  return (
    <div className="stack">
      <PageHead title="Eşleştirme">
        <span className="muted">Çevrimiçi sürücü: {online.data?.length ?? "…"}</span>
        <button className="btn secondary small" onClick={() => pending.reload()}>Yenile</button>
      </PageHead>
      <ErrorBox error={pending.error} />
      <Msg message={action.message} />
      <Table
        rows={pending.data}
        rowKey={(r) => r.leg_id}
        empty="Bekleyen iş yok."
        columns={[
          { key: "at", title: "Alış", render: (r) => dt(r.pickup_at) },
          { key: "code", title: "Kod", render: (r) => <span className="mono">{r.booking_code}</span> },
          { key: "type", title: "Tür", render: (r) => (
              <span className={`badge ${r.booking_type === "anlik" ? "warn" : ""}`}>{BOOKING_TYPE[r.booking_type]}</span>
            ) },
          { key: "route", title: "Rota", render: (r) => `${r.pickup} → ${r.dropoff}` },
          { key: "vt", title: "Araç / yolcu", render: (r) => `${r.vehicle_type} · ${r.passengers}` },
          {
            key: "act",
            title: "",
            render: (r) => (
              <button className={`btn small ${r.leg_id === legId ? "" : "secondary"}`} onClick={() => setLegId(r.leg_id)}>
                Sürücü seç
              </button>
            ),
          },
        ]}
      />

      {legId && (
        <div className="card stack">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>
              Uygun sürücüler {leg && `· ${leg.booking_code} · ${dt(leg.pickup_at)} · ${BOOKING_TYPE[leg.booking_type]}`}
            </h2>
            <div className="row">
              <button className="btn secondary small" onClick={offer} disabled={action.busy}>
                Çevrimiçi sürücülere teklif gönder
              </button>
              <button className="btn link" onClick={() => setLegId(null)}>Kapat</button>
            </div>
          </div>
          <p className="hint">
            Listede yalnızca onaylı, belgeleri geçerli, kapasitesi uygun ve o saatte başka işi olmayan sürücüler
            görünür.
          </p>
          <ErrorBox error={candidates.error} />
          <Table
            rows={candidates.data}
            rowKey={(c) => c.driver_id + c.vehicle_id}
            empty="Uygun sürücü yok."
            columns={[
              { key: "name", title: "Sürücü", render: (c) => <Link href={`/drivers/${c.driver_id}`}>{c.driver_name}</Link> },
              { key: "online", title: "Durum", render: (c) => <Badge value={c.is_online ? "aktif" : "pasif"} labels={{ aktif: "Çevrimiçi", pasif: "Çevrimdışı" }} /> },
              { key: "vehicle", title: "Araç", render: (c) => `${c.vehicle} · ${c.plate}` },
              {
                key: "act",
                title: "",
                render: (c) => (
                  <button className="btn small" disabled={action.busy} onClick={() => assign(c)}>Ata</button>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export default function DispatchPage() {
  return (
    <Suspense>
      <Dispatch />
    </Suspense>
  );
}
