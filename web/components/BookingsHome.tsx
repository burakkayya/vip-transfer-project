"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BOOKING_CODE_RE, isUnauthorized, statusClass } from "@/lib/booking";
import { dateTime, money } from "@/lib/format";
import { useApiError, useSession } from "@/lib/hooks";
import { regionLabel } from "@/lib/regions";
import type { Booking } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import { ErrorState } from "./ErrorState";
import OtpLogin from "./OtpLogin";
import { LoadingState } from "./States";

/** Ekran 8: rezervasyon sorgulama (kod ve telefon) ve girişliyse rezervasyon listesi. */
export default function BookingsHome() {
  const t = useTranslations("bookings");
  const to = useTranslations("otp");
  const te = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const { loggedIn, setLoggedIn, error: sessionError, recheck } = useSession();
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState("");
  const errorText = useApiError();
  const [list, setList] = useState<Booking[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Liste alınamazsa "rezervasyonunuz yok" denmez: hata ve yeniden dene; oturum düştüyse giriş.
  const loadList = useCallback(async () => {
    setListError(null);
    try {
      setList(await api<Booking[]>("me/bookings"));
    } catch (e) {
      if (isUnauthorized(e)) {
        setExpired(true);
        setLoggedIn(false);
      } else setListError(errorText(e));
    }
  }, [errorText, setLoggedIn]);

  useEffect(() => {
    if (loggedIn) void loadList();
  }, [loggedIn, loadList]);

  const validCode = BOOKING_CODE_RE.test(code);
  const codeField = (
    <div className="field">
      <label htmlFor="code">{t("code")}</label>
      <input
        id="code"
        placeholder="GA7K3P9Q"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
      />
    </div>
  );

  // Oturum durumu bilinemiyorsa (ağ, süre aşımı, 5xx) giriş değil hata ve yeniden dene; yalnızca 401 girişe götürür.
  if (sessionError) return <ErrorState text={errorText(sessionError)} onRetry={recheck} />;
  // Oturum denetlenirken boş alan yerine yükleniyor durumu (RequireLogin ile aynı metin).
  if (loggedIn === null) return <LoadingState label={to("checking")} />;

  if (!loggedIn) {
    return (
      <div className="card stack login-card">
        <h2>{t("lookupTitle")}</h2>
        {expired && (
          <p className="alert info" role="status">
            {te("unauthorized")}
          </p>
        )}
        <p className="muted">{t("lookupText")}</p>
        {codeField}
        <OtpLogin
          onDone={() => {
            if (validCode) router.push(`/bookings/${code}`);
            else {
              setExpired(false);
              setLoggedIn(true);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <form
        className="card row lookup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (validCode) router.push(`/bookings/${code}`);
        }}
      >
        {codeField}
        <button className="btn" type="submit" disabled={!validCode}>
          {t("find")}
        </button>
      </form>
      {listError ? (
        <ErrorState text={listError} onRetry={() => void loadList()} />
      ) : (
        list === null && <LoadingState label={t("listLoading")} />
      )}
      {list?.length === 0 && (
        <div className="card stack">
          <p>{t("empty")}</p>
          <div>
            <Link className="btn" href="/book">
              {t("newBooking")}
            </Link>
          </div>
        </div>
      )}
      {list?.map((b) => (
        <Link key={b.id} href={`/bookings/${b.booking_code}`} className="card booking-row">
          <div>
            <strong>{b.booking_code}</strong>{" "}
            <span className={`badge ${statusClass(b.status)}`}>{t(`status.${b.status}`)}</span>
            <div className="muted">
              {regionLabel(b.legs[0].pickup_region)} → {regionLabel(b.legs[0].dropoff_region)} ·{" "}
              {dateTime(b.legs[0].pickup_at, locale)}
            </div>
          </div>
          <div className="row">
            <span className="price">
              {money(b.total_amount, b.currency, locale)}
            </span>
            <span className="btn ghost small">{t("view")}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
