import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Button, Card, Input, Logo, P, Picker, Screen, colors } from "@/components/ui";
import { api } from "@/lib/api";
import { VARIANT } from "@/lib/config";
import { countries, defaultCountry } from "@/lib/countries";
import { LOCALE, errorText, t } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const HERO = VARIANT === "driver" ? require("@/assets/images/driver.jpg") : require("@/assets/images/hero.jpg");

/** Telefon + SMS kodu ile giriş (K-16). Hesap yoksa backend oluşturur. */
export default function Login() {
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();
  const purpose = VARIANT === "driver" ? "driver" : "customer";
  const [country, setCountry] = useState(defaultCountry[LOCALE] ?? "GB");
  const [national, setNational] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dial = countries.find((c) => c.code === country)?.dial ?? "+";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      const full = dial + national.replace(/\D/g, "").replace(/^0+/, "");
      const r = await api<{ dev_code?: string | null }>("auth/otp/request", { body: { phone: full, purpose, locale: LOCALE } });
      setDevCode(r.dev_code ?? null);
      setPhone(full);
    });

  const verify = () =>
    run(async () => {
      const tokens = await api<{ access_token: string; refresh_token: string }>("auth/otp/verify", {
        body: { phone, code, purpose, country_code: country, locale: LOCALE },
      });
      await signIn(tokens);
      router.replace("/");
    });

  return (
    <Screen
      header={<>
        <StatusBar style="light" />
        <View style={{ marginHorizontal: -16, height: 360 }}>
          <Image source={HERO} resizeMode="cover" style={StyleSheet.absoluteFill} />
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 24, paddingTop: insets.top + 24, paddingBottom: 56, justifyContent: "space-between" }}>
            <Logo inverted />
            <View style={{ gap: 8 }}>
              <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.8 }}>
                {VARIANT === "driver" ? "Sürücü uygulaması" : t("book.heroTitle")}
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 15 }}>
                {VARIANT === "driver" ? "İş teklifleri, yolculuk akışı ve kazançlarınız tek yerde." : t("login.text")}
              </Text>
            </View>
          </View>
        </View>
      </>}
    >
      <Card elevated style={{ marginTop: -36 }}>
        {phone === null ? (
          <>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 }}>{t("login.title")}</Text>
            <Picker
              label={t("login.country")}
              placeholder={t("book.choose")}
              icon="globe-outline"
              value={country}
              options={countries.map((c) => ({ value: c.code, label: `${c.name} (${c.dial})` }))}
              onChange={setCountry}
            />
            <Input
              label={`${t("login.phone")} (${dial})`}
              icon="call-outline"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={national}
              onChangeText={setNational}
              placeholder={country === "TR" ? "532 123 45 67" : ""}
            />
            <Alert text={error} />
            <Button title={t("login.sendCode")} onPress={send} busy={busy} disabled={national.replace(/\D/g, "").length < 6} />
          </>
        ) : (
          <>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 }}>{t("login.code")}</Text>
            <P muted>{t("login.codeSent", { phone })}</P>
            {devCode && (
              <Pressable onPress={() => setCode(devCode)} style={{ borderWidth: 1, borderStyle: "dashed", borderColor: "#d4b977", backgroundColor: "#fbf7ee", borderRadius: 12, padding: 12 }}>
                <Text style={{ color: "#5c4a1c" }}>{t("login.devCode", { code: devCode })}</Text>
              </Pressable>
            )}
            <Input
              label=""
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={8}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
              style={{ fontSize: 26, letterSpacing: 10, textAlign: "center", fontWeight: "700" }}
            />
            <Alert text={error} />
            <Button title={t("login.verify")} onPress={verify} busy={busy} disabled={code.length < 4} />
            <Button title={t("login.changePhone")} variant="secondary" onPress={() => { setPhone(null); setCode(""); setDevCode(null); }} />
          </>
        )}
      </Card>
    </Screen>
  );
}
