// K-58: Android'de anahtarsız karolu harita (TileMap) noktaları kenar paylarıyla görünür alana sığdırır.
import { render, screen } from "@testing-library/react-native";
import TileMap, { fit, project } from "@/components/TileMap";

const AYT = { latitude: 36.8987, longitude: 30.8005 };
const KEMER = { latitude: 36.6009, longitude: 30.5717 };

test("Web Mercator: boylam arttıkça x, enlem arttıkça y azalır", () => {
  const a = project(AYT, 10);
  const b = project(KEMER, 10);
  expect(a.x).toBeGreaterThan(b.x);
  expect(a.y).toBeLessThan(b.y);
});

test("rota dolgulu alana sığar ve en büyük uygun yakınlaştırma seçilir", () => {
  const pad = { top: 96, right: 40, bottom: 400, left: 40 };
  const { z, origin } = fit([AYT, KEMER], 400, 800, pad);
  for (const p of [AYT, KEMER]) {
    const s = project(p, z);
    const x = s.x - origin.x;
    const y = s.y - origin.y;
    expect(x).toBeGreaterThanOrEqual(pad.left - 1);
    expect(x).toBeLessThanOrEqual(400 - pad.right + 1);
    expect(y).toBeGreaterThanOrEqual(pad.top - 1);
    expect(y).toBeLessThanOrEqual(800 - pad.bottom + 1);
  }
  // Bir üst yakınlaştırmada sığmaz.
  const a = project(AYT, z + 1);
  const b = project(KEMER, z + 1);
  expect(Math.abs(a.x - b.x) > 320 || Math.abs(a.y - b.y) > 304).toBe(true);
});

test("atıf metni görünür", async () => {
  await render(<TileMap route={[AYT, KEMER]} preview={false} pickup={AYT} dropoff={KEMER} driver={null}
    pad={{ top: 0, right: 0, bottom: 0, left: 0 }} line="#000" ring="#fff" />);
  expect(screen.getByText("© OpenStreetMap © CARTO")).toBeTruthy();
});
