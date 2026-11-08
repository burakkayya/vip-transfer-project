// Web: stilize harita (SVG). Ekranlara Uber tarzı derinlik verir: sahil, yeşil alanlar, yol ağı,
// animasyonla çizilen rota, hareket eden araç ve konum nabzı. iOS/Android'de MapCanvas.tsx
// (react-native-maps) kullanılır; Metro web'de bu dosyayı seçer. `route`, `driver` ve
// `accessibilitySummary` prop'ları burada yok sayılır.
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import GoogleMapWeb, { MAPS_BROWSER_KEY } from "./GoogleMapWeb";
import type { MapCanvasProps } from "./mapTypes";
import { colors } from "./ui";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

const W = 400;
const H = 640;

type Pt = { x: number; y: number };

/** Kod/metinden tekrarlanabilir sayı üretir: aynı rezervasyon hep aynı haritayı görür. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function bezier(t: number, a: Pt, c1: Pt, c2: Pt, b: Pt): Pt {
  "worklet";
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

export type { MapCanvasProps, MapMode } from "./mapTypes";

/**
 * Tarayıcı anahtarı (EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) varsa native ile aynı gerçek Google haritası
 * (nokta yoksa Antalya); anahtar yoksa ya da Google reddederse aşağıdaki stilize SVG harita.
 */
export default function MapCanvas(props: MapCanvasProps) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  if (MAPS_BROWSER_KEY && !failed) return <GoogleMapWeb {...props} onFail={onFail} />;
  return <StylizedMap {...props} />;
}

