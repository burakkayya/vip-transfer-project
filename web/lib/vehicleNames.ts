// K-77: araç tipi adı ziyaretçinin dilinde. Türkçede veritabanındaki ad (admin'in yazdığı) kullanılır;
// tanınmayan tipte de. mobile/lib/vehicles.ts içindeki VEHICLE_NAMES ile aynı tablo.
export const VEHICLE_NAMES: Record<string, Record<string, string>> = {
  minivan: { en: "Minivan", de: "Minivan", es: "Minivan", ru: "Минивэн", fr: "Minivan", ar: "ميني فان", zh: "商务车", ja: "ミニバン", it: "Minivan", pt: "Minivan", ko: "미니밴" },
  vip_van: { en: "VIP Van", de: "VIP Van", es: "VIP Van", ru: "VIP Van", fr: "VIP Van", ar: "فان VIP", zh: "VIP 商务车", ja: "VIP バン", it: "VIP Van", pt: "VIP Van", ko: "VIP 밴" },
  minibus: { en: "Minibus", de: "Kleinbus", es: "Minibús", ru: "Микроавтобус", fr: "Minibus", ar: "حافلة صغيرة", zh: "小巴", ja: "マイクロバス", it: "Minibus", pt: "Micro-ônibus", ko: "미니버스" },
  vip_minibus: { en: "VIP Minibus", de: "VIP-Kleinbus", es: "Minibús VIP", ru: "VIP-микроавтобус", fr: "Minibus VIP", ar: "حافلة صغيرة VIP", zh: "VIP 小巴", ja: "VIP マイクロバス", it: "Minibus VIP", pt: "Micro-ônibus VIP", ko: "VIP 미니버스" },
};

export function vehicleName(v: { code: string; name: string }, locale: string): string {
  if (locale === "tr") return v.name;
  return VEHICLE_NAMES[v.code]?.[locale] ?? VEHICLE_NAMES[v.code]?.en ?? v.name;
}
