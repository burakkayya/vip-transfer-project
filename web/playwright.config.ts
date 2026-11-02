import { defineConfig } from "@playwright/test";

// Sunucu ayakta varsayılır (webServer yok): `npm run start` veya `npm run dev`.
export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
