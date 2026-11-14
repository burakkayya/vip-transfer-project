// MOB-01: arka plan konum görevi oturum yoksa veya 401/403 alırsa kendini durdurur.
import { ApiError } from "@/lib/api";

type TaskFn = (body: { data?: { locations?: unknown[] }; error?: unknown }) => Promise<void>;
let task: TaskFn | null = null;

jest.mock("expo-constants", () => ({ __esModule: true, default: { executionEnvironment: "bare" } }));
jest.mock("expo-task-manager", () => ({
  defineTask: (_name: string, fn: TaskFn) => {
    task = fn;
  },
}));
jest.mock("expo-location", () => ({
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
}));
jest.mock("@/lib/liveTrip", () => ({ endLiveTrip: jest.fn(async () => undefined) }));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  api: jest.fn(),
  loadSession: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- taklitler kurulduktan sonra yüklenir */
const Location = require("expo-location");
const apiMod = require("@/lib/api");
require("@/lib/tracking");
/* eslint-enable @typescript-eslint/no-require-imports */

const LEG = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const loc = { coords: { latitude: 36.9, longitude: 30.8, heading: null } };

beforeEach(async () => {
  const SecureStore = jest.requireMock("expo-secure-store");
  await SecureStore.setItemAsync("ga_tracking_leg", LEG);
  Location.stopLocationUpdatesAsync.mockClear();
  apiMod.api.mockReset();
  apiMod.loadSession.mockReset();
});

test("oturum yoksa görev konum göndermeden durur", async () => {
  apiMod.loadSession.mockResolvedValue(false);
  await task!({ data: { locations: [loc] } });
  expect(apiMod.api).not.toHaveBeenCalled();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});

test.each([401, 403])("%i alınca görev durur", async (status) => {
  apiMod.loadSession.mockResolvedValue(true);
  apiMod.api.mockRejectedValue(new ApiError(status, "unauthorized", String(status)));
  await task!({ data: { locations: [loc] } });
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});

test("ağ hatasında görev sürer", async () => {
  apiMod.loadSession.mockResolvedValue(true);
  apiMod.api.mockRejectedValue(new ApiError(0, "network", "network"));
  await task!({ data: { locations: [loc] } });
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
});

test("geçersiz bacak kimliği saklanmışsa istek atılmaz, görev durur", async () => {
  const SecureStore = jest.requireMock("expo-secure-store");
  await SecureStore.setItemAsync("ga_tracking_leg", "../../auth/logout");
  apiMod.loadSession.mockResolvedValue(true);
  await task!({ data: { locations: [loc] } });
  expect(apiMod.api).not.toHaveBeenCalled();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});
