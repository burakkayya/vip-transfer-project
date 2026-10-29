import type { Region, VehicleType } from "./types";

const API_URL = (process.env.GETAWAY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}/api/v1/${path}`, { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    // Backend kapalıysa sayfa yine açılır, istemci listeyi kendisi çeker.
    return fallback;
  }
}

export const getRegions = () => getJson<Region[]>("regions", []);
export const getVehicleTypes = () => getJson<VehicleType[]>("vehicle-types", []);
