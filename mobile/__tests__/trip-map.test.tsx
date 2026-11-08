import { fireEvent, render, screen } from "@testing-library/react-native";

import TripScreen from "@/app/trip/[legId]";
import { ApiError, api } from "@/lib/api";
import { decodePolyline } from "@/lib/polyline";
import type { Trip } from "@/lib/types";

// Google referans vektörü: 3 nokta.
const ROUTE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ legId: "leg-1" }),
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  watchPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

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

jest.mock("@/lib/api", () => ({ ...jest.requireActual("@/lib/api"), api: jest.fn() }));

const mockedApi = api as jest.MockedFunction<typeof api>;

function trip(status: string): Trip {
  return {
    leg_id: "leg-1",
    booking_code: "GA-TEST1",
    status,
    pickup_at: "2026-11-03T10:00:00Z",
    pickup_region: "Havalimanı",
    dropoff_region: "Lara",
    pickup_address: null,
    dropoff_address: null,
    pickup_lat: "36.9000",
    pickup_lng: "30.8000",
    passenger_name: "Ada Yolcu",
    passenger_count: 2,
    luggage_count: 2,
    flight_no: null,
    driver_amount: "45.00",
    currency: "EUR",
    route_polyline: ROUTE,
  };
}

const all = { includeHiddenElements: true } as const;

beforeEach(() => {
  mockedApi.mockReset();
});

test("passes route polyline to map", async () => {
  mockedApi.mockResolvedValue(trip("atandi"));
  await render(<TripScreen />);
  const line = await screen.findByTestId("map-polyline", all);
  expect(line.props.coordinates).toEqual(decodePolyline(ROUTE));
  // Tekil yolculuk ucu polyline'ı döndürür; liste ucu döndürmez.
  expect(mockedApi).toHaveBeenCalledWith("driver/trips/leg-1");
  expect(screen.getByLabelText("Harita: Havalimanı → Lara")).toBeTruthy();
  expect(screen.queryByTestId("map-driver", all)).toBeNull();
});

test("shows the last shared position as driver marker", async () => {
  mockedApi.mockImplementation(async (path: string) => (path === "driver/trips/leg-1" ? trip("yolda") : {}) as never);
  await render(<TripScreen />);
  await screen.findByTestId("map-polyline", all);
  fireEvent.press(await screen.findByText(/Geliştirme: hedefe yakın konum/));
  const marker = await screen.findByTestId("map-driver", all);
  expect(marker.props.coordinate.latitude).toBeCloseTo(36.9, 1);
  expect(marker.props.coordinate.longitude).toBeCloseTo(30.8, 1);
  expect(screen.getByLabelText("Harita: Havalimanı → Lara. Konumunuz haritada işaretli.")).toBeTruthy();
});

test("shows the error state when the trip is not found", async () => {
  mockedApi.mockRejectedValue(new ApiError(404, "not_found", "Yolculuk bulunamadı."));
  await render(<TripScreen />);
  expect(await screen.findByText("Yolculuk bulunamadı.")).toBeTruthy();
});
