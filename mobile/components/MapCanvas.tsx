// iOS/Android: gerçek harita (react-native-maps; iOS Apple Maps, Android Google Maps).
// Web'de Metro MapCanvas.web.tsx'i (stilize SVG) seçer; iki dosya aynı MapCanvasProps'u kabul eder.
// Rota rayı dili: alış = dolu daire, varış = dolu kare, çizgi lake siyah 4 px.
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, type MapStyleElement, type Region } from "react-native-maps";
import { useReducedMotion } from "react-native-reanimated";

import { GOOGLE_MAPS_ANDROID, GOOGLE_MAPS_IOS } from "@/lib/config";
import { decodePolyline } from "@/lib/polyline";
import { palette } from "@/lib/tokens";
import type { LatLng, MapCanvasProps } from "./mapTypes";
import TileMap from "./TileMap";

export type { MapCanvasProps, MapMode } from "./mapTypes";

/**
 * Android derlemesinde Google Maps anahtarı yoksa (geliştirme, CI) Google SDK'sı geçersiz anahtarla
 * zemini de karo katmanlarını da çizmez: harita boş kalmasın diye Google SDK'sı hiç kullanılmaz,
 * anahtarsız OpenStreetMap karolu sabit harita (TileMap) çizilir. Anahtar tanımlanınca
 * (GETAWAY_GOOGLE_MAPS_ANDROID_KEY) Google haritası kendiliğinden döner.
 */
const OSM_TILES = Platform.OS === "android" && !GOOGLE_MAPS_ANDROID;

/** Rota yokken gösterilen bölge: Antalya merkezi. */
export const ANTALYA_REGION: Region = { latitude: 36.8969, longitude: 30.7133, latitudeDelta: 0.35, longitudeDelta: 0.35 };

/** Varsayılan alt panel örtüsü (MapSheet: harita mapH+40, panel mapH-26'da başlar). */
const DEFAULT_HIDDEN_BOTTOM = 66;
const EDGE = 40;
/** Harita durum çubuğu ve geri düğmesinin altına uzanır; nokta bu bantta kalmasın. */
const TOP_INSET = 56;

/**
 * Android (Google Maps) koyu harita stili; renkler palet tokenlarından. iOS Apple Maps
 * `userInterfaceStyle="dark"` ile koyulaşır, `customMapStyle`'ı yok sayar. Koyu modda rota
 * kâğıt beyazı çizildiği için zemin koyu olmalı (WCAG 1.4.11, en az 3:1).
 */
const DARK_MAP_STYLE: MapStyleElement[] = [
  { elementType: "geometry", stylers: [{ color: palette.lacquerBlack }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: palette.slateFaint }] },
  { elementType: "labels.text.stroke", stylers: [{ color: palette.lacquerBlack }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: palette.lacquerBlackRaised }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: palette.lacquerBlack }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: palette.lacquerBlackRaised }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: palette.lacquerBlackRaised }] },
];

function regionFor(points: LatLng[]): Region {
  if (points.length === 0) return ANTALYA_REGION;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}

