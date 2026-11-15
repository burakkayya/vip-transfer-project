import { airportName } from "./airports";
import type { Region } from "./types";

/** Hizmet verilen iller (K-75); backend `app/provinces.py` ile aynı. */
export const PROVINCE: Record<string, string> = {
  antalya: "Antalya",
  mugla: "Muğla",
  istanbul: "İstanbul",
  ankara: "Ankara",
  izmir: "İzmir",
  nevsehir: "Nevşehir",
  kayseri: "Kayseri",
};

export function provinceName(code: string) {
  return PROVINCE[code] ?? code;
}

/** Bölgenin ziyaretçi dilindeki adı (havalimanları çevrilir, ilçe adları özel addır). */
export function regionName(r: Pick<Region, "name" | "iata_code">, locale: string) {
  return airportName(r.iata_code, locale) ?? r.name;
}

export function regionLabel(r: Region, locale: string) {
  const name = regionName(r, locale);
  return r.iata_code ? `${name} (${r.iata_code})` : `${name}, ${provinceName(r.province)}`;
}
