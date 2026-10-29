// Getaway logosu: monogram + harf aralıklı yazı. Renk `currentColor` ile üst öğeden gelir.
export function LogoMark(props: { size?: number; inverted?: boolean }) {
  const size = props.size ?? 30;
  const bg = props.inverted ? "#ffffff" : "#0b0b0c";
  const fg = props.inverted ? "#0b0b0c" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={bg} />
      <path d="M21.75 11.18A7.5 7.5 0 1 0 23.5 16H16.5" fill="none" stroke={fg} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo(props: { inverted?: boolean }) {
  return (
    <span className={`brand ${props.inverted ? "inverted" : ""}`}>
      <LogoMark inverted={props.inverted} />
      <span className="brand-text">
        <span className="brand-name">GETAWAY</span>
        <span className="brand-sub">TRANSFERS</span>
      </span>
    </span>
  );
}
