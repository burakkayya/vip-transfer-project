import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Alert, Button, Card, IconBubble, Input, P, Row, Screen, T, colors } from "@/components/ui";
import { api } from "@/lib/api";
import { errorTextTr } from "@/lib/i18n";

/** Sürücü ekranı 1: kayıt. Belgeler kayıttan sonra "Belgeler" sekmesinden yüklenir. */
export default function DriverRegister() {
  const [fullName, setFullName] = useState("");
  const [tursab, setTursab] = useState("");
  const [iban, setIban] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedIban = iban.replace(/\s/g, "").toUpperCase();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("driver/register", {
        body: { full_name: fullName.trim(), tursab_or_agency_no: tursab.trim() || null, iban: normalizedIban || null },
      });
      router.replace("/documents");
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen canvas>
      <View style={{ backgroundColor: colors.ink, borderRadius: 24, padding: 20, gap: 10 }}>
        <Row gap={12}>
          <IconBubble name="id-card-outline" bg={colors.accent} color="#fff" />
          <T style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>Getaway sürücüsü olun</T>
        </Row>
        <T style={{ color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
        Getaway ile çalışan sürücüler TÜRSAB onaylı, yetki belgeli bağımsız ortaklardır. Kayıttan sonra belgelerinizi
        yükleyin; onaylanınca iş almaya başlarsınız.
        </T>
      </View>
      <Card elevated>
        <Input label="Ad soyad" icon="person-outline" value={fullName} onChangeText={setFullName} autoComplete="name" maxLength={120} />
        <Input label="TÜRSAB / acente belge no" icon="ribbon-outline" value={tursab} onChangeText={setTursab} maxLength={50} />
        <Input label="IBAN (hakediş ödemesi için)" icon="card-outline" value={iban} onChangeText={setIban} autoCapitalize="characters"
          placeholder="TR00 0000 0000 0000 0000 0000 00" hint="IBAN şifreli saklanır, yalnızca hakediş ödemesinde kullanılır." />
        <Alert text={error} />
        <Button title="Kaydı tamamla" onPress={submit} busy={busy}
          disabled={fullName.trim().length < 3 || (normalizedIban !== "" && !/^TR\d{24}$/.test(normalizedIban))} />
      </Card>
    </Screen>
  );
}
