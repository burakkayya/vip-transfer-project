import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Avatar, IconButton, Loading, T, colors, fonts, s, tap } from "@/components/ui";
import { api } from "@/lib/api";
import { VARIANT } from "@/lib/config";
import { LOCALE, errorText, errorTextTr, t } from "@/lib/i18n";
import { setActiveChat } from "@/lib/notify";
import type { Chat, ChatMessage } from "@/lib/types";

const POLL_MS = 4_000;
const DRIVER = VARIANT === "driver";

// Sürücü hazır cevapları (Türkçe); müşteri cevapları uygulama dilinde.
const DRIVER_QUICK = ["Yoldayım, birazdan oradayım.", "Geldim, sizi bekliyorum.", "Trafik var, birkaç dakika gecikeceğim.", "Çıkış kapısındayım, isminizi tutan tabelayla."];

function time(iso: string) {
  return new Date(iso).toLocaleTimeString(DRIVER ? "tr-TR" : LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Yolculuk sohbeti (K-50). Sürücüde `id` bacak kimliği, müşteride rezervasyon kodudur.
 * Telefon numarası paylaşılmaz; yazışma sürücü atanınca açılır, yolculuk bitince yalnızca okunur.
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const base = DRIVER ? `driver/trips/${id}/messages` : `me/bookings/${id}/messages`;
  const errText = DRIVER ? errorTextTr : errorText;
  const quick = DRIVER ? DRIVER_QUICK : [t("chat.q1"), t("chat.q2"), t("chat.q3"), t("chat.q4")];

  const load = useCallback(async () => {
    try {
      setChat(await api<Chat>(base));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [base, errText]);

  // Ekran açıkken yoklanır; bu sohbetin mesaj bildirimi gösterilmez.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(id);
      void load();
      const timer = setInterval(load, POLL_MS);
      return () => {
        clearInterval(timer);
        setActiveChat(null);
      };
    }, [id, load]),
  );

  const count = chat?.messages.length ?? 0;
  useEffect(() => {
    if (count) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [count]);

  async function send(body: string) {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      const msg = await api<ChatMessage>(base, { body: { body: clean } });
      setChat((c) => (c ? { ...c, messages: [...c.messages, msg] } : c));
      setText("");
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
    }
  }

  const mine = DRIVER ? "driver" : "customer";
  const title = chat ? chat.other_name : DRIVER ? "Mesajlar" : t("chat.title");
  const lastMine = chat ? [...chat.messages].reverse().find((m) => m.sender === mine) : undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Başlık */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <IconButton icon="arrow-back" label={DRIVER ? "Geri" : t("back")} onPress={() => (router.canGoBack() ? router.back() : router.replace(DRIVER ? "/home" : "/bookings"))} />
        <Avatar name={title} size={40} dark={!DRIVER} />
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: "800", fontSize: 17 }} numberOfLines={1}>{title}</T>
          <T style={s.hint} numberOfLines={1}>
            {chat && !chat.open ? (DRIVER ? "Yolculuk bitti · yalnızca okunur" : t("chat.closed")) : DRIVER ? "Yolcu · numaranız paylaşılmaz" : t("chat.title")}
          </T>
        </View>
      </View>

      {!chat ? (
        <View style={{ padding: 20 }}>{error ? <Alert text={error} /> : <Loading />}</View>
      ) : (
        <FlatList
          ref={list}
          data={chat.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chatbubbles-outline" size={26} color={colors.ink} />
              </View>
              <T style={[s.hint, { textAlign: "center" }]}>
                {DRIVER ? "Yolcuya buradan yazabilirsiniz. Telefon numaraları paylaşılmaz." : t("chat.empty")}
              </T>
            </View>
          }
          renderItem={({ item }) => {
            const own = item.sender === mine;
            return (
              <Animated.View entering={FadeInUp.duration(250)} style={{ alignItems: own ? "flex-end" : "flex-start" }}>
                <View style={{
                  maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
                  backgroundColor: own ? colors.ink : colors.canvas,
                  borderBottomRightRadius: own ? 6 : 20, borderBottomLeftRadius: own ? 20 : 6,
                }}>
                  <T style={{ color: own ? "#fff" : colors.ink, fontSize: 16, lineHeight: 22 }}>{!own && item.translated_body ? item.translated_body : item.body}</T>
                  {!own && item.translated_body ? (
                    <T style={{ color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
                      {DRIVER ? "Aslı" : t("chat.original")}: {item.body}
                    </T>
                  ) : null}
                </View>
                <T style={[s.hint, { fontSize: 11, marginTop: 3, marginHorizontal: 6 }]}>
                  {time(item.created_at)}
                  {own && item.id === lastMine?.id && item.read_at ? ` · ${DRIVER ? "Okundu" : t("chat.read")}` : ""}
                </T>
              </Animated.View>
            );
          }}
        />
      )}

      {error && chat ? <View style={{ paddingHorizontal: 16 }}><Alert text={error} /></View> : null}

      {/* Hazır cevaplar ve yazma alanı */}
      {chat?.open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: insets.bottom + 8, paddingTop: 10, gap: 10, backgroundColor: colors.bg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} keyboardShouldPersistTaps="handled">
            {quick.map((q) => (
              <Pressable key={q} accessibilityRole="button" disabled={sending} onPress={() => { tap(); void send(q); }}
                style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" }, pressed && { backgroundColor: colors.canvas }]}>
                <T style={{ fontWeight: "600", fontSize: 14 }}>{q}</T>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={DRIVER ? "Mesaj yazın" : t("chat.placeholder")}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={1000}
              accessibilityLabel={DRIVER ? "Mesaj" : t("chat.placeholder")}
              style={{ flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, backgroundColor: colors.canvas, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13, fontSize: 16, fontFamily: fonts.regular, color: colors.ink }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={DRIVER ? "Gönder" : t("chat.send")} disabled={!text.trim() || sending}
              onPress={() => void send(text)}
              style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, backgroundColor: text.trim() ? colors.ink : colors.line, alignItems: "center", justifyContent: "center" }, pressed && { transform: [{ scale: 0.95 }] }]}>
              <Ionicons name="arrow-up" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
