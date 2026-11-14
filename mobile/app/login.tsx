import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Button, Logo, Picker, T, colors, fonts, s, shadow, useScreenHeight } from "@/components/ui";
import { api } from "@/lib/api";
import { VARIANT } from "@/lib/config";
import { countries, defaultCountry } from "@/lib/countries";
import { LOCALE, errorText, t } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const DRIVER = VARIANT === "driver";
const HERO = DRIVER ? require("@/assets/images/driver.jpg") : require("@/assets/images/coast.jpg");
const CODE_LEN = 6;
const RESEND_SECONDS = 45;

/** 6 kutulu SMS kodu alanı: görünmez tek bir giriş kutuların üstünde durur (yapıştırma ve otomatik doldurma çalışır). */
function OtpInput(props: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void }) {
  const ref = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(true);
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}>
      {Array.from({ length: CODE_LEN }).map((_, i) => {
        const ch = props.value[i] ?? "";
        const active = focused && i === Math.min(props.value.length, CODE_LEN - 1);
        return (
          <View key={i} style={[st.otpBox, ch ? st.otpFilled : null, active && st.otpActive]}>
            <T style={{ fontSize: 24, fontWeight: "700" }}>{ch}</T>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        autoFocus
        value={props.value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, "").slice(0, CODE_LEN);
          props.onChange(clean);
          if (clean.length === CODE_LEN) props.onDone?.(clean);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={CODE_LEN}
        caretHidden
        style={[StyleSheet.absoluteFill, { opacity: 0.01, color: "transparent" }]}
        accessibilityLabel={t("login.code")}
      />
    </Pressable>
  );
}

/** Telefon + SMS kodu ile giriş (K-16). Hesap yoksa backend oluşturur. */
export default function Login() {
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();
  const height = useScreenHeight();
  const purpose = DRIVER ? "driver" : "customer";
  const [country, setCountry] = useState(defaultCountry[LOCALE] ?? "GB");
  const [national, setNational] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const dial = countries.find((c) => c.code === country)?.dial ?? "+";
  // Klavye açıkken (iOS sayı klavyesinde "Bitti" tuşu yok) fotoğraf alanı küçülür; "Devam" düğmesi görünür kalır.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

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
      setCode("");
      setWait(RESEND_SECONDS);
    });

  const verify = (value = code) =>
    run(async () => {
      const tokens = await api<{ access_token: string; refresh_token: string }>("auth/otp/verify", {
        body: { phone, code: value, purpose, country_code: country, locale: LOCALE },
      });
      await signIn(tokens);
      router.replace("/");
    });

  const heroH = keyboard ? insets.top + 80 : Math.round(height * 0.44);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, overflow: "hidden" }}>
      <StatusBar style="light" />
      <View style={{ height: heroH + 40 }}>
        <Animated.View entering={FadeIn.duration(900)} style={StyleSheet.absoluteFill}>
          <Image source={HERO} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
        </Animated.View>
        <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.75)"]} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 22, paddingBottom: keyboard ? 48 : 64, justifyContent: "space-between" }}>
          <Animated.View entering={FadeInDown.duration(600)}>
            <Logo inverted sub={DRIVER ? "SÜRÜCÜ" : "TRANSFERS"} />
          </Animated.View>
          <Animated.View entering={FadeInDown.duration(700).delay(150)} style={{ gap: 8, display: keyboard ? "none" : "flex" }}>
            <T style={{ color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -1.2, lineHeight: 38 }}>
              {DRIVER ? "Yola çıkmaya\nhazır mısınız?" : t("home.where")}
            </T>
            <T style={{ color: "rgba(255,255,255,0.82)", fontSize: 15, lineHeight: 21 }}>
              {DRIVER ? "İş teklifleri, yolculuk akışı ve kazançlarınız tek yerde." : t("book.heroText")}
            </T>
          </Animated.View>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[st.sheet, shadow.float]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: insets.bottom + 24 }}>
          {phone === null ? (
            <Animated.View key="phone" entering={FadeInUp.duration(450)} style={{ gap: 16 }}>
              <View style={{ gap: 4 }}>
                <T style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.5 }}>{t("login.welcome")}</T>
                <T style={s.hint}>{DRIVER ? "Kayıtlı telefon numaranıza SMS kodu gönderilir." : t("login.text")}</T>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ width: 118 }}>
                  <Picker
                    label=""
                    placeholder={t("book.choose")}
                    value={country}
                    options={countries.map((c) => ({ value: c.code, label: `${c.name} (${c.dial})` }))}
                    onChange={setCountry}
                  />
                  <View pointerEvents="none" style={st.dialCover}>
                    <T style={{ fontWeight: "700" }}>{country}</T>
                    <T style={{ color: colors.muted, fontWeight: "600" }}>{dial}</T>
                    <Ionicons name="chevron-down" size={16} color={colors.muted} />
                  </View>
                </View>
                <View style={[s.inputWrap, { flex: 1 }]}>
                  <TextInput
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    value={national}
                    onChangeText={setNational}
                    placeholder={country === "TR" ? "532 123 45 67" : t("login.phone")}
                    placeholderTextColor={colors.faint}
                    style={[s.inputText, { fontFamily: fonts.semibold, fontSize: 17, letterSpacing: 0.5 }]}
                    accessibilityLabel={`${t("login.phone")} (${dial})`}
                    onSubmitEditing={send}
                  />
                </View>
              </View>
              <Alert text={error} />
              <Button title={t("continue")} iconRight="arrow-forward" onPress={send} busy={busy} disabled={national.replace(/\D/g, "").length < 6} />
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
                <Ionicons name="lock-closed" size={13} color={colors.muted} />
                <T style={[s.hint, { textAlign: "center" }]}>{DRIVER ? "Hesap yoksa kayıt adımına yönlendirilirsiniz." : "Şifre yok · Kodla güvenli giriş"}</T>
              </View>
            </Animated.View>
          ) : (
            <Animated.View key="code" entering={FadeInUp.duration(450)} style={{ gap: 18 }}>
              <Pressable onPress={() => { setPhone(null); setCode(""); setDevCode(null); setError(null); }} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="arrow-back" size={18} color={colors.ink} />
                <T style={{ fontWeight: "600" }}>{t("login.changePhone")}</T>
              </Pressable>
              <View style={{ gap: 4 }}>
                <T style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.5 }}>{t("login.code")}</T>
                <T style={s.hint}>{t("login.codeSent", { phone: phone ?? "" })}</T>
              </View>
              <OtpInput value={code} onChange={setCode} onDone={(v) => void verify(v)} />
              {devCode && (
                <Pressable onPress={() => { setCode(devCode); void verify(devCode); }} style={st.devCode}>
                  <Ionicons name="flask-outline" size={16} color={colors.warn} />
                  <T style={{ color: colors.warn, flex: 1, fontSize: 13 }}>{t("login.devCode", { code: devCode })}</T>
                </Pressable>
              )}
              <Alert text={error} />
              <Button title={t("login.verify")} onPress={() => verify()} busy={busy} disabled={code.length < 4} />
              <Pressable disabled={wait > 0 || busy} onPress={send} style={{ alignSelf: "center", padding: 6 }}>
                <T style={{ fontWeight: "600", color: wait > 0 ? colors.faint : colors.ink }}>
                  {wait > 0 ? t("login.resendIn", { s: wait }) : t("login.resend")}
                </T>
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { flex: 1, minHeight: 0, marginTop: -40, backgroundColor: "#fff", borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  dialCover: { position: "absolute", left: 1.5, right: 1.5, top: 1.5, bottom: 1.5, borderRadius: 13, backgroundColor: colors.brandSoft, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  otpBox: { flex: 1, aspectRatio: 0.86, maxWidth: 52, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.brandSoft },
  otpFilled: { backgroundColor: "#fff", borderColor: colors.line },
  otpActive: { borderColor: colors.ink, backgroundColor: "#fff" },
  devCode: { flexDirection: "row", gap: 8, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.accent, backgroundColor: colors.warnSoft, borderRadius: 12, padding: 12 },
});
