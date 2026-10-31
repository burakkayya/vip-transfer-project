// Web önizlemesi: yerel seçici yok, tarayıcının datetime-local alanı kullanılır.
import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement } from "react";
import { View } from "react-native";
import { T, colors, fonts, s } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function DateTimeField(props: { label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date }) {
  return (
    <View style={s.field}>
      {props.label ? <T style={s.label}>{props.label}</T> : null}
      <View style={[s.inputWrap, { paddingRight: 8 }]}>
        <Ionicons name="calendar-outline" size={18} color={colors.muted} style={{ marginRight: 10 }} />
        {createElement("input", {
          type: "datetime-local",
          value: toInput(props.value),
          min: props.minimumDate ? toInput(props.minimumDate) : undefined,
          onChange: (e: { target: { value: string } }) => {
            const d = new Date(e.target.value);
            if (!Number.isNaN(d.getTime())) props.onChange(d);
          },
          style: {
            flex: 1,
            border: "none",
            outline: "none",
            padding: "15px 0",
            color: colors.text,
            background: "transparent",
            fontSize: 15.5,
            fontFamily: fonts.semibold,
          },
        })}
      </View>
    </View>
  );
}
