// Web önizlemesi: native ile aynı gerçek Google haritası (GoogleMapWeb, tarayıcı anahtarı
// EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY). Haritayla ilgili her şey Google'dır, yedek harita yoktur
// (2026-11-10 kullanıcı kararı, K-58): anahtar yoksa veya Google reddederse sahte harita yerine açık uyarı
// gösterilir. iOS/Android'de Metro MapCanvas.tsx'i seçer.
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import GoogleMapWeb, { MAPS_BROWSER_KEY } from "./GoogleMapWeb";
import type { MapCanvasProps } from "./mapTypes";

export type { MapCanvasProps, MapMode } from "./mapTypes";

export default function MapCanvas(props: MapCanvasProps) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  if (MAPS_BROWSER_KEY && !failed) return <GoogleMapWeb {...props} onFail={onFail} />;
  return (
    <View style={[StyleSheet.absoluteFill, st.box, props.style]} accessibilityRole="alert">
      <Text style={st.title}>Google Haritalar yüklenemedi</Text>
      <Text style={st.text}>
        {MAPS_BROWSER_KEY
          ? "Google anahtarı reddetti (kısıt veya faturalandırma). Anahtar ayarlarını kontrol edin."
          : "EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY tanımlı değil."}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: "#ECE9E2", alignItems: "center", justifyContent: "center", padding: 24, paddingBottom: 120 },
  title: { fontSize: 15, fontWeight: "700", color: "#0B0B0C", marginBottom: 6, textAlign: "center" },
  text: { fontSize: 13, color: "#55555A", textAlign: "center" },
});
