import { defineConfig, devices } from "@playwright/test";

/** Production smoke: the same browser tests, pointed at the live site (PROD_URL). No local server is started. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.PROD_SPECS ? new RegExp(process.env.PROD_SPECS) : /production-smoke\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  use: { baseURL: process.env.PROD_URL ?? "https://thefileconvert.com", trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
