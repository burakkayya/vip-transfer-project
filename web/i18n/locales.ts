// K-77: desteklenen on iki dil ve ziyaretçinin ülkesinden dil seçimi. Bu dosya edge (middleware) ve
// istemci tarafında birlikte kullanılır; Node API'si içermez.

export const LOCALES = ["tr", "en", "de", "es", "ru", "fr", "ar", "zh", "ja", "it", "pt", "ko"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Sağdan sola yazılan diller. */
export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar"]);
export const isRtl = (locale: string) => RTL_LOCALES.has(locale);
export const dirOf = (locale: string): "rtl" | "ltr" => (isRtl(locale) ? "rtl" : "ltr");

/** Dil seçicide her dil kendi adıyla görünür. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  fr: "Français",
  ar: "العربية",
  zh: "简体中文",
  ja: "日本語",
  it: "Italiano",
  pt: "Português",
  ko: "한국어",
};

/** Intl biçimlendirmesinde kullanılan etiket. Arapçada fiyat ve saat Batı rakamlarıyla yazılır (kod, plaka ve
 *  uçuş numarasıyla aynı rakamlar). */
export const INTL_TAG: Record<AppLocale, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
  es: "es-ES",
  ru: "ru-RU",
  fr: "fr-FR",
  ar: "ar-u-nu-latn",
  zh: "zh-CN",
  ja: "ja-JP",
  it: "it-IT",
  pt: "pt-PT",
  ko: "ko-KR",
};

// Ülke (ISO 3166-1 alfa-2) → dil. Listede olmayan ülke İngilizce açılır.
const COUNTRY_GROUPS: Record<Exclude<AppLocale, "en">, string[]> = {
  tr: ["TR"],
  de: ["DE", "AT", "CH", "LI"],
  es: ["ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ"],
  ru: ["RU", "BY", "KZ", "KG"],
  fr: ["FR", "BE", "LU", "MC", "SN", "CI", "ML", "BF", "NE", "TG", "BJ", "GN", "CD", "CG", "GA", "MG", "HT", "TD", "CF", "DJ", "KM", "NC", "PF", "RE", "GP", "MQ", "GF", "YT", "PM", "WF", "BL", "MF"],
  ar: ["SA", "AE", "QA", "KW", "BH", "OM", "YE", "IQ", "JO", "LB", "SY", "PS", "EG", "LY", "TN", "DZ", "MA", "SD", "MR"],
  zh: ["CN", "HK", "MO", "TW"],
  ja: ["JP"],
  it: ["IT", "SM", "VA"],
  pt: ["PT", "BR", "AO", "MZ", "CV", "GW", "ST", "TL"],
  ko: ["KR"],
};

export const COUNTRY_LOCALE: Readonly<Record<string, AppLocale>> = Object.fromEntries(
  Object.entries(COUNTRY_GROUPS).flatMap(([locale, countries]) => countries.map((c) => [c, locale as AppLocale])),
);

const isLocale = (v: string): v is AppLocale => (LOCALES as readonly string[]).includes(v);

/** Accept-Language başlığındaki ilk dil (ör. "de-DE,de;q=0.9" → "de"). */
export function primaryLanguage(acceptLanguage: string | null | undefined): string | null {
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
  if (!first || first === "*") return null;
  return first.split("-")[0] || null;
}

/**
 * Ülkeye göre dil (K-77). Ülkenin dili destekleniyorsa o dil, değilse İngilizce.
 * Tek istisna Türkiye: tarayıcısı Türkçe olmayan ziyaretçi turisttir; tarayıcı dili destekleniyorsa o dil,
 * değilse İngilizce açılır (Antalya'daki Alman Almanca, Hollandalı İngilizce görür). Ülke bilinmiyorsa null döner; çağıran tarayıcı diline düşer.
 */
export function localeForCountry(country: string | null | undefined, acceptLanguage?: string | null): AppLocale | null {
  const cc = country?.trim().toUpperCase();
  if (!cc || !/^[A-Z]{2}$/.test(cc) || cc === "XX" || cc === "T1") return null;
  const byCountry = COUNTRY_LOCALE[cc] ?? "en";
  if (cc === "TR") {
    // Türkiye'de Türkçe olmayan tarayıcı turisttir: desteklenen dilse o dil, değilse İngilizce.
    const browser = primaryLanguage(acceptLanguage);
    if (browser && browser !== "tr") return isLocale(browser) ? browser : "en";
  }
  return byCountry;
}

/** CDN/barındırıcının eklediği ülke başlığı (Cloudflare, Vercel, CloudFront ya da kendi vekilimiz). */
export function countryFromHeaders(headers: Headers): string | null {
  return (
    headers.get("cf-ipcountry") ??
    headers.get("x-vercel-ip-country") ??
    headers.get("cloudfront-viewer-country") ??
    headers.get("x-country-code")
  );
}
