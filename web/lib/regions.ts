import type { Region } from "./types";

const PROVINCE: Record<string, string> = { antalya: "Antalya", mugla: "Muğla" };

export function provinceName(code: string) {
  return PROVINCE[code] ?? code;
}

export function regionLabel(r: Region) {
  return r.iata_code ? `${r.name} (${r.iata_code})` : `${r.name}, ${provinceName(r.province)}`;
}
