// Android kalıcı yolculuk bildirimi (K-59): bildirim çekmecesinde sabit, kaydırarak kapatılamaz;
// durum değiştikçe yerinde güncellenir. Yalnızca Android; iOS'ta `TripActivity` kullanılır.
import { Column, LinearProgressIndicator, Row, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createCustomNotification } from "expo-widgets";
import type { LiveTripProps } from "./types";

export default createCustomNotification<LiveTripProps>("TripNotification", (props: LiveTripProps) => {
  "widget";
  const body = (
    <Column verticalArrangement={{ spacedBy: 6 }} modifiers={[fillMaxWidth(), paddingAll(4)]}>
      <Row horizontalArrangement="spaceBetween" verticalAlignment="center" modifiers={[fillMaxWidth()]}>
        <Text maxLines={1} style={{ fontSize: 15, fontWeight: "700" }}>{props.title}</Text>
        <Text maxLines={1} style={{ fontSize: 15, fontWeight: "700" }}>{props.eta}</Text>
      </Row>
      <LinearProgressIndicator progress={props.progress} color="#1F8A5B" trackColor="#E4E2DC"
        modifiers={[fillMaxWidth()]} />
      <Text maxLines={1} color="#6B6B6B" style={{ fontSize: 13 }}>{props.detail}</Text>
    </Column>
  );
  return { collapsed: body, expanded: body };
});
