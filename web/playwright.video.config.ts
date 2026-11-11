import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

// Same tests, recording a video of every test (test-results/**/video.webm). For the user's on-screen check.
export default defineConfig({
  ...base,
  workers: 1,
  use: { ...base.use, video: { mode: "on", size: { width: 1280, height: 800 } } },
});
