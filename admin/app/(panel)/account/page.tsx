"use client";

import { useState } from "react";
import { Field, Msg, PageHead, useAction } from "@/components/ui";
import { api } from "@/lib/api";

/** Personelin kendi parolasını değiştirmesi. Diğer cihazlardaki oturumlar kapatılır. */
export default function AccountPage() {
  const action = useAction();
  const [form, setForm] = useState({ current: "", next: "", repeat: "" });
  const mismatch = form.repeat !== "" && form.next !== form.repeat;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(
      () => api("auth/staff/password", { body: { current_password: form.current, new_password: form.next } }),
      "Parolanız değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.",
    );
    if (ok) setForm({ current: "", next: "", repeat: "" });
  }

  return (
    <div className="stack" style={{ maxWidth: 480 }}>
      <PageHead title="Parolamı değiştir" />
      <form className="card stack" onSubmit={submit}>
        <Field label="Mevcut parola">
          <input type="password" required autoComplete="current-password" value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="Yeni parola" hint="En az 12 karakter. Bir parola yöneticisi kullanmanızı öneririz.">
          <input type="password" required minLength={12} autoComplete="new-password" value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </Field>
        <Field label="Yeni parola (tekrar)">
          <input type="password" required autoComplete="new-password" value={form.repeat}
            onChange={(e) => setForm({ ...form, repeat: e.target.value })} />
        </Field>
        {mismatch && <p className="alert error">Parolalar eşleşmiyor.</p>}
        <Msg message={action.message} />
        <div>
          <button className="btn" type="submit" disabled={action.busy || mismatch || form.next.length < 12}>Değiştir</button>
        </div>
      </form>
    </div>
  );
}
