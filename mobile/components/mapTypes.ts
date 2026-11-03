// MapCanvas'ın platformdan bağımsız sözleşmesi. Native (MapCanvas.tsx, react-native-maps) ve
// web (MapCanvas.web.tsx, stilize SVG) aynı prop'ları kabul eder; web yeni prop'ları yok sayar.
import type { ViewStyle } from "react-native";

export type LatLng = { latitude: number; longitude: number };

export type MapMode = "idle" | "route" | "driver";

export interface MapCanvasProps {
  seed?: string;
  mode?: MapMode;
  /** Sürücü modunda aracın rota üzerindeki konumu (0–1). Verilmezse araç yavaşça ilerler (yalnız web SVG). */
  progress?: number;
  style?: ViewStyle;
  /** Eski parametre (kullanılmıyor): rota artık görünür alana göre yerleşir. */
  focusTop?: number;
  /** Alttaki panelin örttüğü yükseklik (px); rota bunun üstünde kalır. */
  hiddenBottom?: number;
  dark?: boolean;
  /** Google encoded polyline (hassasiyet 5). Yalnız native harita çizer. */
  route?: string | null;
  /** Sürücünün anlık konumu. Yalnız native harita gösterir. */
  driver?: LatLng | null;
  /** Ekran okuyucu için haritanın tek cümlelik özeti (ör. "Havalimanı → Lara, 18 km"). */
  accessibilitySummary?: string;
}
