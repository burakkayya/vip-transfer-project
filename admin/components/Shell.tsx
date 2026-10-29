"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Logo from "./Logo";
import { ROLE } from "@/lib/labels";
import { allowedNav, can, itemFor } from "@/lib/nav";

interface Me {
  id: string;
  kind: string;
  roles: string[];
}

const SessionContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("oturum yok");
  return me;
}

/** Rol kontrolü: yalnızca yetkili rollere görünen düğmeler için. Asıl kontrol backend'dedir. */
export function useCan() {
  const me = useMe();
  return (...roles: Parameters<typeof can>[1]) => can(me.roles, roles);
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("auth/me")
      .then((m) => {
        if (m.kind !== "staff") throw new Error("personel değil");
        setMe(m);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // Genel panele yetkisi olmayan (ör. yalnızca muhasebe) kullanıcı ilk yetkili sayfasına gider.
  useEffect(() => {
    if (!me || pathname !== "/") return;
    const nav = allowedNav(me.roles);
    if (nav.length && nav[0].href !== "/") router.replace(nav[0].href);
  }, [me, pathname, router]);

  if (!me) return null;

  const nav = allowedNav(me.roles);
  const current = itemFor(pathname);
  const allowed = current ? nav.includes(current) : true;
  const groups = [...new Set(nav.map((n) => n.group))];

  async function logout() {
    await api("auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <SessionContext.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <Logo />
          {groups.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-title">{g}</div>
              {nav
                .filter((n) => n.group === g)
                .map((n) => (
                  <Link key={n.href} href={n.href} className={current?.href === n.href ? "active" : ""}>
                    {n.label}
                  </Link>
                ))}
            </div>
          ))}
          <div className="sidebar-foot">
            <div className="muted">{me.roles.map((r) => ROLE[r] ?? r).join(", ")}</div>
            <Link href="/account" className={pathname === "/account" ? "active" : ""} style={{ padding: "4px 0" }}>
              Parolamı değiştir
            </Link>
            <button className="btn link" onClick={logout}>
              Çıkış
            </button>
          </div>
        </aside>
        <main className="content">
          {allowed ? (
            children
          ) : (
            <div className="stack">
              <h1>Yetkisiz</h1>
              <p>Bu sayfa rolünüz için açık değil.</p>
              {nav[0] && <Link href={nav[0].href}>{nav[0].label}</Link>}
            </div>
          )}
        </main>
      </div>
    </SessionContext.Provider>
  );
}
