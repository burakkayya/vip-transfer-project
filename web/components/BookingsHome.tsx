"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { BOOKING_CODE_RE, isUnauthorized, statusClass } from "@/lib/booking";
import { dateTime, money } from "@/lib/format";
import { useApiError, useSession } from "@/lib/hooks";
import { regionLabel } from "@/lib/regions";
import type { Booking } from "@/lib/types";
import { Link, useRouter } from "@/i18n/navigation";
import { ErrorState } from "./ErrorState";
import OtpLogin from "./OtpLogin";
import { EmptyState, LoadingState } from "./States";

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
  /**
   * Alan ne zaman denetlendi: yazarken hiç; odak formun dışına (başka bir alana) geçince "blur";
   * gönderimde veya girişten sonra "submit". Boş kod yalnızca oturumluyken gönderimde hatadır (oturumsuzken isteğe bağlı).
   */
  const [checked, setChecked] = useState<"none" | "blur" | "submit">("none");
  const codeRef = useRef<HTMLInputElement>(null);
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
  // Kod oturumsuzken isteğe bağlıdır (boşsa giriş sonrası liste açılır); doluysa biçimi denetlenir.
  const codeErrorText =
    code === ""
      ? checked === "submit" && loggedIn
        ? t("codeRequired")
        : null
      : checked !== "none" && !validCode
        ? t("codeInvalid")
        : null;
  const codeInvalid = codeErrorText !== null;
  const codeField = (
    <div className="field">
      <label htmlFor="code">{t("code")}</label>
      <input
        ref={codeRef}
        id="code"
        placeholder="GA7K3P9Q"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        dir="ltr"
        aria-invalid={codeInvalid ? true : undefined}
        aria-describedby={codeInvalid ? "code-error code-hint" : "code-hint"}
        value={code}
        onChange={(e) => {
          // `maxLength` yok: "GA7K-3P9Q" gibi yapıştırılan kod ayraçlar atılmadan kesilmesin; 8 karakterden sonrası atılır.
          setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
          setChecked("none");
        }}
        // Hata yalnızca odak formun dışında başka bir alana geçince gösterilir. Düğmeye dokunurken (Safari düğmeye
        // odak vermez: `relatedTarget` boş) veya boş alana tıklarken gösterilmez: hata satırı düğmeyi kaydırır ve
        // dokunuş boşa gider. Gönderimde ve girişten sonra her durumda denetlenir.
        onBlur={(e) => {
          const next = e.relatedTarget;
          const form = e.currentTarget.form;
          if (next instanceof HTMLElement && !(next instanceof HTMLButtonElement) && !form?.contains(next)) {
            setChecked("blur");
          }
        }}
      />
      {codeInvalid && (
        <span className="field-error" id="code-error" role="alert">
          {codeErrorText}
        </span>
      )}
      <span className="hint" id="code-hint">
        {loggedIn ? t("codeHint") : t("codeHintOptional")}
      </span>
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
            // Yanlış biçimli kod girişten sonra da alanda hatasıyla kalır (liste görünümündeki aynı alan).
            if (validCode) router.push(`/bookings/${code}`);
            else {
              // Boş kod: liste açılır, hata yok. Hatalı kod: liste görünümündeki aynı alanda hatasıyla kalır.
              if (code !== "") setChecked("submit");
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
          else {
            setChecked("submit");
            codeRef.current?.focus();
          }
        }}
        noValidate
      >
        {codeField}
        <button className="btn" type="submit">
          {t("find")}
        </button>
      </form>
      {listError ? (
        <ErrorState text={listError} onRetry={() => void loadList()} />
      ) : (
        list === null && <LoadingState label={t("listLoading")} />
      )}
      {list?.length === 0 && (
        <EmptyState
          title={t("empty")}
          text={t("emptyText")}
          action={
            <Link className="btn" href="/book">
              {t("newBooking")}
            </Link>
          }
        />
      )}
      {list && list.length > 0 && (
        <section className="stack" aria-labelledby="bookings-list-title">
          <h2 id="bookings-list-title" className="bookings-list-title">
            {t("listTitle")}
          </h2>
          <ul className="booking-list" aria-labelledby="bookings-list-title">
            {list.map((b) => {
              const leg = b.legs[0];
              return (
                <li key={b.id}>
                  <Link href={`/bookings/${b.booking_code}`} className="card booking-row">
                    <div className="booking-row-main">
                      <span className="booking-row-head">
                        <strong dir="ltr">{b.booking_code}</strong>
                        <span className={`badge ${statusClass(b.status)}`}>{t(`status.${b.status}`)}</span>
                      </span>
                      {leg && (
                        <span className="muted booking-row-route">
                          {regionLabel(leg.pickup_region)} → {regionLabel(leg.dropoff_region)} ·{" "}
                          {dateTime(leg.pickup_at, locale)}
                        </span>
                      )}
                    </div>
                    <div className="booking-row-side">
                      <span className="price">{money(b.total_amount, b.currency, locale)}</span>
                      <span className="btn ghost small" aria-hidden="true">
                        {t("view")}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
