"use client";

/**
 * Girişsiz takip sayfası (K-62). Müşterinin paylaştığı bağlantıyla karşılayan yakını sürücüyü uygulamasız izler.
 * Yalnızca durum, sürücünün adı, araç ve konum gösterilir; telefon, adres ve ödeme bilgisi yoktur.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { clockTime, dateTime, shortTime } from "@/lib/format";
import { usePoll } from "@/lib/poll";
import type { TrackInfo } from "@/lib/types";
import Icon from "./Icon";
import { DriverCard } from "./MeetingTools";
import { LoadingState } from "./States";

const POLL_MS = 10_000;
const FLOW = ["beklemede", "atandi", "yolda", "vardi", "basladi", "bitti"];

export default function TrackView(props: { token: string }) {
  const t = useTranslations("meet");
  const tb = useTranslations("bookings");
  const locale = useLocale();
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);

  usePoll(
    async ({ signal, current }) => {
      try {
        const r = await api<TrackInfo>(`track/${props.token}`, { signal });
        if (!current()) return;
        setInfo(r);
        setFailed(false);
      } catch (e) {
        if (!current()) return;
        if (e instanceof ApiError && e.status === 404) setGone(true);
        else setFailed(true);
      }
    },
    { enabled: !gone, intervalMs: POLL_MS, timeoutMs: POLL_MS - 1000, immediate: true },
  );

  if (gone) {
    return (
      <div className="card stack track-card">
        <h1>{t("trackGoneTitle")}</h1>
        <p className="muted">{t("trackGoneText")}</p>
      </div>
    );
  }
  if (!info) return failed ? <p className="alert error">{t("trackError")}</p> : <LoadingState label={t("loading")} />;

  const idx = FLOW.indexOf(info.status);
  return (
    <div className="stack track-view">
      <section className="card elevated stack track-card" aria-labelledby="track-title">
        <span className="label">{t("trackLabel")}</span>
        <h1 id="track-title">
          {info.pickup_region} → {info.dropoff_region}
        </h1>
        <p className="leg-when">
          <Icon name="calendar" size={16} /> <span>{dateTime(info.pickup_at, locale)}</span>
        </p>
        {info.flight_no && (
          <p className="muted tabular">
            <Icon name="plane" size={16} /> {info.flight_no}
            {info.flight_estimated_at && info.flight_status !== "iptal"
              ? ` · ${tb(info.flight_status === "indi" ? "flightLanded" : "flightEta", { time: shortTime(info.flight_estimated_at, locale) })}`
              : null}
          </p>
        )}
        <ol className="timeline" aria-label={tb("progress")}>
          {FLOW.map((st, i) => (
            <li key={st} className={`${i <= idx ? "done" : ""} ${i === idx ? "current" : ""}`} aria-current={i === idx ? "step" : undefined}>
              {tb(`legStatus.${st}`)}
            </li>
          ))}
        </ol>
        {info.passenger_status && <p className="badge ok">{t(`status.${info.passenger_status}`)}</p>}
        {info.driver && <DriverCard driver={info.driver} photoSrc={`/bff/track/${props.token}/driver-photo`} />}
        <p role="status" className="track-eta">
          {info.eta_minutes !== null && info.status === "yolda" && <strong>{tb("eta", { min: info.eta_minutes })}</strong>}
          {info.status === "vardi" && <strong>{tb("etaArrived")}</strong>}
        </p>
        {info.location && (
          <p className="live-meta">
            <span>{tb("liveUpdated", { time: clockTime(info.location.at, locale) })}</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${info.location.lat},${info.location.lng}`} target="_blank" rel="noreferrer">
              {tb("openMap")}
              <span className="sr-only"> ({tb("newTab")})</span>
            </a>
          </p>
        )}
      </section>
      <p className="hint">{t("trackPrivacy")}</p>
    </div>
  );
}
