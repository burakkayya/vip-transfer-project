// MOB-02: bildirim verisindeki rezervasyon kodu doğrulanmadan ekran açılmaz.
import { router } from "expo-router";

import { openFor } from "@/components/UpdatesWatcher";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-notifications", () => ({}));

const push = router.push as jest.Mock;

beforeEach(() => push.mockClear());

test("geçerli kodla rezervasyon ekranı parametre nesnesiyle açılır", () => {
  openFor({ type: "driver_assigned", booking_code: "GA7K3M9P" });
  expect(push).toHaveBeenCalledWith({ pathname: "/booking/[code]", params: { code: "GA7K3M9P" } });
});

test("geçersiz kodla ekran açılmaz", () => {
  openFor({ type: "new_message", booking_code: "../../auth/me" });
  openFor({ type: "x" });
  openFor(null);
  expect(push).not.toHaveBeenCalled();
});
