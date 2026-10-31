import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Alert, Avatar, Button, Card, Divider, Eyebrow, Hero, Input, ListRow, P, Picker, Screen, Skeleton, T, Toggle, colors, s } from "@/components/ui";
import { api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { LOCALE, errorText, t } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Profile } from "@/lib/types";

const MARKETING_CONSENT_VERSION = "1.0";
type DrType = "erisim" | "duzeltme" | "silme";

/** Müşteri ekranı 6: profil, bildirim (pazarlama) tercihi, veri talebi. */
export default function ProfileScreen() {
  const { signOut } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [marketing, setMarketing] = useState(false);
  const [drType, setDrType] = useState<DrType>("erisim");
  const [drNote, setDrNote] = useState("");
  const [open, setOpen] = useState<"personal" | "privacy" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<Profile>("me/profile").then(setProfile).catch((e) => setMessage({ ok: false, text: errorText(e) }));
    api<{ consent_type: string; accepted: boolean }[]>("me/consents")
      .then((rows) => setMarketing(rows.find((r) => r.consent_type === "pazarlama")?.accepted ?? false))
      .catch(() => undefined);
  }, []);

  async function save() {
    if (!profile) return;
    try {
      setProfile(await api<Profile>("me/profile", {
        method: "PATCH",
        body: { full_name: profile.full_name || null, email: profile.email || null, locale: LOCALE },
      }));
      setMessage({ ok: true, text: t("saved") });
      setOpen(null);
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
  }

  async function toggleMarketing(v: boolean) {
    setMarketing(v);
    await api("me/consents", { body: { consent_type: "pazarlama", accepted: v, version: MARKETING_CONSENT_VERSION } })
      .catch((e) => setMessage({ ok: false, text: errorText(e) }));
  }

  async function sendDataRequest() {
    try {
      await api("me/data-requests", { body: { request_type: drType, note: drNote.trim() || null } });
      setDrNote("");
      setMessage({ ok: true, text: t("profile.dataSent") });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
  }

  const legal = (slug: string) => WebBrowser.openBrowserAsync(`${WEB_URL}/${LOCALE}/legal/${slug}`);
  const name = profile?.full_name || profile?.phone || "";

  return (
    <Screen canvas header={<Hero title={t("profile.title")} />}>
      <Animated.View entering={FadeInDown.duration(400)} style={{ backgroundColor: colors.ink, borderRadius: 24, padding: 20, flexDirection: "row", alignItems: "center", gap: 16 }}>
        {profile ? <Avatar name={name} size={60} dark={false} /> : <Skeleton width={60} height={60} radius={30} />}
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.4 }} numberOfLines={1}>{profile?.full_name || "Getaway"}</T>
          <T style={{ color: "rgba(255,255,255,0.7)" }}>{profile?.phone ?? ""}</T>
          {profile?.email ? <T style={{ color: "rgba(255,255,255,0.55)", fontSize: 13 }} numberOfLines={1}>{profile.email}</T> : null}
        </View>
      </Animated.View>

      <Alert text={message?.text ?? null} tone={message?.ok ? "ok" : "danger"} />

      <Card delay={60} style={{ paddingVertical: 8 }}>
        <ListRow icon="person-outline" title={t("profile.personal")} subtitle={profile?.full_name ?? undefined} onPress={() => setOpen(open === "personal" ? null : "personal")} />
        {open === "personal" && profile && (
          <View style={{ gap: 12, paddingBottom: 10 }}>
            <Input label={t("profile.fullName")} value={profile.full_name ?? ""} onChangeText={(v) => setProfile({ ...profile, full_name: v })} />
            <Input label={t("profile.email")} keyboardType="email-address" autoCapitalize="none" value={profile.email ?? ""}
              onChangeText={(v) => setProfile({ ...profile, email: v })} />
            <Button title={t("save")} onPress={save} />
          </View>
        )}
        <Divider inset={52} />
        <View style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
          <Toggle icon="notifications-outline" label={t("profile.marketing")} value={marketing} onChange={toggleMarketing} />
        </View>
        <Divider inset={52} />
        <ListRow icon="shield-checkmark-outline" title={t("profile.privacy")} subtitle={t("profile.dataRequest")} onPress={() => setOpen(open === "privacy" ? null : "privacy")} />
        {open === "privacy" && (
          <View style={{ gap: 12, paddingBottom: 10 }}>
            <P muted small>{t("profile.dataRequestText")}</P>
            <Picker<DrType>
              label=""
              placeholder=""
              value={drType}
              options={(["erisim", "duzeltme", "silme"] as const).map((v) => ({ value: v, label: t(`profile.dr.${v}`) }))}
              onChange={setDrType}
            />
            <Input label="" value={drNote} onChangeText={setDrNote} multiline maxLength={1000} />
            <Button title={t("continue")} variant="secondary" onPress={sendDataRequest} />
          </View>
        )}
        <Divider inset={52} />
        <ListRow icon="help-buoy-outline" title={t("profile.support")} subtitle="info@getawaytransfers.com" onPress={() => Linking.openURL("mailto:info@getawaytransfers.com")} />
      </Card>

      <Card delay={120} style={{ paddingVertical: 8 }}>
        <View style={{ paddingTop: 8, paddingHorizontal: 4 }}>
          <Eyebrow color={colors.muted}>{t("profile.legal")}</Eyebrow>
        </View>
        {(["privacy", "cancellation", "distance-sales", "cookies"] as const).map((slug, i) => (
          <View key={slug}>
            {i > 0 ? <Divider inset={52} /> : null}
            <ListRow icon="document-text-outline" title={t(`legal.${slug}`)} onPress={() => legal(slug)} />
          </View>
        ))}
      </Card>

      <Card delay={180} style={{ paddingVertical: 8 }}>
        <ListRow icon="log-out-outline" title={t("logout")} danger onPress={async () => { await signOut(); router.replace("/login"); }} />
      </Card>
      <T style={[s.hint, { textAlign: "center" }]}>Getaway Transfers · 0.1.0</T>
    </Screen>
  );
}
