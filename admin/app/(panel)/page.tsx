"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Badge, ErrorBox, PageHead, Table, useData } from "@/components/ui";
import { dt } from "@/lib/format";
import { BOOKING_STATUS, LEG_STATUS, PAYMENT_STATUS } from "@/lib/labels";

interface Dashboard {
  today: string;
  todays_trips: { booking_code: string; leg_id: string; pickup_at: string; pickup: string; dropoff: string;
    status: string; driver: string | null }[];
  open_dispatch: number;
  booking_status_counts: Record<string, number>;
  payment_status_counts_7d: Record<string, number>;
  live_locations: { booking_code: string; lat: number; lng: number; at: string }[];
}

/** Ekran 2: bugünkü yolculuklar, canlı konumlar, açık eşleştirmeler, ödeme durumu. */
export default function DashboardPage() {
  const { data, error, reload } = useData<Dashboard>("admin/dashboard");

  useEffect(() => {
    const id = setInterval(reload, 15_000);
    return () => clearInterval(id);
  }, [reload]);

  return (
    <div className="stack">
      <PageHead title="Genel panel">
        <span className="muted">{data?.today}</span>
        <button className="btn secondary small" onClick={reload}>Yenile</button>
      </PageHead>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid cols-4">
            <div className="card">
              <div className="muted">Bugünkü yolculuk</div>
              <div className="stat">{data.todays_trips.length}</div>
            </div>
            <Link href="/dispatch" className="card" style={{ textDecoration: "none" }}>
              <div className="muted">Açık eşleştirme</div>
              <div className="stat" style={{ color: data.open_dispatch ? "var(--danger)" : undefined }}>
                {data.open_dispatch}
              </div>
            </Link>
            <div className="card">
              <div className="muted">Ödeme bekleyen rezervasyon</div>
              <div className="stat">{data.booking_status_counts.odeme_bekliyor ?? 0}</div>
            </div>
            <div className="card">
              <div className="muted">Canlı konum</div>
              <div className="stat">{data.live_locations.length}</div>
            </div>
          </div>

          <div className="grid cols-2">
            <div className="card">
              <h2>Rezervasyon durumları (tümü)</h2>
              {Object.entries(data.booking_status_counts).map(([k, v]) => (
                <div key={k} className="row spread"><Badge value={k} labels={BOOKING_STATUS} /> <strong>{v}</strong></div>
              ))}
            </div>
            <div className="card">
              <h2>Ödemeler (son 7 gün)</h2>
              {Object.keys(data.payment_status_counts_7d).length === 0 && <p className="muted">Ödeme yok.</p>}
              {Object.entries(data.payment_status_counts_7d).map(([k, v]) => (
                <div key={k} className="row spread"><Badge value={k} labels={PAYMENT_STATUS} /> <strong>{v}</strong></div>
              ))}
            </div>
          </div>

          <h2>Bugünkü yolculuklar</h2>
          <Table
            rows={data.todays_trips}
            rowKey={(r) => r.leg_id}
            empty="Bugün yolculuk yok."
            columns={[
              { key: "at", title: "Saat", render: (r) => dt(r.pickup_at) },
              { key: "code", title: "Kod", render: (r) => <span className="mono">{r.booking_code}</span> },
              { key: "route", title: "Rota", render: (r) => `${r.pickup} → ${r.dropoff}` },
              { key: "driver", title: "Sürücü", render: (r) => r.driver ?? <span className="badge danger">Atanmadı</span> },
              { key: "status", title: "Durum", render: (r) => <Badge value={r.status} labels={LEG_STATUS} /> },
            ]}
          />

          <h2>Canlı konumlar</h2>
          <Table
            rows={data.live_locations}
            rowKey={(r) => r.booking_code}
            empty="Aktif yolculukta konum paylaşan sürücü yok."
            columns={[
              { key: "code", title: "Kod", render: (r) => <span className="mono">{r.booking_code}</span> },
              { key: "at", title: "Güncelleme", render: (r) => dt(r.at) },
              {
                key: "map",
                title: "Konum",
                render: (r) => (
                  <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=15/${r.lat}/${r.lng}`}
                    target="_blank" rel="noreferrer">
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </a>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
