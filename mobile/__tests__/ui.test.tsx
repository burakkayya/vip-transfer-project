import { render, screen } from "@testing-library/react-native";

import { Button, statusTone } from "@/components/ui";

test("statusTone maps booking statuses", () => {
  expect(statusTone("onaylandi")).toBe("ok");
  expect(statusTone("iptal")).toBe("danger");
  expect(statusTone("odeme_bekliyor")).toBe("warn");
  expect(statusTone("bilinmeyen")).toBeUndefined();
});

test("Button exposes button role and label", async () => {
  await render(<Button title="Devam" onPress={() => {}} />);
  expect(screen.getByRole("button", { name: "Devam" })).toBeTruthy();
});
