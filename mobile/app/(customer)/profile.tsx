import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { Alert, Button, Card, H2, Input, P, Picker, Screen, Toggle, colors } from "@/components/ui";
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

  return (
    <Screen>
      <Alert text={message?.text ?? null} tone={message?.ok ? "ok" : "danger"} />
      {profile && (
        <Card>
          <P muted>{profile.phone}</P>
          <Input label={t("profile.fullName")} value={profile.full_name ?? ""} onChangeText={(v) => setProfile({ ...profile, full_name: v })} />
          <Input label={t("profile.email")} keyboardType="email-address" autoCapitalize="none" value={profile.email ?? ""}
            onChangeText={(v) => setProfile({ ...profile, email: v })} />
          <Button title={t("save")} onPress={save} />
        </Card>
      )}
      <Card>
        <Toggle label={t("profile.marketing")} value={marketing} onChange={toggleMarketing} />
      </Card>
      <Card>
        <H2>{t("profile.dataRequest")}</H2>
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
      </Card>
      <Card>
        <H2>{t("profile.legal")}</H2>
        {(["privacy", "cancellation", "distance-sales", "cookies"] as const).map((slug) => (
          <Pressable key={slug} onPress={() => legal(slug)}>
            <Text style={{ color: colors.brand, paddingVertical: 4 }}>{t(`legal.${slug}`)} ›</Text>
          </Pressable>
        ))}
      </Card>
      <Button title={t("logout")} variant="secondary" onPress={async () => { await signOut(); router.replace("/login"); }} />
    </Screen>
  );
}
