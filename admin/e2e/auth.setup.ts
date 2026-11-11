import { readFileSync, writeFileSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { AUTH_FILE, ENV_FILE, hasCredentials, SKIP_MESSAGE, writeEmptyState } from "./session";

/** TOTP sırrını git'e girmeyen admin/.env.e2e.local dosyasına yazar (yoksa ekler, varsa değiştirir). */
function persistSecret(secret: string): void {
  let text = "";
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    // dosya yoksa yeni oluşturulur
  }
  const lines = text.split(/\r?\n/).filter((l) => l !== "" && !l.startsWith("ADMIN_E2E_TOTP_SECRET="));
  lines.push(`ADMIN_E2E_TOTP_SECRET=${secret}`);
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

setup("admin oturumu aç", async ({ page }) => {
  if (!hasCredentials()) {
    writeEmptyState();
    setup.skip(true, SKIP_MESSAGE);
  }

  await page.goto("/login");
  await page.getByLabel("E-posta").fill(process.env.ADMIN_E2E_EMAIL!);
  await page.getByLabel("Parola").fill(process.env.ADMIN_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Devam" }).click();

  const codeInput = page.getByLabel("Doğrulama kodu");
  // Parola karması ve dev sunucuda ilk derleme girişi birkaç saniye sürebilir.
  await expect(codeInput).toBeVisible({ timeout: 20_000 });

  // İlk girişte (setup_required) sayfa sırrı gösterir; sonraki girişlerde saklanan sır kullanılır.
  const shown = page.locator(".hint .mono");
  let secret = process.env.ADMIN_E2E_TOTP_SECRET;
  if (await shown.count()) {
    secret = (await shown.first().innerText()).trim();
    persistSecret(secret);
    process.env.ADMIN_E2E_TOTP_SECRET = secret;
  }
  if (!secret) {
    writeEmptyState();
    setup.skip(true, "ADMIN_E2E_TOTP_SECRET tanımlı değil ve 2FA kurulumu istenmedi");
    return;
  }

  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
  await codeInput.fill(code);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await page.context().storageState({ path: AUTH_FILE });
});
