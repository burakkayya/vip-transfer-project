"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isUnauthorized } from "@/lib/booking";
import { useApiError } from "@/lib/hooks";
import { MARKETING_CONSENT_VERSION } from "@/lib/site";
import type { Profile } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import CountrySelect from "./CountrySelect";
import { useSessionExpired } from "./RequireLogin";

type ConsentRow = { consent_type: string; accepted: boolean; accepted_at: string };

/** Profil, pazarlama onayı (ayrı alınır, geri çekilebilir) ve çıkış. */
export default function AccountPanel() {
  const t = useTranslations("account");
  const tb = useTranslations("book");
  const tf = useTranslations("footer");
  const router = useRouter();
  const errorText = useApiError();
  const sessionExpired = useSessionExpired();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [marketing, setMarketing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Oturum düştüyse (401) `RequireLogin` girişi "oturumunuz sona erdi" notuyla yeniden gösterir.
  useEffect(() => {
    api<Profile>("me/profile")
      .then(setProfile)
      .catch((e) => (isUnauthorized(e) ? sessionExpired() : setMessage({ ok: false, text: errorText(e) })));
    api<ConsentRow[]>("me/consents")
      .then((rows) => setMarketing(rows.find((r) => r.consent_type === "pazarlama")?.accepted ?? false))
      .catch((e) => isUnauthorized(e) && sessionExpired());
  }, [errorText, sessionExpired]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    try {
      const next = await api<Profile>("me/profile", {
        method: "PATCH",
        body: {
          full_name: profile.full_name || null,
          email: profile.email || null,
          country_code: profile.country_code,
        },
      });
      setProfile(next);
      setMessage({ ok: true, text: t("saved") });
    } catch (err) {
      if (isUnauthorized(err)) sessionExpired();
      else setMessage({ ok: false, text: errorText(err) });
    }
  }

  async function toggleMarketing(accepted: boolean) {
    setMarketing(accepted);
    await api("me/consents", {
      body: { consent_type: "pazarlama", accepted, version: MARKETING_CONSENT_VERSION },
    }).catch((err) => (isUnauthorized(err) ? sessionExpired() : setMessage({ ok: false, text: errorText(err) })));
  }

  async function logout() {
    await api("auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  if (!profile) return message ? <p className="alert error">{message.text}</p> : null;

  return (
    <div className="stack">
      <form className="card stack" onSubmit={save}>
        <h2>{t("profile")}</h2>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="phone">{t("phone")}</label>
            <input id="phone" value={profile.phone ?? ""} disabled />
          </div>
          <CountrySelect
            id="country"
            label={tb("country")}
            value={profile.country_code ?? "GB"}
            onChange={(v) => setProfile({ ...profile, country_code: v })}
          />
          <div className="field">
            <label htmlFor="full-name">{t("fullName")}</label>
            <input id="full-name" maxLength={120} value={profile.full_name ?? ""}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input id="email" type="email" value={profile.email ?? ""}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
        </div>
        {message && <p className={`alert ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
        <div>
          <button className="btn" type="submit">
            {t("save")}
          </button>
        </div>
      </form>

      <div className="card stack">
        <h2>{t("marketing")}</h2>
        <label className="check">
          <input type="checkbox" checked={marketing} onChange={(e) => toggleMarketing(e.target.checked)} />
          <span>{t("marketingOn")}</span>
        </label>
      </div>

      <div className="row">
        <Link href="/data-request">{tf("dataRequest")}</Link>
        <button className="btn secondary" type="button" onClick={logout}>
          {t("logout")}
        </button>
      </div>
    </div>
  );
}
