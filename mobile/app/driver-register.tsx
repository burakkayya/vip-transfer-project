import { router } from "expo-router";
import { useState } from "react";
import { Alert, Button, Card, H1, Input, P, Screen } from "@/components/ui";
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
    <Screen>
      <H1>Sürücü kaydı</H1>
      <P muted>
        Getaway ile çalışan sürücüler TÜRSAB onaylı, yetki belgeli bağımsız ortaklardır. Kayıttan sonra belgelerinizi
        yükleyin; onaylanınca iş almaya başlarsınız.
      </P>
      <Card>
        <Input label="Ad soyad" value={fullName} onChangeText={setFullName} autoComplete="name" maxLength={120} />
        <Input label="TÜRSAB / acente belge no" value={tursab} onChangeText={setTursab} maxLength={50} />
        <Input label="IBAN (hakediş ödemesi için)" value={iban} onChangeText={setIban} autoCapitalize="characters"
          placeholder="TR00 0000 0000 0000 0000 0000 00" hint="IBAN şifreli saklanır, yalnızca hakediş ödemesinde kullanılır." />
        <Alert text={error} />
        <Button title="Kaydı tamamla" onPress={submit} busy={busy}
          disabled={fullName.trim().length < 3 || (normalizedIban !== "" && !/^TR\d{24}$/.test(normalizedIban))} />
      </Card>
    </Screen>
  );
}
