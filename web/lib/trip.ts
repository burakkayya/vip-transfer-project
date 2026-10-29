// Rota formu durumu. Adres jetonları uzun olduğu için ana sayfadan rezervasyona
// sessionStorage ile taşınır; paylaşılabilir linkler bölge koduyla çalışır (/book?from=ayt&to=kemer).
import { inputFromNow } from "./format";
import type { Endpoint, Place, Region } from "./types";

export interface Trip {
  from: Endpoint | null;
  to: Endpoint | null;
  at: string; // datetime-local, Türkiye saati
  roundTrip: boolean;
  returnAt: string;
  pax: number;
  lug: number;
}

type Params = Record<string, string | string[] | undefined>;
const KEY = "ga_trip";
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function one(p: Params, k: string): string | undefined {
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
}

function int(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function regionEndpoint(r: Region): Endpoint {
  return { label: r.iata_code ? `${r.name} (${r.iata_code})` : r.name, region: r };
}

export function emptyTrip(): Trip {
  return { from: null, to: null, at: inputFromNow(24), roundTrip: false, returnAt: inputFromNow(24 * 8), pax: 2, lug: 2 };
}

/** Sorgu parametresinden (bölge kodu veya kimliği) başlangıç rotası. */
export function tripFromParams(p: Params, regions: Region[]): Trip {
  const find = (v?: string) => regions.find((r) => r.code === v || String(r.id) === v);
  const from = find(one(p, "from"));
  const to = find(one(p, "to"));
  const at = one(p, "at");
  const ret = one(p, "ret");
  const base = emptyTrip();
  return {
    from: from ? regionEndpoint(from) : null,
    to: to ? regionEndpoint(to) : null,
    at: at && DT.test(at) ? at : base.at,
    roundTrip: Boolean(ret && DT.test(ret)),
    returnAt: ret && DT.test(ret) ? ret : base.returnAt,
    pax: int(one(p, "pax"), 2, 1, 50),
    lug: int(one(p, "lug"), 2, 0, 50),
  };
}

export function saveTrip(t: Trip) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // Gizli sekme vb.: rota yalnızca bu sayfada kalır.
  }
}

export function loadTrip(): Trip | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Trip) : null;
  } catch {
    return null;
  }
}

/** Fiyat isteğindeki nokta: adres jetonu varsa o, yoksa bölge kimliği. `note` sürücüye açıklamadır. */
export function toPlace(e: Endpoint, note?: string): Place {
  const address = note?.trim() || null;
  return e.place_token ? { place_token: e.place_token, address } : { region_id: e.region.id, address };
}
