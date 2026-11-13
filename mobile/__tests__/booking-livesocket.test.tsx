// Canlı konum WebSocket'i ekran davranışı: 4401'de yenileme, başarısızsa giriş; kapanışta temizlik.
import { act, render, screen } from "@testing-library/react-native";

import BookingScreen from "@/app/booking/[code]";
import { api, expireSession, refreshAccessToken } from "@/lib/api";
import type { Booking } from "@/lib/types";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ code: "GA7K3M9P" }),
  router: { back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), canGoBack: () => true },
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock fabrikası modülleri require ile alır */
  const { Text } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { __esModule: true, default: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/lib/api", () => ({
  ApiError: jest.requireActual("@/lib/api").ApiError,
  api: jest.fn(),
  accessToken: () => "token",
  refreshAccessToken: jest.fn(),
  expireSession: jest.fn(async () => undefined),
  wsUrl: (path: string) => `ws://test/${path}`,
}));

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedRefresh = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>;

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
}

function tracking(): Booking {
  const region = { id: 1, code: "r1", province: "Antalya", name: "Lara", type: "ilce" as const, iata_code: null };
  return {
    id: "b1", booking_code: "GA7K3M9P", booking_type: "planli", status: "atandi", currency: "EUR",
    total_amount: "50.00", passenger_name: "Ada Y", passenger_phone: "", passenger_count: 1, luggage_count: 0,
    vehicle_type: { code: "minivan", name: "Minivan" },
    legs: [{
      id: "l1", direction: "gidis", status: "yolda", pickup_at: "2026-11-20T10:00:00Z",
      pickup_region: region, dropoff_region: region, pickup_address: null, dropoff_address: null, flight: null,
      driver: { first_name: "Ali", vehicle: "Minivan", plate: "07 ABC 12" }, route_polyline: null,
    }],
  } as unknown as Booking;
}

const realWs = globalThis.WebSocket;
beforeEach(() => {
  jest.useFakeTimers();
  FakeSocket.all = [];
  mockReplace.mockClear();
  mockedRefresh.mockReset();
  (expireSession as jest.Mock).mockClear();
  mockedApi.mockImplementation(async (path: string) => {
    if (path === "me/bookings/GA7K3M9P") return tracking();
    if (path.endsWith("/eta")) return { eta_minutes: 5 };
    if (path.endsWith("/unread")) return { unread: 0 };
    return undefined;
  });
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  jest.useRealTimers();
  globalThis.WebSocket = realWs;
});

async function mounted() {
  const r = await render(<BookingScreen />);
  await screen.findByText("Ali");
  expect(FakeSocket.all.length).toBe(1);
  expect(FakeSocket.all[0].url).toBe("ws://test/ws/bookings/GA7K3M9P/location");
  return r;
}

test("4401: jeton yenilenirse yeniden bağlanır", async () => {
  mockedRefresh.mockResolvedValue(true);
  await mounted();
  await act(async () => {
    FakeSocket.all[0].onclose?.({ code: 4401 });
    await jest.advanceTimersByTimeAsync(2_000);
  });
  expect(mockedRefresh).toHaveBeenCalledTimes(1);
  expect(FakeSocket.all.length).toBe(2);
});

test("4401: yenileme başarısızsa yeniden bağlanmaz ve giriş akışına yönlendirir", async () => {
  mockedRefresh.mockResolvedValue(false);
  await mounted();
  await act(async () => {
    FakeSocket.all[0].onclose?.({ code: 4401 });
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(FakeSocket.all.length).toBe(1);
  expect(expireSession).toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith("/login");
});

test("4408 tekrarlanırsa sınırlı sayıda yeniden bağlanır", async () => {
  await mounted();
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      FakeSocket.all[FakeSocket.all.length - 1].onclose?.({ code: 4408 });
      await jest.advanceTimersByTimeAsync(120_000);
    });
  }
  expect(FakeSocket.all.length).toBe(4); // ilk bağlantı + 3 deneme
});

test("bileşen kapanınca bekleyen yeniden bağlanma iptal edilir ve soket kapanır", async () => {
  const r = await mounted();
  await act(async () => {
    FakeSocket.all[0].onclose?.({ code: 4429 });
  });
  await r.unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300_000);
  });
  expect(FakeSocket.all.length).toBe(1);
});

test("açık soket bileşen kapanınca kapatılır", async () => {
  const r = await mounted();
  await r.unmount();
  expect(FakeSocket.all[0].closed).toBe(true);
});
