"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, money, pct } from "@/lib/format";
import ManualBookingPanel, { type ManualInfo } from "@/components/ManualBookingPanel";
import {
  BOOKING_STATUS,
  BOOKING_TYPE,
  LEG_STATUS,
  MANUAL_PAYMENT_METHOD,
  OFFER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from "@/lib/labels";

interface Leg {
  id: string;
  leg_order: number;
  status: string;
  pickup_region: { name: string };
  dropoff_region: { name: string };
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_at: string;
  distance_km: string;
  flight: { flight_no: string } | null;
  driver: { first_name: string; vehicle: string; plate: string } | null;
}

interface Detail {
  booking: {
    booking_code: string;
    booking_type: string;
    status: string;
    vehicle_type: { name: string };
    passenger_name: string;
    passenger_count: number;
    luggage_count: number;
    note: string | null;
    quoted_price: string;
    guarantee_fee: string;
    total_amount: string;
    currency: string;
    created_at: string;
    cancelled_at: string | null;
    legs: Leg[];
  };
  customer_phone: string;
  customer_name: string | null;
  manual: ManualInfo;
  commission_rate: string;
  price_eur: string;
  cancel_reason: string | null;
  events: { leg_id: string; event: string; at: string }[];
  offers: { leg_id: string; driver_id: string; status: string; offered_at: string }[];
  payments: {
    id: string;
    provider: string;
    merchant_oid: string;
    amount: string;
    currency: string;
    status: string;
    paid_at: string | null;
    manual_method: string | null;
    provider_ref: string | null;
    note: string | null;
    refunds: { id: string; amount: string; percent: number; status: string; reason: string }[];
  }[];
}

const CANCELLABLE = ["odeme_bekliyor", "onaylandi", "atandi"];

/** Ekran 3: rezervasyon detayı, iptal (iade oranı ezilebilir), atamaya geçiş. */
export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, reload } = useData<Detail>(`admin/bookings/${id}`);
  const action = useAction();
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");

  if (!data) return <ErrorBox error={error} />;
  const b = data.booking;
  const legNo = (legId: string) => b.legs.find((l) => l.id === legId)?.leg_order ?? "?";

  async function cancel() {
    if (!confirm(`${b.booking_code} iptal edilsin mi?`)) return;
    const ok = await action.run(
      () =>
        api(`admin/bookings/${id}/cancel`, {
          body: { reason, refund_percent: override === "" ? null : Number(override) },
        }),
      "Rezervasyon iptal edildi.",
    );
    if (ok) void reload();
  }

  return (
    <div className="stack">
      <PageHead title={`Rezervasyon ${b.booking_code}`}>
        <Badge value={b.status} labels={BOOKING_STATUS} />
        <Link href="/bookings" className="btn secondary small">Listeye dön</Link>
      </PageHead>
      <Msg message={action.message} />

      <div className="grid cols-2">
        <div className="card">
          <h2>Özet</h2>
          <dl className="kv">
            <dt>Tür</dt><dd>{BOOKING_TYPE[b.booking_type]}</dd>
            <dt>Araç tipi</dt><dd>{b.vehicle_type.name}</dd>
            <dt>Yolcu</dt><dd>{b.passenger_name} ({b.passenger_count} kişi, {b.luggage_count} bagaj)</dd>
            <dt>Müşteri</dt><dd>{data.customer_name ?? "—"} <span className="mono">{data.customer_phone}</span></dd>
            <dt>Not</dt><dd>{b.note ?? "—"}</dd>
            <dt>Oluşturma</dt><dd>{dt(b.created_at)}</dd>
            {b.cancelled_at && (<><dt>İptal</dt><dd>{dt(b.cancelled_at)}: {data.cancel_reason}</dd></>)}
          </dl>
        </div>
        <div className="card">
          <h2>Fiyat</h2>
          <dl className="kv">
            <dt>Transfer</dt><dd>{money(b.quoted_price, b.currency)}</dd>
            <dt>Garanti</dt><dd>{money(b.guarantee_fee, b.currency)}</dd>
            <dt>Toplam</dt><dd><strong>{money(b.total_amount, b.currency)}</strong></dd>
            <dt>EUR karşılığı</dt><dd>{money(data.price_eur, "EUR")}</dd>
            <dt>Komisyon (dondurulmuş)</dt><dd>{pct(data.commission_rate)}</dd>
          </dl>
        </div>
      </div>

      <ManualBookingPanel bookingId={id} status={b.status} total={b.total_amount} currency={b.currency}
        manual={data.manual} onChanged={() => void reload()} />

      <h2>Bacaklar</h2>
      <Table
        rows={b.legs}
        rowKey={(l) => l.id}
        columns={[
          { key: "no", title: "#", render: (l) => l.leg_order },
          { key: "at", title: "Alış", render: (l) => dt(l.pickup_at) },
          {
            key: "route",
            title: "Rota",
            render: (l) => (
              <>
                {l.pickup_region.name} → {l.dropoff_region.name}
                <div className="hint">{[l.pickup_address, l.dropoff_address].filter(Boolean).join(" → ")}</div>
              </>
            ),
          },
          { key: "km", title: "Km", align: "right", render: (l) => Number(l.distance_km).toFixed(1) },
          { key: "flight", title: "Uçuş", render: (l) => l.flight?.flight_no ?? "—" },
          {
            key: "driver",
            title: "Sürücü",
            render: (l) =>
              l.driver ? `${l.driver.first_name} · ${l.driver.plate}` : (
                can("operasyon") && l.status === "beklemede" && b.status !== "odeme_bekliyor"
                  ? <Link href={`/dispatch?leg=${l.id}`}>Ata</Link> : "—"
              ),
          },
          { key: "status", title: "Durum", render: (l) => <Badge value={l.status} labels={LEG_STATUS} /> },
        ]}
      />

      <div className="grid cols-2">
        <div>
          <h2>Yolculuk olayları</h2>
          <Table rows={data.events} rowKey={(e) => e.leg_id + e.event + e.at} empty="Olay yok."
            columns={[
              { key: "leg", title: "Bacak", render: (e) => legNo(e.leg_id) },
              { key: "event", title: "Olay", render: (e) => e.event },
              { key: "at", title: "Zaman", render: (e) => dt(e.at) },
            ]} />
        </div>
        <div>
          <h2>Teklifler</h2>
          <Table rows={data.offers} rowKey={(o) => o.leg_id + o.driver_id + o.offered_at} empty="Teklif yok."
            columns={[
              { key: "leg", title: "Bacak", render: (o) => legNo(o.leg_id) },
              { key: "driver", title: "Sürücü", render: (o) => <Link href={`/drivers/${o.driver_id}`}>sürücü</Link> },
              { key: "status", title: "Durum", render: (o) => <Badge value={o.status} labels={OFFER_STATUS} /> },
              { key: "at", title: "Gönderim", render: (o) => dt(o.offered_at) },
            ]} />
        </div>
      </div>

      <h2>Ödemeler</h2>
      <Table
        rows={data.payments}
        rowKey={(p) => p.id}
        empty="Ödeme denemesi yok."
        columns={[
          { key: "oid", title: "Sipariş no", render: (p) => <span className="mono">{p.merchant_oid}</span> },
          {
            key: "provider",
            title: "Sağlayıcı",
            render: (p) => (
              <>
                {PAYMENT_PROVIDER[p.provider] ?? p.provider}
                {p.manual_method && ` · ${MANUAL_PAYMENT_METHOD[p.manual_method] ?? p.manual_method}`}
                {(p.provider_ref || p.note) && (
                  <div className="hint">{[p.provider_ref, p.note].filter(Boolean).join(" · ")}</div>
                )}
              </>
            ),
          },
          { key: "amount", title: "Tutar", align: "right", render: (p) => money(p.amount, p.currency) },
          { key: "status", title: "Durum", render: (p) => <Badge value={p.status} labels={PAYMENT_STATUS} /> },
          { key: "paid", title: "Ödeme zamanı", render: (p) => dt(p.paid_at) },
          {
            key: "refunds",
            title: "İadeler",
            render: (p) =>
              p.refunds.length === 0 ? "—" : p.refunds.map((r) => (
                <div key={r.id}>
                  {money(r.amount, p.currency)} (%{r.percent}) <Badge value={r.status} labels={REFUND_STATUS} />
                </div>
              )),
          },
        ]}
      />

      {can("operasyon") && CANCELLABLE.includes(b.status) && (
        <div className="card stack">
          <h2>İptal</h2>
          <div className="row end">
            <div style={{ flex: 1, minWidth: 260 }}>
              <Field label="Gerekçe (zorunlu, denetim kaydına yazılır)">
                <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <Field label="İade oranı (%)" hint="Boş: iptal politikası uygulanır">
              <input type="number" min={0} max={100} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
            <button className="btn danger" disabled={action.busy || reason.trim().length < 3} onClick={cancel}>
              İptal et
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
