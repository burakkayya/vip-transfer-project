import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallClockLabel } from "@/lib/format";
import { Button, T, colors, s } from "./ui";

/** Tarih ve saat seçimi. Android'de önce tarih sonra saat sorulur; iOS'ta tek seçici açılır. */
export default function DateTimeField(props: { label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.value);

  function openPicker() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: props.value,
        mode: "date",
        minimumDate: props.minimumDate,
        onChange: (e, date) => {
          if (e.type !== "set" || !date) return;
          DateTimePickerAndroid.open({
            value: date,
            mode: "time",
            is24Hour: true,
            onChange: (e2, time) => {
              if (e2.type === "set" && time) props.onChange(time);
            },
          });
        },
      });
    } else {
      setDraft(props.value);
      setOpen(true);
    }
  }

  return (
    <View style={s.field}>
      {props.label ? <T style={s.label}>{props.label}</T> : null}
      <Pressable style={s.inputWrap} onPress={openPicker}>
        <Ionicons name="calendar-outline" size={18} color={colors.muted} style={{ marginRight: 10 }} />
        <T style={[s.inputText, { fontWeight: "600" }]}>{wallClockLabel(props.value)}</T>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {Platform.OS === "ios" && (
        <Modal visible={open} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
          <SafeAreaView style={{ marginTop: "auto", backgroundColor: colors.surface, padding: 16, gap: 12 }}>
            <DateTimePicker
              value={draft}
              mode="datetime"
              display="inline"
              minimumDate={props.minimumDate}
              minuteInterval={5}
              onChange={(_, d) => d && setDraft(d)}
            />
            <Button title="OK" onPress={() => { props.onChange(draft); setOpen(false); }} />
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
