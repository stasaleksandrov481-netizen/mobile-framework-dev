import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "first-experience.spec.mjs",
  fullyParallel: true,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8765", screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: process.env.CORTEX_BROWSER_EXECUTABLE ? { executablePath: process.env.CORTEX_BROWSER_EXECUTABLE } : {}
  },
  webServer: {
    command: "python3 -m http.server 8765 --bind 127.0.0.1 --directory ../../app/src/main/assets/web",
    url: "http://127.0.0.1:8765", reuseExistingServer: !process.env.CI
  }
});
