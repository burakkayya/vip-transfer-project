// Android kalıcı yolculuk bildirimi (K-59): bildirim çekmecesinde sabit, kaydırarak kapatılamaz;
// durum değiştikçe yerinde güncellenir. Yalnızca Android; iOS'ta `TripActivity` kullanılır.
// Renkler kök DESIGN.md tokenlarıyla aynıdır (widget ayrı derlendiği için tokens.ts içe aktarılmaz; __tests__/tokens.test.ts denetler).
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
      <LinearProgressIndicator progress={props.progress} color="#18794e" trackColor="#e8e7e3"
        modifiers={[fillMaxWidth()]} />
      <Text maxLines={1} color="#6b6b70" style={{ fontSize: 13 }}>{props.detail}</Text>
    </Column>
  );
  return { collapsed: body, expanded: body };
});
