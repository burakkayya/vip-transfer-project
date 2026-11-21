"use client";

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, money, pct } from "@/lib/format";
import ChatReview from "@/components/ChatReview";
import ManualBookingPanel, { type ManualInfo } from "@/components/ManualBookingPanel";
import DailyOps, { type DayUsage } from "@/components/DailyOps";
import {
  BOOKING_STATUS,
  BOOKING_TYPE,
  DAILY_PACKAGE,
  LEDGER_STATUS,
  LEG_STATUS,
  MANUAL_PAYMENT_METHOD,
  OFFER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  REFUND_STATUS,
  SERVICE_TYPE,
  TRIP_EVENT,
} from "@/lib/labels";

// K-60: uçuş takibinden gelen sade durum (tahmini iniş saati ile birlikte gösterilir).
const FLIGHT_STATUS: Record<string, string> = {
  planlandi: "Zamanında",
  rotarli: "Rötarlı",
  havada: "Havada",
  indi: "İndi",
  iptal: "Uçuş iptal",
  yonlendirildi: "Yönlendirildi",
  bulunamadi: "Uçuş bulunamadı",
};

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
  flight: { flight_no: string; status: string | null; estimated_at: string | null } | null;
  driver: { first_name: string; vehicle: string; plate: string } | null;
}

interface Detail {
  booking: {
    booking_code: string;
    booking_type: string;
    service_type?: string;
    daily?: { package: string; days: number; hours_per_day: number; km_per_day: number; extra_hour_price: string; extra_km_price: string } | null;
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
    refundable: string;
    /** K-62: "booking" rezervasyon tahsilatı, "tip" bahşiş. */
    purpose?: string;
  }[];
  earnings: {
    id: string;
    leg_id: string;
    driver_id: string;
    net: string;
    currency: string;
    net_try: string | null;
    status: string;
    in_payout: boolean;
  }[];
  refund_target: { payment_id: string; refundable: string; currency: string } | null;
  day_usage?: DayUsage[] | null;
}

// K-57: personel başlamış yolculuğu da iptal edebilir; tamamlanmış yolculukta iade ve hakediş iptali ayrıdır.
const CANCELLABLE = ["odeme_bekliyor", "onaylandi", "atandi", "yolculukta"];
const num = (v: string) => Number(v.replace(",", "."));

/**
 * Ekran 3: rezervasyon detayı, iptal (iade oranı ezilebilir), para iadesi, hakediş iptali, atamaya geçiş.
 * `id` sayfa (sunucu) bileşeninde UUID olarak doğrulanmış ve kodlanmış gelir (WEB-06).
 */
