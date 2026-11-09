import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, loadSession, saveTokens, setSignedOutHandler } from "./api";
import { clearRegisteredPushToken, registeredPushToken } from "./notify";

interface Session {
  ready: boolean;
  signedIn: boolean;
  signIn: (tokens: { access_token: string; refresh_token: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedOutHandler(() => setSignedIn(false));
    // Güvenli depo okunamazsa (ör. Keychain erişimi yok) uygulama yükleme ekranında kalmasın: oturumsuz açılır.
    loadSession()
      .catch(() => false)
      .then((has) => {
        setSignedIn(has);
        setReady(true);
      });
  }, []);

  const signIn = useCallback(async (tokens: { access_token: string; refresh_token: string }) => {
    await saveTokens(tokens);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    // Bu cihazın push jetonu hesaptan silinir: çıkıştan sonra bu hesabın bildirimleri gelmez.
    const pushToken = registeredPushToken();
    await api("auth/logout", { method: "POST", ...(pushToken ? { body: { push_token: pushToken } } : {}) }).catch(
      () => undefined,
    );
    clearRegisteredPushToken();
    await clearTokens();
    setSignedIn(false);
  }, []);

  return <Ctx.Provider value={{ ready, signedIn, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider eksik");
  return s;
}
