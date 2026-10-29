"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApiError } from "@/lib/hooks";
import { countries, defaultCountry } from "@/lib/site";
import CountrySelect from "./CountrySelect";

/** Ekran 4: telefon ile OTP doğrulama. Hesap yoksa backend oluşturur (K-16). */
export default function OtpLogin(props: { onDone: (country: string) => void; country?: string }) {
  const t = useTranslations("otp");
  const tb = useTranslations("book");
  const locale = useLocale();
  const errorText = useApiError();
  const [country, setCountry] = useState(props.country ?? defaultCountry[locale] ?? "GB");
  const [national, setNational] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dial = countries.find((c) => c.code === country)?.dial ?? "+";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const digits = national.replace(/\D/g, "").replace(/^0+/, "");
    const full = `${dial}${digits}`;
    return run(async () => {
      const r = await api<{ dev_code?: string | null }>("auth/otp/request", { body: { phone: full, purpose: "customer", locale } });
      setDevCode(r.dev_code ?? null);
      setPhone(full);
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api("auth/otp/verify", {
        body: { phone, code, purpose: "customer", country_code: country, locale },
      });
      props.onDone(country);
    });
  };

  if (phone === null) {
    return (
      <form onSubmit={send} className="stack">
        <div className="grid grid-2">
          <CountrySelect id="otp-country" label={tb("country")} value={country} onChange={setCountry} showDial />
          <div className="field">
            <label htmlFor="otp-phone">{t("phone")}</label>
            <input
              id="otp-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              placeholder={country === "TR" ? "532 123 45 67" : ""}
              value={national}
              onChange={(e) => setNational(e.target.value)}
            />
            <span className="hint">{t("phoneHint")}</span>
          </div>
        </div>
        {error && <p className="alert error">{error}</p>}
        <button className="btn" type="submit" disabled={busy || national.replace(/\D/g, "").length < 6}>
          {t("sendCode")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="stack">
      <p className="muted">{t("codeSent", { phone })}</p>
      {devCode && (
        <button type="button" className="dev-hint" onClick={() => setCode(devCode)}>
          {t("devCode", { code: devCode })}
        </button>
      )}
      <div className="field">
        <label htmlFor="otp-code">{t("code")}</label>
        <input
          id="otp-code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{4,8}"
          maxLength={8}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {error && <p className="alert error">{error}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || code.length < 4}>
          {t("verify")}
        </button>
        <button type="button" className="btn link" disabled={busy} onClick={() => send()}>
          {t("resend")}
        </button>
        <button type="button" className="btn link" onClick={() => { setPhone(null); setCode(""); }}>
          {t("changePhone")}
        </button>
      </div>
    </form>
  );
}
