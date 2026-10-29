// Web önizlemesi: yerel seçici yok, tarayıcının datetime-local alanı kullanılır.
import { createElement } from "react";
import { Text, View } from "react-native";
import { s } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function DateTimeField(props: { label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{props.label}</Text>
      {createElement("input", {
        type: "datetime-local",
        value: toInput(props.value),
        min: props.minimumDate ? toInput(props.minimumDate) : undefined,
        onChange: (e: { target: { value: string } }) => {
          const d = new Date(e.target.value);
          if (!Number.isNaN(d.getTime())) props.onChange(d);
        },
        style: {
          border: "1.5px solid #f3f3f3",
          borderRadius: 12,
          padding: "14px",
          color: "#000",
          background: "#f3f3f3",
          fontSize: 15,
          fontFamily: "inherit",
        },
      })}
    </View>
  );
}
