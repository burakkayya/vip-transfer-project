// MOB-02 (F2-17 kabul testleri): derin bağlantıdan gelen geçersiz kod ile istek atılmaz; `pay=1` yok sayılır.
import { render, screen, waitFor } from "@testing-library/react-native";

import BookingScreen from "@/app/booking/[code]";
import { api } from "@/lib/api";
import type { Booking } from "@/lib/types";

let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
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
  refreshAccessToken: jest.fn(async () => false),
  expireSession: jest.fn(async () => undefined),
  wsUrl: (path: string) => `ws://test/${path}`,
}));

const mockedApi = api as jest.MockedFunction<typeof api>;

function pendingBooking(code: string): Booking {
  const region = { id: 1, code: "r1", province: "Antalya", name: "Lara", type: "ilce" as const, iata_code: null };
  return {
    id: "b1", booking_code: code, booking_type: "planli", status: "odeme_bekliyor", currency: "EUR",
    total_amount: "50.00", passenger_name: "Ada Y", passenger_phone: "", passenger_count: 1, luggage_count: 0,
    vehicle_type: { code: "minivan", name: "Minivan" },
    legs: [{
      id: "l1", direction: "gidis", status: "beklemede", pickup_at: "2026-11-20T10:00:00Z",
      pickup_region: region, dropoff_region: region, pickup_address: null, dropoff_address: null,
      flight: null, driver: null, route_polyline: null,
    }],
  } as unknown as Booking;
}

beforeEach(() => {
  mockedApi.mockReset();
});

test("booking screen does not fetch with traversal code", async () => {
  mockParams = { code: "../../auth/me" };
  await render(<BookingScreen />);
  expect(await screen.findByText(/bağlantı geçersiz|link is invalid/i)).toBeTruthy();
  expect(mockedApi).not.toHaveBeenCalled();
});

test("deep link pay=1 ignored", async () => {
  mockParams = { code: "GA7K3M9P", pay: "1" };
  mockedApi.mockResolvedValue(pendingBooking("GA7K3M9P"));
  await render(<BookingScreen />);
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith("me/bookings/GA7K3M9P"));
  await new Promise((r) => setTimeout(r, 20));
  // Ödeme başlatma isteği (POST .../payments) derin bağlantıyla tetiklenmez.
  expect(mockedApi.mock.calls.some(([p]) => String(p).endsWith("/payments"))).toBe(false);
});
