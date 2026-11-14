// MOB-02: derin bağlantı / rota parametreleri API yoluna eklenmeden önce doğrulanır ve kodlanır.
import { apiPath, consumeAutoPay, parseBookingCode, parseChatId, parseLegId, requestAutoPay } from "@/lib/routeParams";

const LEG = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("parseBookingCode", () => {
  test.each(["GA7K3M9P", "GA23456Z"])("geçerli kod kabul edilir: %s", (code) => {
    expect(parseBookingCode(code)).toBe(code);
  });

  test.each([
    "../../auth/me",
    "..%2F..%2Fauth%2Fme",
    "GA7K3M9P/../../x",
    "GA7K3M9P?x=1",
    "GA7K3M9P#x",
    "ga7k3m9p",
    "",
    " GA7K3M9P",
    "GA",
    "A".repeat(40),
  ])("geçersiz kod reddedilir: %s", (code) => {
    expect(parseBookingCode(code)).toBeNull();
  });

  test("dizi veya tanımsız değer reddedilir", () => {
    expect(parseBookingCode(["GA7K3M9P", "GA23456Z"])).toBeNull();
    expect(parseBookingCode(undefined)).toBeNull();
  });
});

describe("parseLegId", () => {
  test("UUID kabul edilir (büyük/küçük harf)", () => {
    expect(parseLegId(LEG)).toBe(LEG);
    expect(parseLegId(LEG.toUpperCase())).toBe(LEG.toUpperCase());
  });

  test.each(["leg-1", "../trips", `${LEG}/../../x`, `${LEG}?a=1`, ""])("geçersiz bacak kimliği reddedilir: %s", (id) => {
    expect(parseLegId(id)).toBeNull();
  });
});

describe("parseChatId", () => {
  test("sürücüde UUID, müşteride rezervasyon kodu beklenir", () => {
    expect(parseChatId(LEG, "driver")).toBe(LEG);
    expect(parseChatId("GA7K3M9P", "driver")).toBeNull();
    expect(parseChatId("GA7K3M9P", "customer")).toBe("GA7K3M9P");
    expect(parseChatId(LEG, "customer")).toBeNull();
  });
});

describe("apiPath", () => {
  test("her değer encodeURIComponent ile kodlanır", () => {
    expect(apiPath`me/bookings/${"GA7K3M9P"}/eta`).toBe("me/bookings/GA7K3M9P/eta");
    expect(apiPath`me/bookings/${"a/b?c#d"}/eta`).toBe("me/bookings/a%2Fb%3Fc%23d/eta");
  });

  test.each(["", ".", ".."])("boş veya nokta segmenti reddedilir: %p", (v) => {
    expect(() => apiPath`me/bookings/${v}/eta`).toThrow();
  });
});

describe("otomatik ödeme niyeti (pay=1 yerine)", () => {
  test("yalnızca uygulama içinden istenen kod için bir kez tüketilir", () => {
    expect(consumeAutoPay("GA7K3M9P")).toBe(false);
    requestAutoPay("GA7K3M9P");
    expect(consumeAutoPay("GA23456Z")).toBe(false);
    expect(consumeAutoPay("GA7K3M9P")).toBe(true);
    expect(consumeAutoPay("GA7K3M9P")).toBe(false);
  });
});
