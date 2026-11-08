"use client";

import { useState } from "react";
import { Field, Msg, Select, useAction } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { LOCALE } from "@/lib/labels";

export interface StaffCustomer {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  country_code: string | null;
  locale: string;
  currency: string;
  verified: boolean;
}

/** Sık gelen ülkeler; liste dışı ülke iki harfli kodla yazılır. Para birimi ülkeden çıkar (TR: TRY, diğer: EUR). */
const COUNTRIES: Record<string, string> = {
  TR: "Türkiye", DE: "Almanya", GB: "Birleşik Krallık", RU: "Rusya", NL: "Hollanda", UA: "Ukrayna",
  PL: "Polonya", AT: "Avusturya", CH: "İsviçre", FR: "Fransa", "": "Diğer (kodu yazın)",
};

/**
 * K-54: uygulamayı kullanmayan müşteriyi (WhatsApp, telefon) ekler. Müşteri isterse sonra aynı numarayla
 * SMS koduyla siteye girip rezervasyonlarını görür. Numara kayıtlıysa `onExisting` ile mevcut kayda geçilir.
 */
export default function CustomerForm(props: {
  initialPhone?: string;
  onCreated: (c: StaffCustomer) => void;
  onExisting?: (phone: string) => void;
  submitLabel?: string;
}) {
  const [form, setForm] = useState({
    phone: props.initialPhone ?? "", full_name: "", email: "", country: "TR", other: "", locale: "tr",
  });
  const action = useAction();
  const [existing, setExisting] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const country = (form.country || form.other).trim().toUpperCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setExisting(false);
    let created: StaffCustomer | null = null;
    const ok = await action.run(async () => {
      try {
        created = await api<StaffCustomer>("admin/customers", {
          body: {
            phone: form.phone.trim(),
            full_name: form.full_name.trim(),
            email: form.email.trim() || null,
            country_code: country || null,
            locale: form.locale,
          },
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "customer_exists") setExisting(true);
        throw err;
      }
    }, "Müşteri eklendi.");
    if (ok && created) props.onCreated(created);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row end">
        <Field label="Telefon" hint="Uluslararası biçimde: +4915112345678">
          <input required value={form.phone} inputMode="tel" autoComplete="off" placeholder="+90..."
            onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Ad soyad">
          <input required minLength={2} maxLength={120} value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)} />
        </Field>
        <Field label="E-posta (isteğe bağlı)">
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>
      <div className="row end">
        <Field label="Ülke" hint="Para birimini belirler: Türkiye TRY, diğerleri EUR">
          <Select value={form.country} onChange={(v) => set("country", v)} options={COUNTRIES} />
        </Field>
        {form.country === "" && (
          <Field label="Ülke kodu">
            <input value={form.other} maxLength={2} placeholder="IT" onChange={(e) => set("other", e.target.value)} />
          </Field>
        )}
        <Field label="Dil" hint="SMS ve paylaşım metni bu dilde">
          <Select value={form.locale} onChange={(v) => set("locale", v)} options={LOCALE} />
        </Field>
        <button className="btn" type="submit" disabled={action.busy}>{props.submitLabel ?? "Müşteri ekle"}</button>
      </div>
      <Msg message={action.message} />
      {existing && props.onExisting && (
        <p className="alert info">
          Bu numarayla kayıtlı müşteri var.{" "}
          <button type="button" className="btn link" onClick={() => props.onExisting?.(form.phone.trim())}>
            Mevcut müşteriyi kullan
          </button>
        </p>
      )}
    </form>
  );
}
