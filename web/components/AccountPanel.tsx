"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { useApiError } from "@/lib/hooks";
import { MARKETING_CONSENT_VERSION } from "@/lib/site";
import type { Profile } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import CountrySelect from "./CountrySelect";
import { ErrorState } from "./ErrorState";
import { useSessionExpired } from "./RequireLogin";
import { LoadingState } from "./States";

type ConsentRow = { consent_type: string; accepted: boolean; accepted_at: string };
type Note = { ok: boolean; text: string } | null;

/**
 * Profil, pazarlama onayı (ayrı alınır, geri çekilebilir) ve çıkış.
 * Profil ve onay ayrı yüklenir; her biri kendi yükleniyor ve hata + "Tekrar dene" durumunu taşır.
 * Onay durumu bilinmeden kutu çizilmez (bilinmeyen onay "işaretsiz" gösterilmez); kaydedilemeyen onay işaretli kalmaz.
 */
export default function AccountPanel() {
  const t = useTranslations("account");
  const tb = useTranslations("book");
  const tf = useTranslations("footer");
  const router = useRouter();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<Note>(null);
  /** null: yükleniyor (veya hata). */
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentNote, setConsentNote] = useState<Note>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const busyRef = useRef(false);

  // Oturum düştüyse (401) `RequireLogin` girişi "oturumunuz sona erdi" notuyla yeniden gösterir.
  const loadProfile = useCallback(() => {
    setProfileError(null);
    api<Profile>("me/profile")
      .then(setProfile)
      .catch((e) => (isUnauthorized(e) ? sessionExpired() : setProfileError(errorText(e))));
  }, [errorText, sessionExpired]);

  const loadConsents = useCallback(() => {
    setConsentError(null);
    setMarketing(null);
    api<ConsentRow[]>("me/consents")
      .then((rows) => setMarketing(rows.find((r) => r.consent_type === "pazarlama")?.accepted ?? false))
      .catch((e) => (isUnauthorized(e) ? sessionExpired() : setConsentError(errorText(e))));
  }, [errorText, sessionExpired]);

  useEffect(() => {
    loadProfile();
    loadConsents();
  }, [loadProfile, loadConsents]);

  function edit(patch: Partial<Profile>) {
    if (!profile) return;
    setProfile({ ...profile, ...patch });
    setSaveNote(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const next = await api<Profile>("me/profile", {
        method: "PATCH",
        body: {
          full_name: profile.full_name?.trim() || null,
          email: profile.email?.trim() || null,
          country_code: profile.country_code,
        },
      });
      setProfile(next);
      setSaveNote({ ok: true, text: t("saved") });
    } catch (err) {
      if (isUnauthorized(err)) sessionExpired();
      else setSaveNote({ ok: false, text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  async function toggleMarketing(accepted: boolean) {
    // Kayıt sürerken ikinci tıklama yok sayılır (sıra karışmasın). Kutu ancak kayıt başarılı olunca değişir.
    if (busyRef.current) return;
    busyRef.current = true;
    setConsentBusy(true);
    setConsentNote(null);
    try {
      await api("me/consents", {
        body: { consent_type: "pazarlama", accepted, version: MARKETING_CONSENT_VERSION },
      });
      setMarketing(accepted);
      setConsentNote({ ok: true, text: t(accepted ? "marketingSavedOn" : "marketingSavedOff") });
    } catch (err) {
      if (isUnauthorized(err)) sessionExpired();
      else setConsentNote({ ok: false, text: `${t("marketingFailed")} ${errorText(err)}` });
    } finally {
      busyRef.current = false;
      setConsentBusy(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await api("auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  if (profileError) return <ErrorState text={profileError} onRetry={loadProfile} />;
  if (!profile) return <LoadingState label={t("loading")} />;

  return (
    <div className="stack account">
      <form className="card stack profile-card" onSubmit={save} aria-busy={saving || undefined}>
        <h2>{t("profile")}</h2>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="phone">{t("phone")}</label>
            <input
              id="phone"
              className="readonly"
              dir="ltr"
              value={profile.phone ?? ""}
              readOnly
              aria-describedby="phone-hint"
            />
            <span className="hint" id="phone-hint">
              {t("phoneHint")}
            </span>
          </div>
          <CountrySelect
            id="country"
            label={tb("country")}
            value={profile.country_code ?? "GB"}
            onChange={(v) => edit({ country_code: v })}
          />
          <div className="field">
            <label htmlFor="full-name">{t("fullName")}</label>
            <input
              id="full-name"
              maxLength={120}
              autoComplete="name"
              value={profile.full_name ?? ""}
              onChange={(e) => edit({ full_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              value={profile.email ?? ""}
              onChange={(e) => edit({ email: e.target.value })}
            />
          </div>
        </div>
        {/* Başarı kalıcı canlı bölgede duyurulur; hata `role="alert"`. */}
        <div role="status" className="account-note">
          {saveNote?.ok && <p className="alert ok">{saveNote.text}</p>}
        </div>
        {saveNote && !saveNote.ok && (
          <p className="alert error" role="alert">
            {saveNote.text}
          </p>
        )}
        <div>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>

      <section className="card stack marketing-card" aria-labelledby="marketing-title">
        <h2 id="marketing-title">{t("marketing")}</h2>
        {consentError ? (
          <ErrorState text={consentError} onRetry={loadConsents} />
        ) : marketing === null ? (
          <LoadingState label={t("consentLoading")} />
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={marketing}
                aria-describedby="marketing-hint"
                aria-busy={consentBusy || undefined}
                onChange={(e) => void toggleMarketing(e.target.checked)}
              />
              <span>{t("marketingOn")}</span>
            </label>
            <span className="hint" id="marketing-hint">
              {t("marketingHint")}
            </span>
            <div role="status" className="account-note">
              {consentNote?.ok && <p className="alert ok">{consentNote.text}</p>}
            </div>
            {consentNote && !consentNote.ok && (
              <p className="alert error" role="alert">
                {consentNote.text}
              </p>
            )}
          </>
        )}
      </section>

      <div className="row spread account-actions">
        <Link href="/data-request">{tf("dataRequest")}</Link>
        <button className="btn secondary" type="button" onClick={logout} disabled={loggingOut}>
          {t("logout")}
        </button>
      </div>
    </div>
  );
}
