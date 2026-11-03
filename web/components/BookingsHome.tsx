"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { useSession } from "@/lib/hooks";
import type { Booking } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import { statusClass } from "./BookingDetail";
import OtpLogin from "./OtpLogin";
import { LoadingState } from "./States";

const CODE_RE = /^GA[A-Z0-9]{6}$/;

/** Ekran 8: rezervasyon sorgulama (kod ve telefon) ve girişliyse rezervasyon listesi. */
export default function BookingsHome() {
  const t = useTranslations("bookings");
  const to = useTranslations("otp");
  const locale = useLocale();
  const router = useRouter();
  const { loggedIn, setLoggedIn } = useSession();
  const [code, setCode] = useState("");
  const [list, setList] = useState<Booking[] | null>(null);

  useEffect(() => {
    if (loggedIn) api<Booking[]>("me/bookings").then(setList).catch(() => setList([]));
  }, [loggedIn]);

  const validCode = CODE_RE.test(code);
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

  // Oturum denetlenirken boş alan yerine yükleniyor durumu (RequireLogin ile aynı metin).
  if (loggedIn === null) return <LoadingState label={to("checking")} />;

  if (!loggedIn) {
    return (
      <div className="card stack login-card">
        <h2>{t("lookupTitle")}</h2>
        <p className="muted">{t("lookupText")}</p>
        {codeField}
        <OtpLogin
          onDone={() => {
            if (validCode) router.push(`/bookings/${code}`);
            else setLoggedIn(true);
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
              {b.legs[0].pickup_region.name} → {b.legs[0].dropoff_region.name} ·{" "}
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
