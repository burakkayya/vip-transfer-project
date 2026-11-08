// Google Maps JavaScript API yükleyicisi (tarayıcı). Tek kez yüklenir; anahtar yalnızca
// referrer kısıtlı tarayıcı anahtarıdır (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY). Backend'in
// sunucu anahtarı buraya verilmez.

export const MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

const CALLBACK = "__getawayMapsReady";
let loading: Promise<typeof google.maps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

declare global {
  interface Window {
    [CALLBACK]?: () => void;
    gm_authFailure?: () => void;
  }
}

/** Anahtar reddedildiğinde (kısıt, kapalı API) Google bu küresel işlevi çağırır. */
export function onMapsAuthFailure(fn: () => void): () => void {
  if (authFailed) fn();
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function loadGoogleMaps(language: string): Promise<typeof google.maps> {
  if (typeof window === "undefined" || !MAPS_BROWSER_KEY) return Promise.reject(new Error("maps-unavailable"));
  if (typeof window.google?.maps?.importLibrary === "function") return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((fn) => fn());
    };
    window[CALLBACK] = () => resolve(window.google.maps);
    const params = new URLSearchParams({
      key: MAPS_BROWSER_KEY,
      v: "weekly",
      loading: "async",
      language,
      region: "TR",
      callback: CALLBACK,
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("maps-load-failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Google "encoded polyline" (hassasiyet 5) çözücü; backend `route_polyline` alanını bu biçimde döndürür. */
export function decodePolyline(s: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
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
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
