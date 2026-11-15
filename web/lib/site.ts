// Şirket bilgileri yasal sayfalarda kullanılır. Hukukçu onayı ile doldurulmalı (acik_konular.md).
export const company = {
  name: "Getaway Transfers",
  legalName: "[Şirket unvanı]",
  address: "[Adres], Antalya, Türkiye",
  email: "info@getawaytransfers.com",
  kvkkEmail: "kvkk@getawaytransfers.com",
  tursabNo: "[TÜRSAB belge no]",
  mersis: "[MERSİS no]",
};

export const MARKETING_CONSENT_VERSION = "1.0";

// Telefon ülke kodu ve para birimi aynı seçimden gelir (K-13: TR → TRY, diğerleri EUR).
export const countries: { code: string; dial: string; name: string }[] = [
  { code: "TR", dial: "+90", name: "Türkiye" },
  { code: "DE", dial: "+49", name: "Deutschland" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
  { code: "RU", dial: "+7", name: "Россия" },
  { code: "NL", dial: "+31", name: "Nederland" },
  { code: "AT", dial: "+43", name: "Österreich" },
  { code: "CH", dial: "+41", name: "Schweiz" },
  { code: "BE", dial: "+32", name: "België" },
  { code: "FR", dial: "+33", name: "France" },
  { code: "PL", dial: "+48", name: "Polska" },
  { code: "UA", dial: "+380", name: "Україна" },
  { code: "KZ", dial: "+7", name: "Қазақстан" },
  { code: "SE", dial: "+46", name: "Sverige" },
  { code: "DK", dial: "+45", name: "Danmark" },
  { code: "NO", dial: "+47", name: "Norge" },
  { code: "IT", dial: "+39", name: "Italia" },
  { code: "ES", dial: "+34", name: "España" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "PT", dial: "+351", name: "Portugal" },
  { code: "BR", dial: "+55", name: "Brasil" },
  { code: "MX", dial: "+52", name: "México" },
  { code: "AR", dial: "+54", name: "Argentina" },
  { code: "SA", dial: "+966", name: "السعودية" },
  { code: "AE", dial: "+971", name: "الإمارات" },
  { code: "QA", dial: "+974", name: "قطر" },
  { code: "KW", dial: "+965", name: "الكويت" },
  { code: "EG", dial: "+20", name: "مصر" },
  { code: "CN", dial: "+86", name: "中国" },
  { code: "JP", dial: "+81", name: "日本" },
  { code: "KR", dial: "+82", name: "대한민국" },
];

export const defaultCountry: Record<string, string> = {
  tr: "TR", en: "GB", de: "DE", es: "ES", ru: "RU", fr: "FR", ar: "SA", zh: "CN", ja: "JP", it: "IT", pt: "PT", ko: "KR",
};
