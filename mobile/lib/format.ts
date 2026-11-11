// Saatler Türkiye saatiyle gösterilir ve gönderilir (UTC+3, yaz saati yok).
export const TZ = "Europe/Istanbul";

export function money(amount: string | null | undefined, currency: string, locale = "tr"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
}

export function dateTime(iso: string | null | undefined, locale = "tr"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(iso));
}

/** Yalnızca saat, Türkiye saatiyle (uçuşun tahmini inişi). */
export function clock(iso: string | null | undefined, locale = "tr"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: TZ }).format(new Date(iso));
}

export function date(iso: string | null | undefined, locale = "tr"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Seçicide seçilen tarih ve saat Türkiye saati kabul edilir (cihaz başka saat diliminde olsa da):
 * yerel bileşenler alınır, "+03:00" ofseti eklenir.
 */
export function wallClockIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+03:00`;
}

export function wallClockLabel(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
