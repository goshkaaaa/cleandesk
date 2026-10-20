import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  use: { baseURL: "http://127.0.0.1:3501", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3501",
    url: "http://127.0.0.1:3501",
    reuseExistingServer: !process.env.CI,
    env: { GITHUB_ACTIONS: "", DATA_DIR: ".test-data", COOKIE_SECURE: "false" },
  },
});
