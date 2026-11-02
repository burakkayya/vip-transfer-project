"use client";

// Ortak durum bileşenleri: yükleniyor, boş ve hata. Her ağ çağrısı boş ekran yerine bunlardan birini gösterir.
import { useTranslations } from "next-intl";
import Icon from "./Icon";

/** Yükleniyor: ekran okuyucuya kibarca duyurulur; iskelet satırları içeriğin yerini tutar. */
export function LoadingState(props: { label: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <div className="state-lines" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <p className="state-label">{props.label}</p>
    </div>
  );
}

/** Boş: ne olmadığını söyler, varsa bir sonraki adımı (eylem) önerir. */
export function EmptyState(props: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="state state-empty">
      <h2 className="state-title">{props.title}</h2>
      {props.text && <p className="state-text">{props.text}</p>}
      {props.action && <div className="state-action">{props.action}</div>}
    </div>
  );
}

/** Hata: sorunu ve çözümü söyler; `onRetry` verilirse "Tekrar dene" düğmesi çıkar. */
export function ErrorState(props: { text: string; onRetry?: () => void }) {
  const t = useTranslations("errors");
  return (
    <div className="state state-error" role="alert">
      <p className="state-text">{props.text}</p>
      {props.onRetry && (
        <button type="button" className="btn secondary small" onClick={props.onRetry}>
          <Icon name="refund" size={16} /> {t("retry")}
        </button>
      )}
    </div>
  );
}
