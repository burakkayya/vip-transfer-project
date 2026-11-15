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

export function regionLabel(r: Region) {
  return r.iata_code ? `${r.name} (${r.iata_code})` : `${r.name}, ${provinceName(r.province)}`;
}
