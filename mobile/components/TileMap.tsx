// Android'de Google Maps anahtarı yokken (geliştirme, CI) kullanılan anahtarsız harita (K-58).
// MapCanvas etkileşimsizdir (kaydırma/yakınlaştırma kapalı), bu yüzden Google SDK'sı yerine sabit bir
// "kayan harita" yeterli: görünür alanı kaplayan OpenStreetMap karoları Image olarak dizilir, rota ve
// işaretler SVG ile çizilir. OSM karo kullanım kuralı gereği istekte uygulamayı tanıtan User-Agent
// gönderilir ve atıf gösterilir; yalnızca geliştirme/CI içindir (yoğun kullanıma uygun değil).
// Anahtar tanımlanınca MapCanvas Google haritasına döner.
import { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline, Rect } from "react-native-svg";
import type { LatLng } from "./mapTypes";

const TILE = 256;
const TILE_HEADERS = { "User-Agent": "GetawayTransfers/0.1 (+https://getawaytransfers.com)" };
const ANTALYA: LatLng = { latitude: 36.8969, longitude: 30.7133 };

type Pad = { top: number; right: number; bottom: number; left: number };

/** Web Mercator: enlem/boylam → z yakınlaştırmasında dünya pikseli. */
export function project(p: LatLng, z: number): { x: number; y: number } {
  const scale = TILE * 2 ** z;
  const lat = Math.max(-85.05, Math.min(85.05, p.latitude));
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((p.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Noktaları kenar paylarıyla sığdıran en büyük yakınlaştırma ve merkez (dünya pikseli). */
export function fit(points: LatLng[], w: number, h: number, pad: Pad) {
  const pts = points.length ? points : [ANTALYA];
  const availW = Math.max(40, w - pad.left - pad.right);
  const availH = Math.max(40, h - pad.top - pad.bottom);
  let z = points.length > 1 ? 17 : 13;
  for (; z > 4; z--) {
    const pr = pts.map((p) => project(p, z));
    const dx = Math.max(...pr.map((p) => p.x)) - Math.min(...pr.map((p) => p.x));
    const dy = Math.max(...pr.map((p) => p.y)) - Math.min(...pr.map((p) => p.y));
    if (dx <= availW && dy <= availH) break;
  }
  const pr = pts.map((p) => project(p, z));
  const cx = (Math.max(...pr.map((p) => p.x)) + Math.min(...pr.map((p) => p.x))) / 2;
  const cy = (Math.max(...pr.map((p) => p.y)) + Math.min(...pr.map((p) => p.y))) / 2;
  // Ekran koordinatı = dünya pikseli - köken; nokta kümesinin merkezi dolgulu alanın merkezine gelir.
  const origin = { x: cx - (pad.left + availW / 2), y: cy - (pad.top + availH / 2) };
  return { z, origin };
}

export default function TileMap(props: {
  route: LatLng[];
  preview: boolean;
  pickup?: LatLng;
  dropoff?: LatLng;
  driver: LatLng | null;
  pad: Pad;
  line: string;
  ring: string;
  dark?: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const points = useMemo(() => {
    const all = [...props.route];
    if (props.driver) all.push(props.driver);
    if (!all.length && props.pickup) all.push(props.pickup);
    return all;
  }, [props.route, props.driver, props.pickup]);

  const view = useMemo(() => (size.w ? fit(points, size.w, size.h, props.pad) : null), [points, size, props.pad]);

  const tiles = useMemo(() => {
    if (!view) return [];
    const n = 2 ** view.z;
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let tx = Math.floor(view.origin.x / TILE); tx * TILE < view.origin.x + size.w; tx++) {
      for (let ty = Math.floor(view.origin.y / TILE); ty * TILE < view.origin.y + size.h; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        out.push({
          key: `${view.z}/${tx}/${ty}`,
          uri: `https://tile.openstreetmap.org/${view.z}/${wx}/${ty}.png`,
          left: tx * TILE - view.origin.x,
          top: ty * TILE - view.origin.y,
        });
      }
    }
    return out;
  }, [view, size]);

  const toScreen = (p: LatLng) => {
    const q = project(p, view!.z);
    return { x: q.x - view!.origin.x, y: q.y - view!.origin.y };
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: props.dark ? "#1b1b1d" : "#ece9e2" }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      testID="tile-map"
    >
      {tiles.map((t) => (
        <Image key={t.key} source={{ uri: t.uri, headers: TILE_HEADERS }}
          style={{ position: "absolute", left: t.left, top: t.top, width: TILE, height: TILE, opacity: props.dark ? 0.55 : 1 }} />
      ))}
      {view ? (
        <Svg style={StyleSheet.absoluteFill}>
          {props.route.length > 1 ? (
            <Polyline
              points={props.route.map((p) => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(" ")}
              fill="none" stroke={props.line} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={props.preview ? "2 10" : undefined} />
          ) : null}
          {props.pickup ? (() => { const s = toScreen(props.pickup); return (
            <Circle cx={s.x} cy={s.y} r={7.5} fill={props.line} stroke={props.ring} strokeWidth={3} />
          ); })() : null}
          {props.dropoff ? (() => { const s = toScreen(props.dropoff); return (
            <>
              <Rect x={s.x - 8} y={s.y - 8} width={16} height={16} rx={3} fill={props.line} stroke={props.ring} strokeWidth={2} />
              <Rect x={s.x - 3} y={s.y - 3} width={6} height={6} fill={props.ring} />
            </>
          ); })() : null}
          {props.driver ? (() => { const s = toScreen(props.driver); return (
            <>
              <Circle cx={s.x} cy={s.y} r={16} fill={props.ring} />
              <Circle cx={s.x} cy={s.y} r={12} fill={props.line} />
              <Circle cx={s.x} cy={s.y} r={4} fill={props.ring} />
            </>
          ); })() : null}
        </Svg>
      ) : null}
      <Text style={st.attribution}>© OpenStreetMap</Text>
    </View>
  );
}

const st = StyleSheet.create({
  attribution: {
    position: "absolute", right: 6, top: 112, fontSize: 9, color: "#555",
    backgroundColor: "rgba(255,255,255,0.75)", paddingHorizontal: 3, borderRadius: 2,
  },
});
