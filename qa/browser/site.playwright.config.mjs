import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "site-css.spec.mjs",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3210",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.CORTEX_BROWSER_EXECUTABLE
      ? { executablePath: process.env.CORTEX_BROWSER_EXECUTABLE }
      : {},
  },
  webServer: {
    command: "npm run start --prefix ../../cortex-web -- --port 3210",
    url: "http://127.0.0.1:3210/register",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
