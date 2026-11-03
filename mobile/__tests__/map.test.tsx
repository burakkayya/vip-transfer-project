import { render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
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

test("passes the same dp edge padding on Android as on iOS", async () => {
  // react-native-maps Android tarafı dp → px dönüşümünü kendisi yapar; JS ölçeklememeli.
  const os = jest.replaceProperty(Platform, "OS", "android");
  await render(<MapCanvas mode="route" route={ROUTE} hiddenBottom={100} />);
  expect(commands().fitToCoordinates).toHaveBeenCalledWith(
    POINTS,
    expect.objectContaining({ edgePadding: { top: 40, right: 40, bottom: 140, left: 40 } }),
  );
  os.restore();
});

test("uses a dark map style on Android in dark mode", async () => {
  const os = jest.replaceProperty(Platform, "OS", "android");
  await render(<MapCanvas mode="route" route={ROUTE} dark />);
  const style = screen.getByTestId("map-view", all).props.customMapStyle;
  expect(Array.isArray(style)).toBe(true);
  expect(style.length).toBeGreaterThan(0);
  os.restore();
});

test("keeps the provider style on iOS and in light mode", async () => {
  await render(<MapCanvas mode="route" route={ROUTE} dark />);
  expect(screen.getByTestId("map-view", all).props.customMapStyle).toBeUndefined();
  expect(screen.getByTestId("map-view", all).props.userInterfaceStyle).toBe("dark");
});

test("centres on a single-point route without fitting", async () => {
  await render(<MapCanvas mode="route" route="_p~iF~ps|U" />);
  expect(commands().fitToCoordinates).not.toHaveBeenCalled();
  expect(commands().animateToRegion).toHaveBeenCalledWith(
    expect.objectContaining({ latitude: 38.5, longitude: -120.2 }),
    600,
  );
  expect(screen.getByTestId("map-pickup", all).props.coordinate).toEqual({ latitude: 38.5, longitude: -120.2 });
  expect(screen.queryByTestId("map-dropoff", all)).toBeNull();
  expect(screen.queryByTestId("map-polyline", all)).toBeNull();
});

test("static markers do not track view changes", async () => {
  await render(<MapCanvas mode="route" route={ROUTE} />);
  expect(screen.getByTestId("map-pickup", all).props.tracksViewChanges).toBe(false);
  expect(screen.getByTestId("map-dropoff", all).props.tracksViewChanges).toBe(false);
});
