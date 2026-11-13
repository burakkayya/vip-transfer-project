// Canlı konum WebSocket'i: kapanış koduna göre yeniden bağlanma politikası (sonsuz döngü yok).
import { MAX_TOTAL_RECONNECTS, WS_CLOSE, decideOnClose, initialReconnectState, resetOnMessage } from "@/lib/liveSocket";

function run(code: number, times: number) {
  let s = initialReconnectState();
  const out = [];
  for (let i = 0; i < times; i++) {
    const d = decideOnClose(code, s);
    s = d.state;
    out.push(d);
    if (d.kind === "stop") break;
  }
  return out;
}

test("4401: önce jeton yenilenip bir kez yeniden bağlanılır, ikinci 4401'de giriş akışına dönülür", () => {
  const [first, second] = run(WS_CLOSE.UNAUTHORIZED, 3);
  expect(first).toMatchObject({ kind: "retry", refreshFirst: true });
  expect(second).toMatchObject({ kind: "stop", reason: "auth" });
});

test("4408: sınırlı sayıda, artan beklemeyle", () => {
  const ds = run(WS_CLOSE.AUTH_TIMEOUT, 10);
  const retries = ds.filter((d) => d.kind === "retry");
  expect(retries.length).toBe(3);
  const delays = retries.map((d) => (d.kind === "retry" ? d.delayMs : 0));
  expect(delays[1]).toBeGreaterThan(delays[0]);
  expect(delays[2]).toBeGreaterThan(delays[1]);
  expect(retries.every((d) => d.kind === "retry" && !d.refreshFirst)).toBe(true);
  expect(ds[ds.length - 1]).toMatchObject({ kind: "stop", reason: "exhausted" });
});

test("4429: uzun bekleme ile sınırlı yeniden deneme", () => {
  const ds = run(WS_CLOSE.LIMIT, 10);
  const retries = ds.filter((d) => d.kind === "retry");
  expect(retries.length).toBe(2);
  expect(retries.every((d) => d.kind === "retry" && d.delayMs >= 30_000)).toBe(true);
  expect(ds[ds.length - 1]).toMatchObject({ kind: "stop" });
});

test("1000 (takip bitti/ömür doldu): en fazla bir kez yeniden bağlanılır", () => {
  const ds = run(WS_CLOSE.NORMAL, 5);
  expect(ds.filter((d) => d.kind === "retry").length).toBe(1);
});

test("ağ kopması (1006): sınırlı yeniden deneme", () => {
  const ds = run(1006, 10);
  expect(ds.filter((d) => d.kind === "retry").length).toBe(3);
});

test("mesaj alınınca tür sayaçları sıfırlanır ama toplam sınır korunur (sonsuz döngü yok)", () => {
  let s = initialReconnectState();
  let retries = 0;
  for (let i = 0; i < 1000; i++) {
    const d = decideOnClose(WS_CLOSE.UNAUTHORIZED, s);
    s = d.state;
    if (d.kind === "stop") break;
    retries++;
    s = resetOnMessage(s);
  }
  expect(retries).toBe(MAX_TOTAL_RECONNECTS);
});
