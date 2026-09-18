import { defineConfig, devices } from "@playwright/test";

const OCR_HEAVY_SPECS = /(ocr|pdf-editor-ocr)\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Playwright's own default (half the logical CPU count) still left real Tesseract
  // recognition degrading under a full-suite run on this machine — not just slower, but
  // occasionally returning zero recognized words/lines with no error, even with the OCR
  // cross-process lock (above) guaranteeing no two recognitions ever overlap. That points
  // to memory/CPU exhaustion from the ~8 concurrent heavy Chromium instances the default
  // spins up (each doing real PDF/canvas rendering), not a logic bug to fix in code. This
  // is a moderate, evidence-based reduction (not a full disable of parallelism — every
  // other spec file still runs across multiple workers) that gives the OS enough headroom
  // for recognition to produce full, correct output consistently.
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    // Every test file that triggers real Tesseract WASM recognition runs here. Left fully
    // parallel, several concurrent recognitions land on different workers at once and
    // compete for CPU on a single dev machine — under that contention, even unrelated
    // synchronous assertions (e.g. a validation-error test that does no OCR at all) can
    // miss their timeout, and recognition accuracy itself can degrade (observed: a clean
    // scan's real OCR output missing text it reliably reads out when unstressed). Scoping
    // these files to their own fullyParallel:false projects serializes tests *within* each
    // project. That alone isn't enough on a full-suite run, though: chromium-ocr and
    // mobile-chromium-ocr are still separate Playwright projects and could still run
    // concurrently with each other (Playwright's `dependencies` would force strict
    // ordering, but it skips a dependent project's tests entirely if the dependency has any
    // failure — unacceptable here). Instead, the actual recognition step in each test
    // acquires a cross-process file lock (e2e/helpers/ocr-lock.ts) before running, so at
    // most one real Tesseract session runs system-wide at a time regardless of which
    // project or worker process it's in, without any risk of skipping tests.
    { name: "chromium-ocr", testMatch: OCR_HEAVY_SPECS, fullyParallel: false, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium-ocr", testMatch: OCR_HEAVY_SPECS, fullyParallel: false, use: { ...devices["Pixel 7"] } },
    { name: "chromium", testIgnore: OCR_HEAVY_SPECS, use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      testIgnore: OCR_HEAVY_SPECS,
      use: { ...devices["Pixel 7"] },
    },
  ],
});
