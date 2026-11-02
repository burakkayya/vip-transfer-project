import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Yerel e2e değerleri git'e girmeyen `admin/.env.e2e.local` dosyasından okunur
// (ADMIN_E2E_EMAIL, ADMIN_E2E_PASSWORD, ADMIN_E2E_TOTP_SECRET). Ortamda tanımlı değişken öncelikli.
const ENV_FILE = resolve(__dirname, ".env.e2e.local");

function loadEnvFile(): void {
  let text: string;
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const AUTH_FILE = "e2e/.auth/admin.json";

// Sunucu ayakta varsayılır (webServer yok): `npm run start` veya `npm run dev` (3001).
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: process.env.ADMIN_URL ?? "http://localhost:3001",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { viewport: { width: 1440, height: 900 }, storageState: AUTH_FILE },
    },
  ],
});
