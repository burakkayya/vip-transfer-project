import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { SessionProvider, useSession } from "@/lib/session";

jest.mock("@/lib/notify", () => ({ registeredPushToken: () => null, clearRegisteredPushToken: jest.fn() }));

function Probe() {
  const s = useSession();
  return <Text>{`ready=${s.ready} signedIn=${s.signedIn}`}</Text>;
}

test("güvenli depo okunamazsa uygulama oturumsuz açılır (yüklemede kalmaz)", async () => {
  const SecureStore = jest.requireMock("expo-secure-store");
  SecureStore.getItemAsync.mockRejectedValueOnce(new Error("Keychain erişimi yok"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByText("ready=true signedIn=false")).toBeTruthy());
  expect(warn).toHaveBeenCalledWith("Oturum deposu okunamadı:", "Keychain erişimi yok");
  warn.mockRestore();
});
