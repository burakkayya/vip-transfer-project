import BaseIonicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

/**
 * Ionicons, ekran okuyucudan gizli. İkon bir yazı tipi glifidir; gizlenmezse iOS ve Android onu düğme ve
 * satır etiketlerine katar ve VoiceOver/TalkBack anlamsız karakter okur. Anlamı olan ikon için çağıran
 * etiketi kendisi verir (ör. IconButton'ın accessibilityLabel'ı).
 */
function Ionicons(props: ComponentProps<typeof BaseIonicons>) {
  return <BaseIonicons accessible={false} importantForAccessibility="no" accessibilityElementsHidden {...props} />;
}
Ionicons.glyphMap = BaseIonicons.glyphMap;

export default Ionicons;