export default function BookingDetail({ id }: { id: string }) {
  const can = useCan();
  const { data, error, reload } = useData<Detail>(`admin/bookings/${id}`);
  const action = useAction();
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [cancelEarnings, setCancelEarnings] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  if (!data) return <ErrorBox error={error} />;
  const b = data.booking;
  const legNo = (legId: string) => b.legs.find((l) => l.id === legId)?.leg_order ?? "?";

  // Elle iade backend'in seçtiği ödemeden yapılır (en yeni ödenmiş ödeme).
  const refundable = Number(data.refund_target?.refundable ?? 0);
  const refundCurrency = data.refund_target?.currency ?? b.currency;
  const amount = num(refundAmount);

  async function cancel() {
    const started = b.status === "yolculukta" ? " Yolculuk başlamış; sürücüye iptal bildirimi gider." : "";
    if (!confirm(`${b.booking_code} iptal edilsin mi?${started}`)) return;
    const ok = await action.run(
      () =>
        api(`admin/bookings/${id}/cancel`, {
          body: {
            reason,
            refund_percent: override === "" ? null : Number(override),
            cancel_driver_earnings: cancelEarnings,
          },
        }),
      "Rezervasyon iptal edildi.",
    );
    if (ok) void reload();
  }

  async function refund() {
    if (!confirm(`Müşteriye ${money(String(amount), refundCurrency)} iade edilsin mi?`)) return;
    const ok = await action.run(
      () => api(`admin/bookings/${id}/refund`, { body: { amount: amount.toFixed(2), reason: refundReason.trim() } }),
      "İade başlatıldı.",
    );
    if (ok) {
      setRefundAmount("");
      setRefundReason("");
      void reload();
    }
  }

  /** K-81: ödenmiş bahşişin tam iadesi; sürücünün bekleyen bahşiş hakedişi iptal edilir. */
  async function refundTip(p: Detail["payments"][number]) {
    const why = prompt(`${money(p.refundable, p.currency)} bahşiş müşteriye iade edilecek ve sürücünün bahşiş hakedişi iptal edilecek. Gerekçe:`);
    if (!why || why.trim().length < 3) return;
    const ok = await action.run(async () => {
      const r = await api<{ status: string }>(`admin/bookings/${id}/tip-refund`, { body: { reason: why.trim() } });
      action.setMessage(r.status === "basarisiz"
        ? { ok: false, text: "Bahşiş iadesi sağlayıcıda başarısız oldu; Finans > Ödemeler ve iadeler'den tekrar deneyin. Bahşiş hakedişi iptal edildi." }
        : { ok: true, text: `Bahşiş iadesi: ${REFUND_STATUS[r.status] ?? r.status}.` });
    });
    if (ok) void reload();
  }

  async function cancelEarning(entryId: string, label: string) {
    const why = prompt(`Sürücü hakedişi (${label}) iptal edilecek. Gerekçe:`);
    if (!why || why.trim().length < 3) return;
    const ok = await action.run(
      () => api(`admin/ledger/${entryId}/cancel`, { body: { reason: why.trim() } }),
      "Hakediş iptal edildi.",
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
            <dt>Tür</dt>
            <dd>
              {b.daily
                ? `${SERVICE_TYPE.gunluk} · ${b.daily.days} gün · ${DAILY_PACKAGE[b.daily.package] ?? b.daily.package} (${b.daily.hours_per_day} sa / ${b.daily.km_per_day} km)`
                : BOOKING_TYPE[b.booking_type]}
            </dd>
            {b.daily && (
              <>
                <dt>Aşım (bilgi)</dt>
                <dd>{money(b.daily.extra_hour_price, b.currency)}/sa · {money(b.daily.extra_km_price, b.currency)}/km</dd>
              </>
            )}
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
            <dt>{b.daily ? "Kiralama" : "Transfer"}</dt><dd>{money(b.quoted_price, b.currency)}</dd>
            <dt>Garanti</dt><dd>{money(b.guarantee_fee, b.currency)}</dd>
            <dt>Toplam</dt><dd><strong>{money(b.total_amount, b.currency)}</strong></dd>
            <dt>EUR karşılığı</dt><dd>{money(data.price_eur, "EUR")}</dd>
            <dt>Komisyon (dondurulmuş)</dt><dd>{pct(data.commission_rate)}</dd>
          </dl>
        </div>
      </div>

      <ManualBookingPanel bookingId={id} status={b.status} total={b.total_amount} currency={b.currency}
        manual={data.manual} onChanged={() => void reload()} />

      <h2>{b.daily ? "Günler" : "Bacaklar"}</h2>
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
                {b.daily ? `${l.pickup_region.name} (gün boyu)` : `${l.pickup_region.name} → ${l.dropoff_region.name}`}
                <div className="hint">
                  {b.daily ? l.pickup_address : [l.pickup_address, l.dropoff_address].filter(Boolean).join(" → ")}
                </div>
              </>
            ),
          },
          { key: "km", title: "Km", align: "right", render: (l) => Number(l.distance_km).toFixed(1) },
          {
            key: "flight",
            title: "Uçuş",
            render: (l) =>
              l.flight ? (
                <>
                  {l.flight.flight_no}
                  {l.flight.status && FLIGHT_STATUS[l.flight.status] ? (
                    <div className="hint">
                      {FLIGHT_STATUS[l.flight.status]}
                      {l.flight.estimated_at && !["iptal", "bulunamadi"].includes(l.flight.status) ? ` · ${dt(l.flight.estimated_at)}` : ""}
                    </div>
                  ) : null}
                </>
              ) : (
                "—"
              ),
          },
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

      {b.daily && data.day_usage && (
        <DailyOps bookingId={id} status={b.status} usage={data.day_usage} onChanged={() => void reload()} />
      )}

      <div className="grid cols-2">
        <div>
          <h2>Yolculuk olayları</h2>
          <Table rows={data.events} rowKey={(e) => e.leg_id + e.event + e.at} empty="Olay yok."
            columns={[
              { key: "leg", title: "Bacak", render: (e) => legNo(e.leg_id) },
              { key: "event", title: "Olay", render: (e) => TRIP_EVENT[e.event] ?? e.event },
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

      {b.legs.some((l) => l.driver) && can("operasyon", "destek") && <ChatReview bookingId={id} />}

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
                {p.purpose === "tip" && <Badge value="tip" labels={{ tip: "Bahşiş" }} />}{" "}
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
          {
            key: "act",
            title: "",
            render: (p) =>
              p.purpose === "tip" && Number(p.refundable) > 0 && can("operasyon", "muhasebe") ? (
                <button className="btn small secondary" type="button" disabled={action.busy} onClick={() => void refundTip(p)}>
                  Bahşişi iade et
                </button>
              ) : null,
          },
        ]}
      />

      {data.earnings.length > 0 && (
        <>
          <h2>Sürücü hakedişleri</h2>
          <Table
            rows={data.earnings}
            rowKey={(e) => e.id}
            columns={[
              { key: "leg", title: "Bacak", render: (e) => legNo(e.leg_id) },
              { key: "driver", title: "Sürücü", render: (e) => <Link href={`/drivers/${e.driver_id}`}>sürücü</Link> },
              { key: "net", title: "Net", align: "right", render: (e) => money(e.net, e.currency) },
              { key: "try", title: "Net (TL)", align: "right", render: (e) => (e.net_try ? money(e.net_try, "TRY") : "kur bekliyor") },
              {
                key: "status",
                title: "Durum",
                render: (e) => (
                  <>
                    <Badge value={e.status} labels={LEDGER_STATUS} />
                    {e.in_payout && e.status === "beklemede" && <div className="hint">Ödeme kaydında, iptal edilemez</div>}
                  </>
                ),
              },
              {
                key: "act",
                title: "",
                render: (e) => can("operasyon", "muhasebe") && e.status === "beklemede" && !e.in_payout && (
                  <button className="btn small danger" disabled={action.busy}
                    onClick={() => cancelEarning(e.id, money(e.net, e.currency))}>
                    Hakedişi iptal et
                  </button>
                ),
              },
            ]}
          />
        </>
      )}

      {can("operasyon", "muhasebe") && refundable > 0 && (
        <div className="card stack">
          <h2>Para iadesi</h2>
          <p className="hint">
            Kalan iade edilebilir tutar: <strong>{money(String(refundable), refundCurrency)}</strong>. İade ödeme
            sağlayıcısına gönderilir (elle tahsilatta muhasebe kapatır) ve denetim kaydına yazılır.
          </p>
          <div className="row end">
            <Field label={`Tutar (${refundCurrency})`}>
              <input inputMode="decimal" value={refundAmount} placeholder="0,00" style={{ width: 140 }}
                onChange={(e) => setRefundAmount(e.target.value)} />
            </Field>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Field label="Gerekçe (zorunlu, denetim kaydına yazılır)">
                <input value={refundReason} maxLength={255} onChange={(e) => setRefundReason(e.target.value)} />
              </Field>
            </div>
            <button className="btn secondary" type="button" onClick={() => setRefundAmount(refundable.toFixed(2))}>
              Tamamı
            </button>
            <button className="btn danger" onClick={refund}
              disabled={action.busy || refundReason.trim().length < 3 || !(amount > 0) || amount > refundable + 0.001}>
              İade et
            </button>
          </div>
        </div>
      )}

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
              {b.status === "yolculukta" ? "Yolculuğu iptal et" : "İptal et"}
            </button>
          </div>
          {data.earnings.some((e) => e.status === "beklemede" && !e.in_payout) && (
            <label className="row">
              <input type="checkbox" checked={cancelEarnings} onChange={(e) => setCancelEarnings(e.target.checked)} />
              Bekleyen sürücü hakedişlerini de iptal et
            </label>
          )}
        </div>
      )}
    </div>
  );
}