function StylizedMap(props: MapCanvasProps) {
  const mode = props.mode ?? "idle";
  const theme = props.dark ? DARK : LIGHT;
  const [box, setBox] = useState({ w: 390, h: 360 });
  // "slice" ölçeklemesinde görünen viewBox penceresi; rota ve konum bu pencereye yerleştirilir.
  const scale = Math.max(box.w / W, box.h / H);
  const visW = box.w / scale;
  const visH = (box.h - (props.hiddenBottom ?? 66)) / scale;
  const x0 = (W - visW) / 2;
  const y0 = (H - box.h / scale) / 2;

  const map = useMemo(() => {
    const r = rng(props.seed ?? "getaway");
    // Sahil: sol alttan sağa uzanan dalgalı kıyı.
    const coastY = H * (0.78 + r() * 0.08);
    let coast = `M0 ${coastY}`;
    for (let x = 0; x <= W; x += 40) coast += ` Q${x + 20} ${coastY + (r() - 0.5) * 36} ${x + 40} ${coastY - x * 0.12 + (r() - 0.5) * 20}`;
    coast += ` L${W} ${H} L0 ${H} Z`;
    // Yol ağı: hafif eğik ızgara + iki ana arter.
    const minor: string[] = [];
    for (let i = 0; i < 9; i++) {
      const y = 30 + i * 72 + r() * 20;
      minor.push(`M-20 ${y} L${W + 20} ${y + (r() - 0.5) * 60}`);
    }
    for (let i = 0; i < 7; i++) {
      const x = 20 + i * 64 + r() * 18;
      minor.push(`M${x} -20 L${x + (r() - 0.5) * 70} ${H + 20}`);
    }
    const majorA = `M-20 ${H * 0.62} C ${W * 0.3} ${H * 0.5}, ${W * 0.55} ${H * 0.66}, ${W + 20} ${H * 0.42}`;
    const majorB = `M${W * 0.62} -20 C ${W * 0.5} ${H * 0.3}, ${W * 0.78} ${H * 0.5}, ${W * 0.7} ${H + 20}`;
    const parks = Array.from({ length: 4 }).map(() => ({
      x: r() * (W - 90),
      y: r() * (H * 0.6),
      w: 50 + r() * 70,
      h: 40 + r() * 60,
    }));
    const blocks = Array.from({ length: 26 }).map(() => ({
      x: r() * W,
      y: r() * H * 0.75,
      w: 14 + r() * 26,
      h: 10 + r() * 22,
    }));
    // Rota: alış (sol alt) → varış (sağ üst), görünür alanın içinde (üstte yüzen düğmelere pay bırakılır).
    const a: Pt = { x: x0 + visW * (0.18 + r() * 0.1), y: y0 + visH * (0.8 + r() * 0.06) };
    const b: Pt = { x: x0 + visW * (0.62 + r() * 0.12), y: y0 + visH * (0.42 + r() * 0.08) };
    const c1: Pt = { x: a.x + (b.x - a.x) * 0.1 + 60, y: a.y - 40 };
    const c2: Pt = { x: b.x - 80, y: b.y + (a.y - b.y) * 0.55 };
    return { coast, minor, majorA, majorB, parks, blocks, a, b, c1, c2 };
  }, [props.seed, x0, y0, visW, visH]);

  const route = `M${map.a.x} ${map.a.y} C ${map.c1.x} ${map.c1.y}, ${map.c2.x} ${map.c2.y}, ${map.b.x} ${map.b.y}`;
  const LEN = 900;

  const draw = useSharedValue(0);
  const pulse = useSharedValue(0);
  const car = useSharedValue(props.progress ?? 0);

  useEffect(() => {
    draw.value = 0;
    if (mode !== "idle") draw.value = withDelay(250, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
  }, [mode, route, draw, pulse]);

  useEffect(() => {
    if (props.progress !== undefined) car.value = withTiming(props.progress, { duration: 1200 });
    else if (mode === "driver") car.value = withRepeat(withTiming(1, { duration: 16000, easing: Easing.linear }), -1, false);
  }, [props.progress, mode, car]);

  const routeProps = useAnimatedProps(() => ({ strokeDashoffset: LEN * (1 - draw.value) }));
  const pulseProps = useAnimatedProps(() => ({ r: 10 + pulse.value * 28, opacity: 0.35 * (1 - pulse.value) }));
  const { a, b, c1, c2 } = map;
  const carProps = useAnimatedProps(() => {
    const p = bezier(car.value, a, c1, c2, b);
    return { transform: `translate(${p.x} ${p.y})` };
  });

  const here = mode === "idle" ? { x: x0 + visW * 0.5, y: y0 + visH * 0.58 } : a;

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.land }, props.style]}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && (Math.abs(width - box.w) > 2 || Math.abs(height - box.h) > 2)) setBox({ w: width, h: height });
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.sea1} />
            <Stop offset="1" stopColor={theme.sea2} />
          </LinearGradient>
        </Defs>
        <Rect width={W} height={H} fill={theme.land} />
        {map.blocks.map((k, i) => (
          <Rect key={`b${i}`} x={k.x} y={k.y} width={k.w} height={k.h} rx={3} fill={theme.block} />
        ))}
        {map.parks.map((p, i) => (
          <Rect key={`p${i}`} x={p.x} y={p.y} width={p.w} height={p.h} rx={18} fill={theme.park} />
        ))}
        <Path d={map.coast} fill="url(#sea)" />
        {map.minor.map((d, i) => (
          <Path key={`m${i}`} d={d} stroke={theme.road} strokeWidth={5} fill="none" strokeLinecap="round" />
        ))}
        <Path d={map.majorA} stroke={theme.casing} strokeWidth={13} fill="none" />
        <Path d={map.majorA} stroke={theme.major} strokeWidth={9} fill="none" />
        <Path d={map.majorB} stroke={theme.casing} strokeWidth={11} fill="none" />
        <Path d={map.majorB} stroke={theme.road} strokeWidth={8} fill="none" />

        {mode !== "idle" && (
          <G>
            <Path d={route} stroke="#fff" strokeWidth={10} fill="none" strokeLinecap="round" opacity={0.9} />
            <AnimatedPath
              d={route}
              stroke={theme.route}
              strokeWidth={5}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={LEN}
              animatedProps={routeProps}
            />
            {/* Varış: kare */}
            <Rect x={b.x - 9} y={b.y - 9} width={18} height={18} rx={3} fill={theme.route} />
            <Rect x={b.x - 3.5} y={b.y - 3.5} width={7} height={7} fill="#fff" />
          </G>
        )}

        {/* Alış / bulunduğunuz yer: nabız atan nokta */}
        <AnimatedCircle cx={here.x} cy={here.y} fill={mode === "idle" ? colors.accent : theme.route} animatedProps={pulseProps} />
        <Circle cx={here.x} cy={here.y} r={11} fill="#fff" />
        <Circle cx={here.x} cy={here.y} r={7} fill={mode === "idle" ? colors.accent : theme.route} />

        {mode === "driver" && (
          <AnimatedG animatedProps={carProps}>
            <Circle r={16} fill="#fff" opacity={0.95} />
            <Circle r={12} fill={colors.ink} />
            <Path d="M-5 3 L0 -6 L5 3 L0 1 Z" fill="#fff" />
          </AnimatedG>
        )}
      </Svg>
    </View>
  );
}

const LIGHT = {
  land: "#EFEEEA",
  block: "#E6E4DE",
  park: "#DCE8D3",
  sea1: "#CFE3EA",
  sea2: "#B9D6E1",
  road: "#FFFFFF",
  casing: "#E2DFD7",
  major: "#F6E7C8",
  route: colors.ink,
};

const DARK = {
  land: "#16181B",
  block: "#1D2024",
  park: "#18241C",
  sea1: "#0F1E26",
  sea2: "#0B171E",
  road: "#2A2D33",
  casing: "#1F2227",
  major: "#3A3326",
  route: "#F5F2EA",
};
