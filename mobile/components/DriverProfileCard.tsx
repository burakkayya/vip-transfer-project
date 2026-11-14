/**
 * Sürücü kartı ayarları (K-62): müşteriye gösterilen profil fotoğrafı ve konuşulan diller.
 * Fotoğraf sunucuda meta verisi (konum, cihaz) silinerek yeniden kodlanır.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { Alert, Button, Card, H2, IconBubble, P, Row, T, colors } from "@/components/ui";
import { API_URL } from "@/lib/config";
import { accessToken, api, upload } from "@/lib/api";
import { errorTextTr } from "@/lib/i18n";
import type { DriverMe } from "@/lib/types";

const LANGS: [string, string][] = [
  ["tr", "Türkçe"], ["en", "İngilizce"], ["de", "Almanca"], ["ru", "Rusça"], ["fr", "Fransızca"], ["ar", "Arapça"],
];

export default function DriverProfileCard(props: { me: DriverMe; onSaved: (me: DriverMe) => void }) {
  const [langs, setLangs] = useState<string[]>(props.me.languages ?? ["tr"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);

  function toggle(code: string) {
    setLangs((cur) => (cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code]));
  }

  async function saveLangs() {
    setBusy(true);
    setMessage(null);
    try {
      props.onSaved(await api<DriverMe>("driver/me/profile", { method: "PUT", body: { languages: langs } }));
      setMessage({ ok: true, text: "Diller kaydedildi." });
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (res.canceled) return;
    const file = res.assets[0];
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "image/jpeg" } as unknown as Blob);
      props.onSaved(await upload<DriverMe>("driver/me/photo", fd));
      setPhotoVersion((v) => v + 1);
      setMessage({ ok: true, text: "Fotoğraf güncellendi." });
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Row gap={12}>
        <IconBubble name="person-circle-outline" dark />
        <H2>Sürücü kartım</H2>
      </Row>
      <P muted small>Yolcu, alıştan bir gün önce fotoğrafınızı, aracınızı ve konuştuğunuz dilleri görür.</P>
      <Row gap={14} style={{ flexWrap: "nowrap" }}>
        {props.me.has_photo ? (
          <Image accessibilityIgnoresInvertColors
            source={{ uri: `${API_URL}/api/v1/driver/me/photo?v=${photoVersion}`, headers: { Authorization: `Bearer ${accessToken() ?? ""}` } }}
            style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.canvas }} />
        ) : (
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="camera-outline" size={24} color={colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button title={props.me.has_photo ? "Fotoğrafı değiştir" : "Fotoğraf yükle"} variant="secondary" small busy={busy} onPress={pickPhoto} />
        </View>
      </Row>
      <T style={{ fontWeight: "700" }}>Konuştuğum diller</T>
      <Row gap={8}>
        {LANGS.map(([code, label]) => {
          const on = langs.includes(code);
          return (
            <Pressable key={code} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(code)}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? colors.ink : colors.canvas }}>
              <T style={{ fontWeight: "600", color: on ? "#fff" : colors.ink }}>{label}</T>
            </Pressable>
          );
        })}
      </Row>
      <P muted small>Yolcunun dilini konuşuyorsanız mesajlar çevrilmez; konuşmuyorsanız otomatik çevrilir.</P>
      <Alert text={message?.text ?? null} tone={message?.ok ? "ok" : "danger"} />
      <Button title="Dilleri kaydet" busy={busy} disabled={langs.length === 0} onPress={saveLangs} />
    </Card>
  );
}
