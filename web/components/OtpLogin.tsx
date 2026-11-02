"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApiError } from "@/lib/hooks";
import { countries, defaultCountry } from "@/lib/site";
import CountrySelect from "./CountrySelect";

/**
 * Tekrar gönderme beklemesi (sn). Mobil girişle aynı değer (`mobile/app/login.tsx`).
 * Yalnızca görsel bir frendir: asıl sınır backend'in saatlik kod sınırıdır (429 → `too_many_requests`).
 */
const RESEND_SECONDS = 45;

/** Yazılan numarayı E.164'e çevirir. "+" veya "00" ile başlıyorsa ülke kodu zaten yazılmıştır, ikinci kez eklenmez. */
function toE164(raw: string, dial: string) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return { full: `+${digits}`, valid: digits.length >= 8 };
  if (trimmed.startsWith("00")) return { full: `+${digits.slice(2)}`, valid: digits.length >= 10 };
  const national = digits.replace(/^0+/, "");
  return { full: `${dial}${national}`, valid: national.length >= 6 };
}

/** Ekranda okunur biçim: seçili ülke koduyla başlıyorsa kod ile numara arasında boşluk. */
function displayPhone(full: string, dial: string) {
  return full.startsWith(dial) ? `${dial} ${full.slice(dial.length)}` : full;
}

/** Ekran 4: telefon ile OTP doğrulama. Hesap yoksa backend oluşturur (K-16). */
export default function OtpLogin(props: { onDone: (country: string) => void; country?: string }) {
  const t = useTranslations("otp");
  const tb = useTranslations("book");
  const te = useTranslations("errors");
  const locale = useLocale();
  const errorText = useApiError();
  const [country, setCountry] = useState(props.country ?? defaultCountry[locale] ?? "GB");
  const [national, setNational] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Sunucu veya ağ hatası (her iki adımda). */
  const [error, setError] = useState<string | null>(null);
  /** Alan hatası: telefon adımında numara, kod adımında kod alanına bağlanır. */
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(0);
  /** Bir sonraki çizimden sonra odaklanacak alan (autoFocus yerine; yalnızca kullanıcı eylemiyle). */
  const focusNext = useRef<"phone" | "code" | null>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const dial = countries.find((c) => c.code === country)?.dial ?? "+";
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  // Bekleme sayacı: yalnızca bekleme sürerken saniyede bir güncellenir.
  useEffect(() => {
    if (waitUntil === 0) return;
    const id = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= waitUntil) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [waitUntil]);

  // Adım değişince veya hatadan sonra odak ilgili alana gider.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "phone") phoneRef.current?.focus();
    else {
      codeRef.current?.focus();
      codeRef.current?.select();
    }
  });

  async function run(fn: () => Promise<void>, onError?: (e: unknown) => void) {
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      await fn();
    } catch (e) {
      if (onError) onError(e);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const request = (full: string, again: boolean) =>
    run(async () => {
      const r = await api<{ dev_code?: string | null }>("auth/otp/request", { body: { phone: full, purpose: "customer", locale } });
      setDevCode(r.dev_code ?? null);
      setPhone(full);
      setCode("");
      setResent(again);
      const at = Date.now();
      setNow(at);
      setWaitUntil(at + RESEND_SECONDS * 1000);
      focusNext.current = "code";
    });

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const { full, valid } = toE164(national, dial);
    if (!valid) {
      setError(null);
      setFieldError(te("phone"));
      phoneRef.current?.focus();
      return;
    }
    return request(full, false);
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 4) {
      setError(null);
      setFieldError(t("codeRequired"));
      codeRef.current?.focus();
      return;
    }
    return run(
      async () => {
        await api("auth/otp/verify", {
          body: { phone, code, purpose: "customer", country_code: country, locale },
        });
        props.onDone(country);
      },
      (err) => {
        // Yanlış veya süresi dolmuş kod alana bağlanır; ağ ve sınır hataları genel kalır.
        if (err instanceof ApiError && err.code === "otp_invalid") setFieldError(errorText(err));
        else setError(errorText(err));
        focusNext.current = "code";
      },
    );
  };

  const changePhone = () => {
    setPhone(null);
    setCode("");
    setDevCode(null);
    setError(null);
    setFieldError(null);
    setResent(false);
    focusNext.current = "phone";
  };

  const alertBox = error && (
    <p className="alert error" role="alert" id="otp-send-error">
      {error}
    </p>
  );

  if (phone === null) {
    const describedBy = [fieldError ? "otp-phone-error" : null, "otp-phone-hint"].filter(Boolean).join(" ");
    return (
      <form onSubmit={send} className="otp stack" noValidate>
        <div className="grid grid-2">
          <CountrySelect id="otp-country" label={tb("country")} value={country} onChange={setCountry} showDial />
          <div className="field">
            <label htmlFor="otp-phone" id="otp-phone-label">
              {t("phone")}
            </label>
            <div className="phone-input">
              <span className="phone-dial" id="otp-dial" dir="ltr">
                {dial}
              </span>
              <input
                ref={phoneRef}
                id="otp-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                dir="ltr"
                required
                aria-labelledby="otp-phone-label otp-dial"
                aria-describedby={describedBy}
                aria-invalid={fieldError ? true : undefined}
                placeholder={country === "TR" ? "532 123 45 67" : ""}
                value={national}
                onChange={(e) => {
                  setNational(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
            </div>
            {fieldError && (
              <span className="field-error" id="otp-phone-error">
                {fieldError}
              </span>
            )}
            <span className="hint" id="otp-phone-hint">
              {t("phoneHint")}
            </span>
          </div>
        </div>
        {alertBox}
        <div className="otp-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? t("sending") : t("sendCode")}
          </button>
        </div>
      </form>
    );
  }

  const shown = displayPhone(phone, dial);
  const num = (c: React.ReactNode) => (
    <bdi className="otp-number" dir="ltr">
      {c}
    </bdi>
  );
  const codeDescribedBy = [fieldError ? "otp-error" : null, "otp-sent"].filter(Boolean).join(" ");

  return (
    <form onSubmit={verify} className="otp stack" noValidate>
      {/* Gönderim bilgisi canlı bölgedir: tekrar gönderince "yeni kod" duyurulur. */}
      <p className="otp-sent muted" id="otp-sent" role="status">
        {resent ? t.rich("resent", { phone: shown, num }) : t.rich("codeSent", { phone: shown, num })}
      </p>
      {devCode && (
        <button type="button" className="dev-hint" onClick={() => { setCode(devCode); setFieldError(null); }}>
          {t("devCode", { code: devCode })}
        </button>
      )}
      <div className="field">
        <label htmlFor="otp-code">{t("code")}</label>
        <input
          ref={codeRef}
          id="otp-code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={8}
          required
          aria-describedby={codeDescribedBy}
          aria-invalid={fieldError ? true : undefined}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ""));
            if (fieldError) setFieldError(null);
          }}
        />
        {fieldError && (
          <span className="field-error" id="otp-error" role="alert">
            {fieldError}
          </span>
        )}
      </div>
      {alertBox}
      <div className="otp-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t("verifying") : t("verify")}
        </button>
      </div>
      <div className="otp-links">
        <button
          type="button"
          className="btn link otp-resend"
          disabled={busy || wait > 0}
          onClick={() => void request(phone, true)}
        >
          {wait > 0 ? t("resendIn", { s: wait }) : t("resend")}
        </button>
        <button type="button" className="btn link" onClick={changePhone}>
          {t("changePhone")}
        </button>
      </div>
    </form>
  );
}
