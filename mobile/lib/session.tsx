import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, loadSession, saveTokens, setSignedOutHandler } from "./api";

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
    loadSession().then((has) => {
      setSignedIn(has);
      setReady(true);
    });
  }, []);

  const signIn = useCallback(async (tokens: { access_token: string; refresh_token: string }) => {
    await saveTokens(tokens);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await api("auth/logout", { method: "POST" }).catch(() => undefined);
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