export default function MapCanvas(props: MapCanvasProps) {
  const ref = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const reduceMotion = useReducedMotion();
  const decoded = useMemo(() => (props.route ? decodePolyline(props.route) : []), [props.route]);
  // Rota yoksa (teklif alınmadan önce) seçilen noktalar gösterilir; iki nokta kesikli çizgiyle bağlanır.
  const preview = decoded.length < 2 && (props.endpoints?.length ?? 0) > 0;
  const route = preview ? (props.endpoints as LatLng[]) : decoded;
  const driver = props.driver ?? null;
  const bottom = props.hiddenBottom ?? DEFAULT_HIDDEN_BOTTOM;
  const line = props.dark ? palette.paper : palette.lacquerBlack;
  const ring = props.dark ? palette.lacquerBlack : palette.paper;

  // Kamera rota (ve varsa sürücü) noktalarını içine alır. Sürücü konumu her güncellendiğinde değil,
  // rota değiştiğinde veya sürücü ilk göründüğünde yeniden sığdırılır; kamera sürekli zıplamaz.
  const hasDriver = driver !== null;
  const fitPoints = useMemo(() => (hasDriver && driver ? [...route, driver] : route), [route, hasDriver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = ref.current;
    if (!ready || !map || fitPoints.length === 0) return;
    const animated = !reduceMotion;
    if (fitPoints.length === 1) {
      map.animateToRegion(regionFor(fitPoints), animated ? 600 : 0);
      return;
    }
    // Kenar payı iki platformda da dp: react-native-maps Android'de yoğunlukla kendisi çarpar
    // (MapView.java appendMapPadding); JS'te ölçeklemek payı iki kez büyütür.
    map.fitToCoordinates(fitPoints, {
      edgePadding: { top: EDGE + TOP_INSET, right: EDGE, bottom: bottom + EDGE, left: EDGE },
      animated,
    });
  }, [ready, fitPoints, bottom, reduceMotion]);

  // Sürücü işaretçisi ilk çiziminden sonra görünüm izlemeyi bırakır (Android'de boş işaretçi kalmasın,
  // sonra her karede yeniden bitmap üretilmesin). Konum değişimi izlemeyi gerektirmez.
  const [driverDrawn, setDriverDrawn] = useState(false);

  const summary = props.accessibilitySummary;
  // İşaretler: verilmişse `stops` (ör. sürücü → alış rotasında yalnızca alış), yoksa rotanın uçları.
  const stops = props.stops;
  const pickup = stops ? stops.pickup ?? undefined : route[0];
  const dropoff = stops ? stops.dropoff ?? undefined : route.length > 1 ? route[route.length - 1] : undefined;

  return (
    <View
      style={[StyleSheet.absoluteFill, props.style]}
      // Harita MapSheet'in kaydırma alanının altında durur; dokunuşlar panele gider.
      pointerEvents="none"
      // Ekran okuyucu haritayı tek öğe olarak okur; özet yoksa harita gizlenir (etiketsiz öğe bırakılmaz).
      accessible={Boolean(summary)}
      accessibilityRole={summary ? "image" : undefined}
      accessibilityLabel={summary}
      importantForAccessibility={summary ? "yes" : "no-hide-descendants"}
      accessibilityElementsHidden={!summary}
    >
      {OSM_TILES ? (
        <TileMap route={route} preview={preview} pickup={pickup} dropoff={dropoff} driver={driver} dark={props.dark}
          line={line} ring={ring} pad={{ top: EDGE + TOP_INSET, right: EDGE, bottom: bottom + EDGE, left: EDGE }} />
      ) : (
      <MapView
        ref={ref}
        provider={Platform.OS === "ios" && GOOGLE_MAPS_IOS ? "google" : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(route)}
        onMapReady={() => setReady(true)}
        userInterfaceStyle={props.dark ? "dark" : "light"}
        customMapStyle={props.dark && Platform.OS === "android" ? DARK_MAP_STYLE : undefined}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        moveOnMarkerPress={false}
      >
        {route.length > 1 ? (
          <Polyline
            // Android, desen prop'u kaldırılınca eski deseni korur: önizleme ve gerçek rota ayrı çizgi olarak kurulur.
            key={preview ? "preview" : "route"}
            coordinates={route} strokeColor={line} strokeWidth={4} lineCap="round" lineJoin="round"
            lineDashPattern={preview ? [2, 10] : undefined} />
        ) : null}
        {pickup ? (
          <Marker testID="map-pickup" coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[st.pickup, { backgroundColor: line, borderColor: ring }]} />
          </Marker>
        ) : null}
        {dropoff ? (
          <Marker testID="map-dropoff" coordinate={dropoff} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[st.dropoff, { backgroundColor: line, borderColor: ring }]}>
              <View style={[st.dropoffInner, { backgroundColor: ring }]} />
            </View>
          </Marker>
        ) : null}
        {driver ? (
          <Marker testID="map-driver" coordinate={driver} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={!driverDrawn}>
            <View
              style={[st.driver, { backgroundColor: ring }]}
              onLayout={() => requestAnimationFrame(() => setDriverDrawn(true))}
            >
              <View style={[st.driverInner, { backgroundColor: line }]}>
                <View style={[st.driverDot, { backgroundColor: ring }]} />
              </View>
            </View>
          </Marker>
        ) : null}
      </MapView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  pickup: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  dropoff: { width: 18, height: 18, borderRadius: 3, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dropoffInner: { width: 6, height: 6 },
  driver: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  driverInner: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  driverDot: { width: 8, height: 8, borderRadius: 4 },
});
