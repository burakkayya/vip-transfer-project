// Satır içi SVG ikonlar (harici ikon servisi yok, CSP ve gizlilik için).
const PATHS = {
  pin: "M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  plane: "M2.5 13.5 21 7l-1.5-2.5-7 2-5-4H5.5l3 5-4 1.2-2-1.7H1l1.5 6.5Zm1 6.5h17",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 8.5v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3 3 0 0 1 0 5.8",
  bag: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 7h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm4 0v13m6-13v13",
  swap: "M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3",
  car: "M5 16h14M3.5 16v-3.2a2 2 0 0 1 .6-1.4L6.5 9l1.6-3.3A1 1 0 0 1 9 5h6a1 1 0 0 1 .9.6L17.5 9l2.4 2.4a2 2 0 0 1 .6 1.4V16a1 1 0 0 1-1 1h-1M3.5 16a1 1 0 0 0 1 1h1M6.5 9h11M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  van: "M2.5 15.5V7a2 2 0 0 1 2-2h10l5 5v5.5a1 1 0 0 1-1 1h-1.5M2.5 15.5a1 1 0 0 0 1 1h1.5M14.5 5v5h5M9 16.5h6M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bus: "M5 17V5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5V17M5 17h14M5 17v2.5M19 17v2.5M5 11h14M8 14.5h.01M16 14.5h.01M9 6h6",
  shield: "M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6l-7-3Zm-3 9 2 2 4-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 1.5",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h3",
  check: "M5 12.5 10 17 19 7",
  refund: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
  star: "m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9L12 3Z",
  phone: "M5 4h3l1.5 4-2 1.5a11 11 0 0 0 7 7l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  user: "M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  close: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a3 3 0 0 1 3-3h1m8 3v6a3 3 0 0 1-3 3h-1",
  menu: "M4 7h16M4 12h16M4 17h16",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon(props: { name: IconName; size?: number; className?: string; label?: string }) {
  const size = props.size ?? 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden={props.label ? undefined : true}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

/** Araç tipi koduna göre ikon. */
export function vehicleIcon(code: string): IconName {
  if (code === "minibus" || code === "vip_minibus") return "bus";
  return "van";
}
