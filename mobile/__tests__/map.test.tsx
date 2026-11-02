import { render, screen } from "@testing-library/react-native";
import * as Maps from "react-native-maps";

import MapCanvas from "@/components/MapCanvas";
import { palette } from "@/lib/tokens";

// Google referans vektörü: 3 nokta.
const ROUTE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const POINTS = [
  { latitude: 38.5, longitude: -120.2 },
  { latitude: 40.7, longitude: -120.95 },
  { latitude: 43.252, longitude: -126.453 },
];

// Taklit (jest.setup.ts) kamera komutlarını `__commands` olarak dışa verir.
const commands = () => (Maps as unknown as { __commands: { fitToCoordinates: jest.Mock; animateToRegion: jest.Mock } }).__commands;

// Özet verilmeyen harita ekran okuyucudan gizlenir; yapı sorguları gizli öğeleri de kapsar.
const all = { includeHiddenElements: true } as const;

beforeEach(() => {
  commands().fitToCoordinates.mockClear();
  commands().animateToRegion.mockClear();
});

test("renders Polyline with decoded coordinates", async () => {
  await render(<MapCanvas mode="route" route={ROUTE} />);
  const line = screen.getByTestId("map-polyline", all);
  expect(line.props.coordinates).toEqual(POINTS);
  expect(line.props.strokeColor).toBe(palette.lacquerBlack);
  expect(line.props.strokeWidth).toBe(4);
  // Alış (daire) ve varış (kare) işaretleri rotanın uçlarında.
  expect(screen.getByTestId("map-pickup", all).props.coordinate).toEqual(POINTS[0]);
  expect(screen.getByTestId("map-dropoff", all).props.coordinate).toEqual(POINTS[2]);
  expect(screen.queryByTestId("map-driver", all)).toBeNull();
  // Kamera tüm noktaları alt panel payıyla içine alır.
  expect(commands().fitToCoordinates).toHaveBeenCalledWith(
    POINTS,
    expect.objectContaining({ edgePadding: expect.objectContaining({ bottom: 66 + 40 }), animated: true }),
  );
});

test("shows driver marker and includes it in the camera fit", async () => {
  const driver = { latitude: 39, longitude: -121 };
  await render(<MapCanvas mode="driver" route={ROUTE} driver={driver} hiddenBottom={120} />);
  expect(screen.getByTestId("map-driver", all).props.coordinate).toEqual(driver);
  expect(commands().fitToCoordinates).toHaveBeenCalledWith(
    [...POINTS, driver],
    expect.objectContaining({ edgePadding: expect.objectContaining({ bottom: 120 + 40 }) }),
  );
});

test("exposes accessibility summary", async () => {
  await render(<MapCanvas route={ROUTE} accessibilitySummary="Havalimanı → Lara, 18 km" />);
  const map = screen.getByLabelText("Havalimanı → Lara, 18 km");
  expect(map.props.accessible).toBe(true);
});

test("falls back to Antalya region without route", async () => {
  await render(<MapCanvas mode="idle" />);
  const region = screen.getByTestId("map-view", all).props.initialRegion;
  expect(region.latitude).toBeCloseTo(36.8969, 4);
  expect(region.longitude).toBeCloseTo(30.7133, 4);
  expect(screen.queryByTestId("map-polyline", all)).toBeNull();
  expect(commands().fitToCoordinates).not.toHaveBeenCalled();
});

test("moves the camera without animation when reduce motion is on", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- spyOn için değiştirilebilir CJS nesnesi gerekir
  const reanimated = require("react-native-reanimated");
  const spy = jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(true);
  await render(<MapCanvas mode="route" route={ROUTE} />);
  expect(commands().fitToCoordinates).toHaveBeenCalledWith(POINTS, expect.objectContaining({ animated: false }));
  spy.mockRestore();
});
