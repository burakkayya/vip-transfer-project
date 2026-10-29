"use client";

import { useState } from "react";
import { ErrorBox, Field, Msg, PageHead, Select, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";

interface Template { id: number; code: string; locale: string; channel: string; subject: string | null; body: string }

const CHANNELS = { sms: "SMS", email: "E-posta", push: "Push" };
const EMPTY = { code: "", locale: "tr", channel: "sms", subject: "", body: "" };

/** Ekran 15: bildirim şablonları. Değişkenler {booking_code} gibi süslü parantezle yazılır. */
export default function TemplatesPage() {
  const { data, error, reload } = useData<Template[]>("admin/notification-templates");
  const action = useAction();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [filter, setFilter] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await action.run(
      () => api("admin/notification-templates", { method: "PUT", body: { ...form, subject: form.subject || null } }),
      "Şablon kaydedildi.",
    );
    if (ok) {
      setForm(null);
      void reload();
    }
  }

  const rows = data?.filter((t) => !filter || t.code.includes(filter)) ?? null;

  return (
    <div className="stack">
      <PageHead title="Bildirim şablonları">
        <input placeholder="Kod ara" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {!form && <button className="btn small" onClick={() => setForm({ ...EMPTY })}>Yeni şablon</button>}
      </PageHead>
      <Msg message={action.message} />
      {form && (
        <form className="card stack" onSubmit={save}>
          <div className="row end">
            <Field label="Kod"><input required pattern="[a-z0-9_]{2,50}" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
            <Field label="Dil"><input required pattern="[a-z]{2}" maxLength={2} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} /></Field>
            <Field label="Kanal"><Select value={form.channel} onChange={(v) => setForm({ ...form, channel: v })} options={CHANNELS} /></Field>
            <Field label="Konu (e-posta, push)"><input maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          </div>
          <Field label="Metin" hint={form.channel === "sms" ? `${form.body.length} karakter. 160 üstü birden fazla SMS sayılır.` : undefined}>
            <textarea required rows={4} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className="row">
            <button className="btn" type="submit" disabled={action.busy}>Kaydet</button>
            <button className="btn link" type="button" onClick={() => setForm(null)}>Vazgeç</button>
          </div>
        </form>
      )}
      <ErrorBox error={error} />
      <Table
        rows={rows}
        rowKey={(t) => String(t.id)}
        columns={[
          { key: "code", title: "Kod", render: (t) => <span className="mono">{t.code}</span> },
          { key: "locale", title: "Dil", render: (t) => t.locale },
          { key: "channel", title: "Kanal", render: (t) => CHANNELS[t.channel as keyof typeof CHANNELS] ?? t.channel },
          { key: "body", title: "Metin", render: (t) => <>{t.subject && <strong>{t.subject}: </strong>}{t.body}</> },
          {
            key: "act",
            title: "",
            render: (t) => (
              <button className="btn small secondary" onClick={() => setForm({ code: t.code, locale: t.locale, channel: t.channel, subject: t.subject ?? "", body: t.body })}>
                Düzenle
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
