// Oturum açıkken bildirim akışını (`me/updates` veya `driver/updates`) yoklar ve her yeni olayı
// yerel bildirim olarak gösterir. Bildirime dokunulunca ilgili ekran açılır (rezervasyon, yolculuk, sohbet).
// Sürücü yolculuktayken ön plan konum hizmeti süreci canlı tuttuğu için yoklama arka planda da sürer.
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { api } from "@/lib/api";
import { VARIANT } from "@/lib/config";
import { isActiveChat, registerPushToken, setupNotifications, showLocal } from "@/lib/notify";
import { useSession } from "@/lib/session";
import { storage } from "@/lib/storage";
import type { TripUpdate } from "@/lib/types";

const CURSOR_KEY = "ga_updates_cursor";
const FOREGROUND_MS = 8_000;
const BACKGROUND_MS = 20_000;
/** İlk açılışta (imleç yokken) eski olaylar bildirilmez; yalnızca son birkaç dakika. */
const FIRST_RUN_WINDOW_MS = 3 * 60_000;

function openFor(data: TripUpdate["data"]) {
  if (VARIANT === "driver") {
    if (!data.leg_id) return;
    if (data.type === "new_message") router.push(`/chat/${data.leg_id}`);
    else router.push(`/trip/${data.leg_id}`);
    return;
  }
  if (!data.booking_code) return;
  if (data.type === "new_message") router.push(`/chat/${data.booking_code}`);
  else router.push(`/booking/${data.booking_code}`);
}

export default function UpdatesWatcher() {
  const { signedIn } = useSession();
  const cursor = useRef<string | null>(null);
  const seen = useRef(new Set<string>());

  // Bildirime dokunma: ilgili ekrana git.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      openFor(r.notification.request.content.data as TripUpdate["data"]);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!signedIn || Platform.OS === "web") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      try {
        if (cursor.current === null) {
          cursor.current = (await storage.get(CURSOR_KEY)) ?? new Date(Date.now() - FIRST_RUN_WINDOW_MS).toISOString();
        }
        const path = VARIANT === "driver" ? "driver/updates" : "me/updates";
        const items = await api<TripUpdate[]>(`${path}?after=${encodeURIComponent(cursor.current)}`);
        for (const u of items) {
          if (seen.current.has(u.id)) continue;
          seen.current.add(u.id);
          if (u.code === "new_message" && isActiveChat(u.data)) continue;
          await showLocal(u.title, u.body, u.data);
        }
        if (items.length) {
          cursor.current = items[items.length - 1].created_at;
          await storage.set(CURSOR_KEY, cursor.current);
        }
      } catch {
        // Ağ hatası: bir sonraki turda yeniden denenir.
      }
      if (!stopped) timer = setTimeout(poll, AppState.currentState === "active" ? FOREGROUND_MS : BACKGROUND_MS);
    }

    void setupNotifications()
      .then((granted) => {
        if (granted) void registerPushToken();
      })
      .catch(() => undefined);
    void poll();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        if (timer) clearTimeout(timer);
        void poll();
      }
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [signedIn]);

  return null;
}
