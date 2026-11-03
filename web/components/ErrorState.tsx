"use client";

// Hata durumu: sorunu ve çözümü söyler; `onRetry` verilirse "Tekrar dene" düğmesi çıkar.
// İstemci bileşenidir (geri çağırma alır); yükleniyor ve boş durumlar `States.tsx`'te sunucu güvenlidir.
import { useTranslations } from "next-intl";
import { useRef } from "react";
import Icon from "./Icon";

/**
 * "Tekrar dene"den sonra düğme DOM'dan kalkarsa (yerine yükleniyor durumu gelir) odak `<body>`'ye düşmesin:
 * hâlâ sayfada olan en yakın atanın bölümünde (en çok `main`'e kadar) ilk başlığa, yoksa yükleniyor durumuna,
 * o da yoksa atanın kendisine taşınır. Odak bu arada kullanıcı tarafından başka yere taşındıysa dokunulmaz.
 */
function moveFocusAfterRetry(button: HTMLElement, ancestors: HTMLElement[]) {
  if (button.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const scope = ancestors.find((el) => el.isConnected);
  if (!scope) return;
  let target: HTMLElement | null = null;
  for (let el: HTMLElement | null = scope; el && !target; el = el.parentElement) {
    target = el.querySelector<HTMLElement>("h1, h2");
    if (el.tagName === "MAIN") break;
  }
  target ??= scope.querySelector<HTMLElement>(".state-loading") ?? scope;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export function ErrorState(props: { text: string; onRetry?: () => void }) {
  const t = useTranslations("errors");
  const ref = useRef<HTMLButtonElement>(null);
  function retry() {
    const button = ref.current;
    const ancestors: HTMLElement[] = [];
    for (let el = button?.parentElement ?? null; el; el = el.parentElement) ancestors.push(el);
    props.onRetry?.();
    if (button) requestAnimationFrame(() => moveFocusAfterRetry(button, ancestors));
  }
  return (
    <div className="state state-error" role="alert">
      <p className="state-text">{props.text}</p>
      {props.onRetry && (
        <button ref={ref} type="button" className="btn secondary small" onClick={retry}>
          <Icon name="refund" size={16} /> {t("retry")}
        </button>
      )}
    </div>
  );
}
