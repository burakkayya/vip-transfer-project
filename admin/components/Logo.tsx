// Getaway logosu (web sitesindekiyle aynı).
export default function Logo() {
  return (
    <span className="brand">
      <svg width={30} height={30} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0b0b0c" />
        <path d="M21.75 11.18A7.5 7.5 0 1 0 23.5 16H16.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="brand-text">
        <span className="brand-name">GETAWAY</span>
        <span className="brand-sub">ADMIN</span>
      </span>
    </span>
  );
}
