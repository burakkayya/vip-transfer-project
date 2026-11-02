"use client";

// Hata durumu: sorunu ve çözümü söyler; `onRetry` verilirse "Tekrar dene" düğmesi çıkar.
// İstemci bileşenidir (geri çağırma alır); yükleniyor ve boş durumlar `States.tsx`'te sunucu güvenlidir.
import { useTranslations } from "next-intl";
import Icon from "./Icon";

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
