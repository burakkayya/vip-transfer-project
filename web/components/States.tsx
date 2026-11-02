// Ortak durum bileşenleri: yükleniyor ve boş. Sunucu ve istemci bileşenlerinden kullanılabilir ("use client" yok).
// Hata durumu geri çağırma aldığı için ayrı istemci dosyasındadır: `@/components/ErrorState`.

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
