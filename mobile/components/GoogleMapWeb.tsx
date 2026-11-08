// Web önizlemesi: gerçek Google haritası (Maps JavaScript API). Yalnızca MapCanvas.web.tsx kullanır.
// Native MapCanvas.tsx ile aynı görsel dil: alış = dolu daire, varış = içi boş kare, sürücü = halkalı nokta,
// rota lake siyah 4 px; rota hesaplanmadan önce kesikli. Harita etkileşimsizdir (panel dokunuşları alır).
// Anahtar referrer kısıtlı tarayıcı anahtarıdır (EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY); yoksa veya Google
// reddederse `onFail` çağrılır ve çağıran stilize SVG haritaya döner.
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { decodePolyline } from "@/lib/polyline";
import { palette } from "@/lib/tokens";
import type { LatLng, MapCanvasProps } from "./mapTypes";

export const MAPS_BROWSER_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

const ANTALYA = { lat: 36.8969, lng: 30.7133 };
const EDGE = 40;
const TOP_INSET = 56;
const DEFAULT_HIDDEN_BOTTOM = 66;
const CALLBACK = "__getawayMapsReady";

type MapsWindow = Window & {
  google: typeof google;
  [CALLBACK]?: () => void;
  gm_authFailure?: () => void;
};

let loading: Promise<typeof google.maps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

function loadMaps(): Promise<typeof google.maps> {
  const w = window as unknown as MapsWindow;
  if (typeof w.google?.maps?.importLibrary === "function") return Promise.resolve(w.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    w.gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((fn) => fn());
    };
    w[CALLBACK] = () => resolve(w.google.maps);
    const params = new URLSearchParams({
      key: MAPS_BROWSER_KEY, v: "weekly", loading: "async", language: "tr", region: "TR", callback: CALLBACK,
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

const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b6b70" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#e6efe4" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ecebe7" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbe6ec" }] },
];

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: palette.lacquerBlack }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: palette.slateFaint }] },
  { elementType: "labels.text.stroke", stylers: [{ color: palette.lacquerBlack }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: palette.lacquerBlackRaised }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: palette.lacquerBlackRaised }] },
];

const toG = (p: LatLng) => ({ lat: p.latitude, lng: p.longitude });

/** Haritaya çizilen HTML işaret (alış, varış, sürücü). */
function marker(g: typeof google.maps, map: google.maps.Map, at: LatLng, html: string) {
  class Pin extends g.OverlayView {
    div: HTMLDivElement | null = null;
    pos = new g.LatLng(at.latitude, at.longitude);
    onAdd() {
      const d = document.createElement("div");
      d.style.position = "absolute";
      d.style.transform = "translate(-50%, -50%)";
      d.innerHTML = html;
      this.div = d;
      this.getPanes()?.overlayLayer.appendChild(d);
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.pos);
      if (!p || !this.div) return;
      this.div.style.left = `${p.x}px`;
      this.div.style.top = `${p.y}px`;
    }
    onRemove() {
      this.div?.remove();
      this.div = null;
    }
    moveTo(next: LatLng) {
      this.pos = new g.LatLng(next.latitude, next.longitude);
      this.draw();
    }
  }
  const pin = new Pin();
  pin.setMap(map);
  return pin;
}

