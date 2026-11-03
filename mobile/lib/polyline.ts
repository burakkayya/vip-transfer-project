// Google "encoded polyline" (hassasiyet 5) çözücü. Backend `route_polyline` alanını bu biçimde döndürür.
// Biçim: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
import type { LatLng } from "@/components/mapTypes";

export type { LatLng };

const PRECISION = 1e5;

export function decodePolyline(s: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= s.length) return null;
      byte = s.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < s.length) {
    const dLat = next();
    const dLng = next();
    // Kesik veya bozuk dize: o ana kadar çözülen noktalar döner.
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ latitude: lat / PRECISION, longitude: lng / PRECISION });
  }
  return points;
}
