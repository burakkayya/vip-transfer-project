import { act, render, screen, waitFor } from "@testing-library/react-native";

import BookingScreen from "@/app/booking/[code]";
import { api } from "@/lib/api";
import { decodePolyline } from "@/lib/polyline";
import type { Booking } from "@/lib/types";

// Google referans vektörü: 3 nokta.
const ROUTE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ code: "GA-TEST1" }),
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

// Simge yazı tipi testte yüklenmez; simge düz metin olarak çizilir.
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
  api: jest.fn(),
  accessToken: () => "token",
  wsUrl: (path: string) => `ws://test/${path}`,
}));

const mockedApi = api as jest.MockedFunction<typeof api>;

// Canlı konum WebSocket'i: test, sunucudan gelen mesajı elle iter.
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send() {}
  close() {}
}

const region = (name: string, id: number) => ({
  id, code: `r${id}`, province: "Antalya", name, type: "ilce" as const, iata_code: null,
});

function booking(status: string, legStatus: string): Booking {
  return {
    id: "b1",
    booking_code: "GA-TEST1",
    booking_type: "planli",
    status,
    vehicle_type: { id: 1, code: "minivan", name: "Minivan", capacity: 6, luggage_capacity: 6 },
    passenger_name: "Ada Yolcu",
    passenger_count: 2,
    luggage_count: 2,
    total_amount: "60.00",
    currency: "EUR",
    created_at: "2026-11-01T10:00:00Z",
    legs: [{
      id: "l1",
      leg_order: 1,
      status: legStatus,
      pickup_region: region("Havalimanı", 1),
      dropoff_region: region("Lara", 2),
      pickup_address: null,
      dropoff_address: null,
      pickup_at: "2026-11-03T10:00:00Z",
      flight: null,
      driver: { first_name: "Mehmet", vehicle: "Mercedes Vito", plate: "07 ABC 01" },
      route_polyline: ROUTE,
    }],
  };
}

const all = { includeHiddenElements: true } as const;

beforeEach(() => {
  mockedApi.mockReset();
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});

test("passes route polyline to map", async () => {
  mockedApi.mockResolvedValue(booking("atandi", "atandi"));
  await render(<BookingScreen />);
  const line = await screen.findByTestId("map-polyline", all);
  expect(line.props.coordinates).toEqual(decodePolyline(ROUTE));
  expect(mockedApi).toHaveBeenCalledWith("me/bookings/GA-TEST1");
  expect(screen.getByLabelText("Map: Havalimanı → Lara")).toBeTruthy();
  expect(screen.queryByTestId("map-driver", all)).toBeNull();
});

test("shows live driver location on the map", async () => {
  mockedApi.mockResolvedValue(booking("atandi", "yolda"));
  await render(<BookingScreen />);
  await screen.findByTestId("map-polyline", all);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  await act(async () => {
    FakeSocket.last?.onmessage?.({ data: JSON.stringify({ location: { lat: 36.9, lng: 30.8, at: "2026-11-03T09:50:00Z" } }) });
  });
  expect(screen.getByTestId("map-driver", all).props.coordinate).toEqual({ latitude: 36.9, longitude: 30.8 });
  expect(screen.getByLabelText("Map: Havalimanı → Lara. The driver’s latest position is marked.")).toBeTruthy();
});
