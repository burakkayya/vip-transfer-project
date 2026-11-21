// MOB-01 / MOB-07 (F2-17 kabul testleri): çıkışta konum görevi durur, sunucu çıkışı bir kez yeniden denenir,
// sonuç ayırt edilir ve yerel oturum her durumda kapanır.
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Alert, Text } from "react-native";

import { ApiError, api } from "@/lib/api";
import { serverLogout } from "@/lib/logout";
import { SessionProvider, notifyIfServerLogoutFailed, useSession, type SignOutResult } from "@/lib/session";
import { stopBackgroundTracking } from "@/lib/tracking";

jest.mock("@/lib/notify", () => ({ registeredPushToken: () => "push-abc", clearRegisteredPushToken: jest.fn() }));
jest.mock("@/lib/tracking", () => ({ stopBackgroundTracking: jest.fn(async () => undefined) }));
jest.mock("@/lib/liveTrip", () => ({ endActiveLiveTrip: jest.fn(async () => undefined) }));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  api: jest.fn(),
}));

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedStop = stopBackgroundTracking as jest.MockedFunction<typeof stopBackgroundTracking>;
const noWait = async () => undefined;

let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  const s = useSession();
  useEffect(() => {
    session = s;
  });
  return <Text>{`ready=${s.ready} signedIn=${s.signedIn}`}</Text>;
}

async function signedInProvider() {
  const SecureStore = jest.requireMock("expo-secure-store");
  await SecureStore.setItemAsync("ga_access", "a");
  await SecureStore.setItemAsync("ga_refresh", "r");
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("ready=true signedIn=true")).toBeTruthy());
}

beforeEach(() => {
  mockedApi.mockReset();
  mockedStop.mockClear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe("serverLogout", () => {
  test("logout retried after network failure", async () => {
    const call = jest.fn().mockRejectedValueOnce(new ApiError(0, "network", "network")).mockResolvedValueOnce(undefined);
    await expect(serverLogout(call, "push-abc", noWait)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("auth/logout", { method: "POST", body: { push_token: "push-abc" } });
  });

  test("iki deneme de başarısızsa 'failed' döner (sessizce yutulmaz)", async () => {
    const call = jest.fn().mockRejectedValue(new ApiError(503, "unknown", "503"));
    await expect(serverLogout(call, null, noWait)).resolves.toBe("failed");
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("auth/logout", { method: "POST" });
  });

  test("401: oturum sunucuda zaten geçersiz; yeniden denenmez", async () => {
    const call = jest.fn().mockRejectedValue(new ApiError(401, "unauthorized", "401"));
    await expect(serverLogout(call, null, noWait)).resolves.toBe("already_invalid");
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("400 gibi istemci hatası yeniden denenmez, 'failed' döner", async () => {
    const call = jest.fn().mockRejectedValue(new ApiError(422, "validation_error", "422"));
    await expect(serverLogout(call, null, noWait)).resolves.toBe("failed");
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("SessionProvider.signOut", () => {
  test("signOut stops background location updates", async () => {
    mockedApi.mockResolvedValue(undefined);
    await signedInProvider();
    await act(async () => {
      await session!.signOut();
    });
    expect(mockedStop).toHaveBeenCalledTimes(1);
    // Konum görevi sunucu çıkışından önce durur (çıkış sırasında konum gönderilmesin).
    expect(mockedStop.mock.invocationCallOrder[0]).toBeLessThan(mockedApi.mock.invocationCallOrder[0]);
  });

  test("ağ hatasında da yerel jetonlar silinir ve sonuç 'failed' olur", async () => {
    mockedApi.mockRejectedValue(new ApiError(0, "network", "network"));
    await signedInProvider();
    let result: SignOutResult | undefined;
    await act(async () => {
      result = await session!.signOut();
    });
    expect(result).toEqual({ server: "failed" });
    expect(mockedApi).toHaveBeenCalledTimes(2);
    const SecureStore = jest.requireMock("expo-secure-store");
    expect(await SecureStore.getItemAsync("ga_access")).toBeNull();
    expect(await SecureStore.getItemAsync("ga_refresh")).toBeNull();
    expect(screen.getByText("ready=true signedIn=false")).toBeTruthy();
    expect(console.warn).toHaveBeenCalled();
  });

  test("konum görevi durdurulamasa da oturum temizliği sürer", async () => {
    mockedStop.mockRejectedValueOnce(new Error("task manager"));
    mockedApi.mockResolvedValue(undefined);
    await signedInProvider();
    let result: SignOutResult | undefined;
    await act(async () => {
      result = await session!.signOut();
    });
    expect(result).toEqual({ server: "ok" });
    const SecureStore = jest.requireMock("expo-secure-store");
    expect(await SecureStore.getItemAsync("ga_refresh")).toBeNull();
    expect(screen.getByText("ready=true signedIn=false")).toBeTruthy();
  });

  test("çıkışta bildirim imleci ve izlenen bacak anahtarları silinir", async () => {
    mockedApi.mockResolvedValue(undefined);
    await signedInProvider();
    const SecureStore = jest.requireMock("expo-secure-store");
    await SecureStore.setItemAsync("ga_updates_cursor", "2026-11-14T00:00:00Z");
    await act(async () => {
      await session!.signOut();
    });
    expect(await SecureStore.getItemAsync("ga_updates_cursor")).toBeNull();
  });
});

describe("notifyIfServerLogoutFailed (MOB-07, K-81)", () => {
  test("warns the user only when the server logout failed", () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    notifyIfServerLogoutFailed({ server: "ok" });
    notifyIfServerLogoutFailed({ server: "already_invalid" });
    expect(spy).not.toHaveBeenCalled();
    notifyIfServerLogoutFailed({ server: "failed" }, "driver");
    expect(spy).toHaveBeenCalledWith("Çıkış yapıldı", expect.stringContaining("sunucuya ulaşılamadı"));
    spy.mockRestore();
  });
});
