// Saatler Türkiye saatiyle gösterilir ve gönderilir (UTC+3, yaz saati uygulaması yok).
export const TZ = "Europe/Istanbul";
const TR_OFFSET = "+03:00";

export function money(amount: string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(
    Number(amount),
  );
}

export function dateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(
    new Date(iso),
  );
}

/** `<input type="datetime-local">` değerini Türkiye saatiyle ISO-8601'e çevirir. */
export function localInputToIso(value: string): string {
  return `${value.length === 16 ? value + ":00" : value}${TR_OFFSET}`;
}

/** Şu andan `hours` saat sonrasını, Türkiye saatiyle datetime-local biçiminde verir. */
export function inputFromNow(hours: number): string {
  const d = new Date(Date.now() + hours * 3600_000 + 3 * 3600_000);
  d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 15) * 15, 0, 0);
  return d.toISOString().slice(0, 16);
}
