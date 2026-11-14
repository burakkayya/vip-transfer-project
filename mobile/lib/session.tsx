import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, loadSession, saveTokens, setSignedOutHandler } from "./api";
import { endActiveLiveTrip } from "./liveTrip";
import { serverLogout, type ServerLogoutResult } from "./logout";
import { clearRegisteredPushToken, registeredPushToken } from "./notify";
import { storage } from "./storage";
import { stopBackgroundTracking } from "./tracking";

/** Çıkış sonucu: yerel oturum her durumda kapanır; `server` sunucu tarafının sonucunu ayırt eder. */
export interface SignOutResult {
  server: ServerLogoutResult;
}

interface Session {
  ready: boolean;
  signedIn: boolean;
  signIn: (tokens: { access_token: string; refresh_token: string }) => Promise<void>;
  signOut: () => Promise<SignOutResult>;
}

// Çıkışta silinen, hesaba bağlı yerel anahtarlar (bildirim imleci; izlenen bacak stopBackgroundTracking ile).
const ACCOUNT_KEYS = ["ga_updates_cursor"];

const Ctx = createContext<Session | null>(null);

/** Hata yutulur ama adı loglanır (jeton/kişisel veri içermez); çıkışın kalan adımları sürer. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`Çıkış adımı başarısız (${name}):`, e instanceof Error ? e.message : String(e));
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedOutHandler(() => setSignedIn(false));
    // Güvenli depo okunamazsa (ör. Keychain erişimi yok) uygulama yükleme ekranında kalmasın: oturumsuz açılır.
    loadSession()
      .catch((e: unknown) => {
        // Jeton içermez: yalnızca hatanın adı/iletisi (teşhis için).
        console.warn("Oturum deposu okunamadı:", e instanceof Error ? e.message : String(e));
        return false;
      })
      .then((has) => {
        setSignedIn(has);
        setReady(true);
      });
  }, []);

  const signIn = useCallback(async (tokens: { access_token: string; refresh_token: string }) => {
    await saveTokens(tokens);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    let server: ServerLogoutResult = "failed";
    try {
      // MOB-01: arka plan konum görevi ve kilit ekranı canlı etkinliği önce durur (çıkış sırasında konum gitmesin).
      await step("konum görevi", stopBackgroundTracking);
      await step("canlı etkinlik", endActiveLiveTrip);
      // MOB-07: sunucu oturumu ve bu cihazın push jetonu hesaptan silinir; geçici hatada bir kez yeniden denenir.
      const pushToken = registeredPushToken();
      server = await serverLogout(api, pushToken).catch(() => "failed" as const);
      if (server === "failed") {
        // Sessizce yutulmaz. Yerel oturum yine kapanır; sunucu oturumu yenileme jetonu süresince açık kalabilir.
        console.warn("Sunucu çıkışı başarısız: yerel oturum kapatıldı, sunucu oturumu ve push kaydı kalmış olabilir.");
      }
    } finally {
      // Yerel oturum her durumda kapanır.
      clearRegisteredPushToken();
      for (const key of ACCOUNT_KEYS) await step(key, () => storage.remove(key));
      await step("jetonlar", clearTokens);
      setSignedIn(false);
    }
    return { server };
  }, []);

  return <Ctx.Provider value={{ ready, signedIn, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider eksik");
  return s;
}
