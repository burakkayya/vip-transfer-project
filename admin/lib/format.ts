const TZ = "Europe/Istanbul";

export function dt(v: string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(new Date(v));
}

export function d(v: string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: TZ }).format(new Date(v));
}

export function money(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(Number(amount));
}

export function pct(rate: string | number): string {
  return `%${(Number(rate) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

/** datetime-local değerini Türkiye saatiyle ISO'ya çevirir; boşsa null. */
export function localToIso(v: string): string | null {
  return v ? `${v.length === 16 ? v + ":00" : v}+03:00` : null;
}

export function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}
