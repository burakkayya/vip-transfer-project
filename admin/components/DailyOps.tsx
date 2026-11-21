"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Badge, Field, Msg, Select, Table, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { LEG_STATUS } from "@/lib/labels";

export interface DayUsage {
  leg_id: string;
  day: number;
  status: string;
  minutes_used: number | null;
  km_used: number | null;
  extra_hours: number;
  extra_km: number;
  extra_amount: string;
  currency: string;
  reported_at: string | null;
}

interface Candidate {
  driver_id: string;
  driver_name: string;
  is_online: boolean;
  vehicle_id: string;
  plate: string;
  vehicle: string;
}

interface DayRefund {
  refund_percent: number;
  refund_amount: string;
  currency: string;
}

const ACTIVE = ["onaylandi", "atandi", "yolculukta"];
const OPEN = ["beklemede", "atandi"];

function hours(minutes: number | null): string {
  if (minutes === null) return "—";
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

/**
 * K-79 günlük kiralama işlemleri (rezervasyon detayı): bütün açık günleri tek sürücüye atama, gün bazında kullanım
 * (saat olaylardan, km sürücü beyanından; aşım bilgi amaçlı) ve tek gün iptali.
 */
export default function DailyOps(props: {
  bookingId: string;
  status: string;
  usage: DayUsage[];
  onChanged: () => void;
}) {
  const can = useCan();
  const action = useAction();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState("");
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [preview, setPreview] = useState<DayRefund | null>(null);

  const active = ACTIVE.includes(props.status);
  const openDays = props.usage.filter((u) => OPEN.includes(u.status));
  const ops = can("operasyon");

  async function loadCandidates() {
    await action.run(async () => {
      const rows = await api<Candidate[]>(`admin/dispatch/bookings/${props.bookingId}/candidates`);
      setCandidates(rows);
      setPick(rows[0] ? `${rows[0].driver_id}|${rows[0].vehicle_id}` : "");
    });
  }

  async function assignAll() {
    const [driverId, vehicleId] = pick.split("|");
    const c = candidates?.find((x) => x.driver_id === driverId && x.vehicle_id === vehicleId);
    if (!c || !confirm(`${openDays.length} günün tamamı ${c.driver_name} (${c.plate}) sürücüsüne atansın mı?`)) return;
    const ok = await action.run(
      () => api(`admin/dispatch/bookings/${props.bookingId}/assign-all`, { body: { driver_id: driverId, vehicle_id: vehicleId } }),
      "Bütün günler atandı.",
    );
    if (ok) {
      setCandidates(null);
      props.onChanged();
    }
  }

  async function previewDay(legId: string) {
    setDay(legId);
    setPreview(null);
    if (!legId) return;
    await action.run(async () => {
      setPreview(await api<DayRefund>(`admin/bookings/${props.bookingId}/days/${legId}/cancellation`));
    });
  }

  async function cancelDay() {
    const u = props.usage.find((x) => x.leg_id === day);
    if (!u || !confirm(`${u.day}. gün iptal edilsin mi? Atanmış sürücüye iptal bildirimi gider.`)) return;
    const ok = await action.run(
      () =>
        api(`admin/bookings/${props.bookingId}/days/${day}/cancel`, {
          body: { reason: reason.trim(), refund_percent: override === "" ? null : Number(override) },
        }),
      `${u.day}. gün iptal edildi.`,
    );
    if (ok) {
      setDay("");
      setReason("");
      setOverride("");
      setPreview(null);
      props.onChanged();
    }
  }

  const candidateOptions = Object.fromEntries(
    (candidates ?? []).map((c) => [
      `${c.driver_id}|${c.vehicle_id}`,
      `${c.driver_name} · ${c.plate} · ${c.vehicle}${c.is_online ? " · çevrimiçi" : ""}`,
    ]),
  );
  const badPercent = override !== "" && !(Number(override) >= 0 && Number(override) <= 100);
  const dayOptions = Object.fromEntries(openDays.map((u) => [u.leg_id, `${u.day}. gün`]));

  return (
    <section className="card stack" aria-labelledby="daily-ops">
      <h2 id="daily-ops">Günlük kiralama: günler</h2>
      <Msg message={action.message} />
      <Table
        rows={props.usage}
        rowKey={(u) => u.leg_id}
        columns={[
          { key: "day", title: "Gün", render: (u) => `${u.day}. gün` },
          { key: "status", title: "Durum", render: (u) => <Badge value={u.status} labels={LEG_STATUS} /> },
          { key: "time", title: "Süre", align: "right", render: (u) => hours(u.minutes_used) },
          {
            key: "km",
            title: "Km (sürücü)",
            align: "right",
            render: (u) => (u.km_used === null ? "—" : <span title={u.reported_at ? `Giriş: ${dt(u.reported_at)}` : undefined}>{u.km_used}</span>),
          },
          {
            key: "extra",
            title: "Aşım (bilgi)",
            align: "right",
            render: (u) =>
              u.extra_hours || u.extra_km
                ? `${u.extra_hours} sa, ${u.extra_km} km · ${money(u.extra_amount, u.currency)}`
                : "—",
          },
        ]}
      />
      <p className="hint">
        Süre sürücünün &quot;Başladı&quot; ve &quot;Bitti&quot; kayıtlarından, km sürücünün gün sonu girişinden gelir. Aşım
        tutarı yalnızca bilgidir; tahsil akışı yoktur.
      </p>

      {ops && active && openDays.length > 0 && (
        <div className="stack">
          <h3>Bütün günleri tek sürücüye ata</h3>
          <p className="hint">
            Yalnızca açık günlerin hepsine uygun (belge, araç, çakışma ve dinlenme süresi) sürücüler listelenir. Bir gün
            bile uygun değilse hiçbiri atanmaz.
          </p>
          {candidates === null ? (
            <div className="row">
              <button className="btn secondary" type="button" disabled={action.busy} onClick={() => void loadCandidates()}>
                Uygun sürücüleri getir
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="alert info">Bütün günlere uygun sürücü yok. Günleri tek tek atayın.</p>
          ) : (
            <div className="row end">
              <Field label="Sürücü ve araç">
                <Select value={pick} onChange={setPick} options={candidateOptions} />
              </Field>
              <button className="btn" type="button" disabled={action.busy || !pick} onClick={() => void assignAll()}>
                {openDays.length} günü ata
              </button>
            </div>
          )}
        </div>
      )}

      {ops && active && openDays.length > 1 && (
        <div className="stack">
          <h3>Tek gün iptali</h3>
          <div className="row end">
            <Field label="Gün">
              <Select value={day} onChange={(v) => void previewDay(v)} options={dayOptions} empty="Seçin" />
            </Field>
            <div style={{ flex: 1, minWidth: 240 }}>
              <Field label="Gerekçe (zorunlu, denetim kaydına yazılır)" hint="En az 3 karakter">
                <input value={reason} maxLength={500} required onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <Field label="İade oranı (%)" hint={badPercent ? "0 ile 100 arasında olmalı" : "Boş: o günün başlangıcına göre politika"}>
              <input type="number" min={0} max={100} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
            <button className="btn danger" type="button" disabled={action.busy || !day || reason.trim().length < 3 || badPercent}
              onClick={() => void cancelDay()}>
              Günü iptal et
            </button>
          </div>
          {preview && (
            <p className="hint" role="status">
              Politika iadesi: {money(preview.refund_amount, preview.currency)} (%{preview.refund_percent})
            </p>
          )}
        </div>
      )}
    </section>
  );
}
