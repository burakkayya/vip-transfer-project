// K-58: haritayla ilgili her şey Google; anahtarsız derlemede sahte harita yerine açık uyarı gösterilir.
import { render, screen } from "@testing-library/react-native";
import MapCanvas from "@/components/MapCanvas";

jest.mock("@/lib/config", () => ({ ...jest.requireActual("@/lib/config"), GOOGLE_MAPS_IOS: false, GOOGLE_MAPS_ANDROID: false }));

test("anahtarsız derlemede uyarı gösterilir, harita çizilmez", async () => {
  await render(<MapCanvas mode="route" route="_p~iF~ps|U_ulLnnqC" />);
  expect(screen.getByText("Google Haritalar anahtarı bu derlemede tanımlı değil.", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId("map-view", { includeHiddenElements: true })).toBeNull();
});
