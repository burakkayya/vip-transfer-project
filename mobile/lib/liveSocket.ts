// Müşteri canlı konum WebSocket'i (K-51). Backend kapanış kodları (backend/app/api/customer.py):
// 4401 kimlik/oturum geçersiz (jeton süresi doldu ya da oturum iptal), 4408 ilk mesaj süresinde gelmedi,
// 4429 bağlantı sınırı, 1000 takip bitti veya bağlantı ömrü doldu. Yeniden bağlanma sınırlıdır; sonsuz döngü yok.
import { useEffect, useRef } from "react";
import { accessToken, refreshAccessToken, wsUrl } from "./api";
import { apiPath } from "./routeParams";
import type { DriverLocation } from "./types";

export const WS_CLOSE = { NORMAL: 1000, UNAUTHORIZED: 4401, AUTH_TIMEOUT: 4408, LIMIT: 4429 } as const;

type Kind = "auth" | "timeout" | "limit" | "normal" | "other";

export interface ReconnectState {
  counts: Record<Kind, number>;
  /** Bu bağlantı ömrü (ekran) boyunca yapılan toplam yeniden bağlanma; mesaj gelince sıfırlanmaz. */
  total: number;
}

/** Tür başına en fazla deneme ve bekleme (ms, deneme sırasına göre ikiye katlanır). */
const POLICY: Record<Kind, { max: number; baseMs: number }> = {
  auth: { max: 1, baseMs: 250 }, // önce jeton yenilenir
  timeout: { max: 3, baseMs: 2_000 }, // 2 s, 4 s, 8 s
  limit: { max: 2, baseMs: 30_000 }, // 30 s, 60 s
  normal: { max: 1, baseMs: 5_000 }, // takip bittiyse sunucu yine 1000 ile kapatır, ikinci kez denenmez
  other: { max: 3, baseMs: 3_000 }, // ağ kopması (1006), sunucu hatası (1011): 3 s, 6 s, 12 s
};
/** Uzun yolculukta jeton süresi dolunca (4401) yeniden bağlanma gerekir; yine de üst sınır vardır. */
export const MAX_TOTAL_RECONNECTS = 30;

export function initialReconnectState(): ReconnectState {
  return { counts: { auth: 0, timeout: 0, limit: 0, normal: 0, other: 0 }, total: 0 };
}

/** Sunucudan konum mesajı geldi: bağlantı sağlıklı, tür sayaçları sıfırlanır (toplam sınır korunur). */
export function resetOnMessage(s: ReconnectState): ReconnectState {
  return { ...initialReconnectState(), total: s.total };
}

function kindOf(code: number): Kind {
  switch (code) {
    case WS_CLOSE.UNAUTHORIZED:
      return "auth";
    case WS_CLOSE.AUTH_TIMEOUT:
      return "timeout";
    case WS_CLOSE.LIMIT:
      return "limit";
    case WS_CLOSE.NORMAL:
      return "normal";
    default:
      return "other";
  }
}

export type CloseDecision =
  | { kind: "retry"; delayMs: number; refreshFirst: boolean; state: ReconnectState }
  | { kind: "stop"; reason: "auth" | "exhausted"; state: ReconnectState };

/** Kapanış koduna göre ne yapılacağı. Saf işlev: test edilebilir, zamanlayıcı kurmaz. */
export function decideOnClose(code: number, s: ReconnectState): CloseDecision {
  const kind = kindOf(code);
  const used = s.counts[kind];
  const { max, baseMs } = POLICY[kind];
  if (used >= max || s.total >= MAX_TOTAL_RECONNECTS) {
    // Jeton yenilendikten sonra yine 4401: oturum gerçekten geçersiz, giriş akışına dönülür.
    return { kind: "stop", reason: kind === "auth" ? "auth" : "exhausted", state: s };
  }
  const state = { counts: { ...s.counts, [kind]: used + 1 }, total: s.total + 1 };
  return { kind: "retry", delayMs: baseMs * 2 ** used, refreshFirst: kind === "auth", state };
}

/**
 * Canlı konum aboneliği. `code` doğrulanmış rezervasyon kodudur. Jeton URL'de değil ilk mesajda gönderilir.
 * `onAuthLost`: 4401 sonrası jeton yenilenemedi (ya da yenilenen jetonla yine 4401); yeniden bağlanılmaz.
 * Bileşen kapanınca (veya `enabled` false olunca) soket kapanır ve bekleyen zamanlayıcı iptal edilir.
 */
export function useLiveLocation(
  code: string | null,
  enabled: boolean,
  onLocation: (l: DriverLocation | null) => void,
  onAuthLost: () => void,
): void {
  // Geri çağrılar her çizimde değişebilir; soketi yeniden kurmamak için ref'te tutulur.
  const cb = useRef({ onLocation, onAuthLost });
  useEffect(() => {
    cb.current = { onLocation, onAuthLost };
  });

  useEffect(() => {
    if (!enabled || !code) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let state = initialReconnectState();

    const connect = () => {
      if (disposed) return;
      const sock = new WebSocket(wsUrl(apiPath`ws/bookings/${code}/location`));
      ws = sock;
      sock.onopen = () => sock.send(JSON.stringify({ token: accessToken() }));
      sock.onmessage = (m) => {
        let data: { location?: DriverLocation | null };
        try {
          data = JSON.parse(String(m.data)) as { location?: DriverLocation | null };
        } catch {
          return; // bozuk mesaj yok sayılır
        }
        state = resetOnMessage(state);
        cb.current.onLocation(data.location ?? null);
      };
      // Hatanın ardından platform `onclose` çağırır; karar orada verilir. Kapanmazsa kapatmaya zorlanır.
      sock.onerror = () => {
        if (ws === sock) sock.close();
      };
      sock.onclose = (e) => {
        if (disposed || ws !== sock) return;
        ws = null;
        const d = decideOnClose(e.code, state);
        state = d.state;
        if (d.kind === "stop") {
          if (d.reason === "auth") cb.current.onAuthLost();
          return;
        }
        timer = setTimeout(() => {
          timer = null;
          void (async () => {
            if (disposed) return;
            if (d.refreshFirst) {
              const ok = await refreshAccessToken().catch(() => false);
              if (disposed) return;
              if (!ok) {
                cb.current.onAuthLost();
                return;
              }
            }
            connect();
          })();
        }, d.delayMs);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const sock = ws;
      ws = null;
      if (sock) {
        sock.onclose = null;
        sock.onerror = null;
        sock.onmessage = null;
        sock.close();
      }
    };
  }, [code, enabled]);
}
