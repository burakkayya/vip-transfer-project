"use client";

import { useState } from "react";
import { useMe } from "@/components/Shell";
import { Badge, ErrorBox, Field, Msg, PageHead, Table, useAction, useData } from "@/components/ui";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { ROLE } from "@/lib/labels";

interface Staff { id: string; email: string; roles: string[]; status: string; two_factor_enabled: boolean; last_login_at: string | null }

/** Ekran 17: personel ve roller (K-21, K-22). Paylaşımlı hesap açılmaz, her personelin kendi hesabı olur. */
export default function UsersPage() {
  const me = useMe();
  const { data, error, reload } = useData<Staff[]>("admin/users");
  const action = useAction();
  const [form, setForm] = useState({ email: "", password: "", roles: ["operasyon"] as string[] });

  const toggleRole = (roles: string[], r: string) => (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => api("admin/users", { body: form }), "Kullanıcı oluşturuldu. İlk girişte 2FA kurulacak.");
    if (ok) {
      setForm({ email: "", password: "", roles: ["operasyon"] });
      void reload();
    }
  }

  async function patch(u: Staff, body: Record<string, unknown>, text: string) {
    if (await action.run(() => api(`admin/users/${u.id}`, { method: "PATCH", body }), text)) void reload();
  }

  return (
    <div className="stack">
      <PageHead title="Kullanıcılar ve roller" />
      <Msg message={action.message} />
      <ErrorBox error={error} />
      <Table
        rows={data}
        rowKey={(u) => u.id}
        columns={[
          { key: "email", title: "E-posta", render: (u) => <>{u.email}{u.id === me.id && <span className="muted"> (siz)</span>}</> },
          {
            key: "roles",
            title: "Roller",
            render: (u) => (
              <div className="row">
                {Object.entries(ROLE).map(([code, label]) => (
                  <label key={code} className="row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={u.roles.includes(code)}
                      disabled={action.busy || (u.id === me.id && code === "admin")}
                      onChange={() => {
                        const roles = toggleRole(u.roles, code);
                        if (roles.length) void patch(u, { roles }, "Roller güncellendi.");
                      }} />
                    {label}
                  </label>
                ))}
              </div>
            ),
          },
          { key: "2fa", title: "2FA", render: (u) => <Badge value={u.two_factor_enabled ? "aktif" : "beklemede"} labels={{ aktif: "Kurulu", beklemede: "Kurulmadı" }} /> },
          { key: "status", title: "Durum", render: (u) => <Badge value={u.status} labels={{ aktif: "Aktif", pasif: "Pasif" }} /> },
          { key: "login", title: "Son giriş", render: (u) => dt(u.last_login_at) },
          {
            key: "act",
            title: "",
            render: (u) => u.id !== me.id && (
              <div className="row">
                <button className="btn small secondary" onClick={() => patch(u, { status: u.status === "aktif" ? "pasif" : "aktif" }, "Durum güncellendi.")}>
                  {u.status === "aktif" ? "Pasif yap" : "Aktif yap"}
                </button>
                <button className="btn small secondary" onClick={() => confirm("2FA sıfırlansın mı? Kullanıcı bir sonraki girişte yeniden kurar.") && patch(u, { reset_2fa: true }, "2FA sıfırlandı.")}>
                  2FA sıfırla
                </button>
              </div>
            ),
          },
        ]}
      />

      <form className="card stack" onSubmit={create}>
        <h2>Yeni kullanıcı</h2>
        <div className="row end">
          <Field label="E-posta"><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Geçici parola" hint="En az 12 karakter. Güvenli kanaldan iletin.">
            <input required type="password" minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          {Object.entries(ROLE).map(([code, label]) => (
            <label key={code} className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={form.roles.includes(code)} onChange={() => setForm({ ...form, roles: toggleRole(form.roles, code) })} />
              {label}
            </label>
          ))}
        </div>
        <div>
          <button className="btn" type="submit" disabled={action.busy || form.roles.length === 0}>Oluştur</button>
        </div>
      </form>
    </div>
  );
}
