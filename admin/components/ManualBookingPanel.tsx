"use client";

import { useState } from "react";
import { useCan } from "@/components/Shell";
import { Field, Msg, Select, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { dt, money } from "@/lib/format";
import { BOOKING_CHANNEL, BOOKING_SOURCE, MANUAL_PAYMENT_METHOD } from "@/lib/labels";

export interface ManualInfo {
  source: string;
  channel: string | null;
  payment_due_at: string | null;
  system_total_amount: string | null;
  price_override_reason: string | null;
  booking_url: string;
  pay_url: string;
  share_text: string;
}

/**
 * K-54: rezervasyon detayında kaynak ve ödeme işlemleri. Ödeme bekleyen her rezervasyonda ödeme bağlantısı ve
 * paylaşım metni; elle tahsilat yalnızca admin girişli rezervasyonda (K-12: sitede havale yok).
 */
export default function ManualBookingPanel(props: {
  bookingId: string;
  status: string;
  total: string;
  currency: string;
  manual: ManualInfo;
  onChanged: () => void;
}) {
  const can = useCan();
  const m = props.manual;
  const pending = props.status === "odeme_bekliyor";
  const action = useAction();
  const [copied, setCopied] = useState<string | null>(null);
  const [method, setMethod] = useState("havale");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  async function resend() {
    await action.run(() => api(`admin/bookings/${props.bookingId}/resend-sms`, { body: {} }), "Ödeme SMS'i yeniden gönderildi.");
  }

  async function recordPayment() {
    if (!confirm(`${money(props.total, props.currency)} tahsilat kaydedilsin ve rezervasyon onaylansın mı?`)) return;
    const ok = await action.run(
      () => api(`admin/bookings/${props.bookingId}/manual-payment`, {
        body: { method, amount: props.total, reference: reference.trim() || null, note: note.trim() || null },
      }),
      "Tahsilat kaydedildi, rezervasyon onaylandı.",
    );
    if (ok) props.onChanged();
  }

  return (
    <div className="card stack">
      <h2>Kaynak ve ödeme</h2>
      <dl className="kv">
        <dt>Kaynak</dt>
        <dd>{BOOKING_SOURCE[m.source] ?? m.source}{m.channel ? ` · ${BOOKING_CHANNEL[m.channel] ?? m.channel}` : ""}</dd>
        {pending && (<><dt>Son ödeme</dt><dd>{m.payment_due_at ? dt(m.payment_due_at) : "Genel süre (30 dk)"}</dd></>)}
        {m.system_total_amount && (
          <>
            <dt>Fiyat değişikliği</dt>
            <dd>
              Sistem fiyatı {money(m.system_total_amount, props.currency)} → {money(props.total, props.currency)}
              <div className="hint">{m.price_override_reason}</div>
            </dd>
          </>
        )}
      </dl>

      {pending && (
        <Field label="Ödeme bağlantısı" hint="Müşteri SMS koduyla girer ve kartla öder">
          <div className="row">
            <input readOnly value={m.pay_url} className="mono" style={{ flex: 1, minWidth: 220 }} />
            <button className="btn secondary small" type="button" onClick={() => void copy(m.pay_url, "bağlantı")}>Kopyala</button>
          </div>
        </Field>
      )}
      <Field label="Müşteriye gönderilecek özet (WhatsApp vb.)">
        <textarea readOnly rows={7} value={m.share_text} />
      </Field>
      <div className="row">
        <button className="btn secondary small" type="button" onClick={() => void copy(m.share_text, "metin")}>Metni kopyala</button>
        {pending && can("operasyon") && (
          <button className="btn secondary small" type="button" disabled={action.busy} onClick={() => void resend()}>
            Ödeme SMS&apos;ini yeniden gönder
          </button>
        )}
        {copied && <span className="muted" role="status">Kopyalandı ({copied}).</span>}
      </div>

      {pending && can("operasyon") && m.source === "admin" && (
        <div className="stack">
          <h3>Elle tahsilat</h3>
          <div className="row end">
            <Field label="Yöntem">
              <Select value={method} onChange={setMethod} options={MANUAL_PAYMENT_METHOD} />
            </Field>
            <Field label="Tutar">
              <input readOnly value={money(props.total, props.currency)} />
            </Field>
            <Field label="Dekont / makbuz no">
              <input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Not">
              <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button className="btn" type="button" disabled={action.busy} onClick={() => void recordPayment()}>
              Tahsilatı kaydet
            </button>
          </div>
        </div>
      )}
      <Msg message={action.message} />
    </div>
  );
}