export default function GoogleMapWeb(props: MapCanvasProps & { onFail: () => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const drawn = useRef<{ line?: google.maps.Polyline; pins: google.maps.OverlayView[] }>({ pins: [] });
  const driverPin = useRef<(google.maps.OverlayView & { moveTo: (p: LatLng) => void }) | null>(null);
  const [ready, setReady] = useState(false);
  const { onFail, dark } = props;

  const decoded = useMemo(() => (props.route ? decodePolyline(props.route) : []), [props.route]);
  const preview = decoded.length < 2 && (props.endpoints?.length ?? 0) > 0;
  const route = preview ? (props.endpoints as LatLng[]) : decoded;
  const stops = props.stops;
  const pickup = stops ? stops.pickup ?? undefined : route[0];
  const dropoff = stops ? stops.dropoff ?? undefined : route.length > 1 ? route[route.length - 1] : undefined;
  const driver = props.driver ?? null;
  const bottom = props.hiddenBottom ?? DEFAULT_HIDDEN_BOTTOM;
  const line = dark ? palette.paper : palette.lacquerBlack;
  const ring = dark ? palette.lacquerBlack : palette.paper;

  // Haritayı bir kez kur.
  useEffect(() => {
    let alive = true;
    const fail = () => alive && onFail();
    if (authFailed) {
      fail();
      return;
    }
    authListeners.add(fail);
    loadMaps()
      .then(async (g) => {
        const { Map } = (await g.importLibrary("maps")) as google.maps.MapsLibrary;
        if (!alive || !el.current || map.current) return;
        map.current = new Map(el.current, {
          center: ANTALYA,
          zoom: 10,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          clickableIcons: false,
          backgroundColor: dark ? palette.lacquerBlack : "#f5f5f3",
        });
        setReady(true);
      })
      .catch(fail);
    return () => {
      alive = false;
      authListeners.delete(fail);
    };
  }, [onFail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map.current?.setOptions({ styles: dark ? DARK_STYLE : LIGHT_STYLE });
  }, [ready, dark]);

  // Rota ve alış/varış işaretleri.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const g = window.google.maps;
    drawn.current.line?.setMap(null);
    drawn.current.pins.forEach((p) => p.setMap(null));
    drawn.current = { pins: [] };
    if (route.length > 1) {
      drawn.current.line = new g.Polyline({
        map: m,
        path: route.map(toG),
        clickable: false,
        strokeColor: line,
        strokeOpacity: preview ? 0 : 1,
        strokeWeight: 4,
        icons: preview
          ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: line, scale: 2 }, offset: "0", repeat: "12px" }]
          : undefined,
      });
    }
    if (pickup) {
      drawn.current.pins.push(marker(g, m, pickup,
        `<div style="width:18px;height:18px;border-radius:9px;box-sizing:border-box;border:3px solid ${ring};background:${line}"></div>`));
    }
    if (dropoff) {
      drawn.current.pins.push(marker(g, m, dropoff,
        `<div style="width:18px;height:18px;border-radius:3px;box-sizing:border-box;border:2px solid ${ring};background:${line};display:flex;align-items:center;justify-content:center"><div style="width:6px;height:6px;background:${ring}"></div></div>`));
    }
  }, [ready, route, preview, pickup, dropoff, line, ring]);

  // Sürücü işareti: konum değişince yalnızca taşınır.
  const hasDriver = driver !== null;
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (!driver) {
      driverPin.current?.setMap(null);
      driverPin.current = null;
      return;
    }
    if (driverPin.current) {
      driverPin.current.moveTo(driver);
      return;
    }
    driverPin.current = marker(window.google.maps, m, driver,
      `<div style="width:32px;height:32px;border-radius:16px;background:${ring};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18)"><div style="width:24px;height:24px;border-radius:12px;background:${line};display:flex;align-items:center;justify-content:center"><div style="width:8px;height:8px;border-radius:4px;background:${ring}"></div></div></div>`,
    ) as google.maps.OverlayView & { moveTo: (p: LatLng) => void };
  }, [ready, driver, line, ring]);

  // Kamera: rota (ve sürücü ilk göründüğünde) sığdırılır; panelin örttüğü alt kısım hesaba katılır.
  const fitPoints = useMemo(() => (hasDriver && driver ? [...route, driver] : route), [route, hasDriver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || fitPoints.length === 0) return;
    if (fitPoints.length === 1) {
      m.setCenter(toG(fitPoints[0]));
      m.setZoom(14);
      m.panBy(0, bottom / 2);
      return;
    }
    const b = new window.google.maps.LatLngBounds();
    fitPoints.forEach((p) => b.extend(toG(p)));
    m.fitBounds(b, { top: EDGE + TOP_INSET, right: EDGE, bottom: bottom + EDGE, left: EDGE });
  }, [ready, fitPoints, bottom]);

  const summary = props.accessibilitySummary;
  return (
    <View
      style={[StyleSheet.absoluteFill, props.style]}
      pointerEvents="none"
      accessible={Boolean(summary)}
      accessibilityRole={summary ? "image" : undefined}
      accessibilityLabel={summary}
      importantForAccessibility={summary ? "yes" : "no-hide-descendants"}
    >
      <div ref={el} aria-hidden="true" style={{ position: "absolute", inset: 0 }} />
    </View>
  );
}
