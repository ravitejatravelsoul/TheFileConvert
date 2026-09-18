import fs from "node:fs";
import path from "node:path";

/** Cross-process mutex so at most one real Tesseract recognition runs system-wide at a
 * time, even across separate Playwright *projects* (chromium-ocr / mobile-chromium-ocr),
 * which run in separate worker processes and so can't coordinate via in-memory JS state.
 * `fullyParallel: false` on those projects already serializes tests *within* each one;
 * this closes the remaining gap where two projects' recognitions could still overlap.
 * A plain file lock (not Playwright's `dependencies`, which skips a dependent project's
 * tests entirely if its dependency has any failure) keeps every test independent. */

const LOCK_PATH = path.join(__dirname, "..", "..", "test-results", ".ocr-recognition.lock");
const STALE_AFTER_MS = 3 * 60 * 1000; // guards against a deadlock if a holder crashed/was killed
const POLL_INTERVAL_MS = 300;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<void> {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  for (;;) {
    try {
      fs.closeSync(fs.openSync(LOCK_PATH, "wx"));
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        if (age > STALE_AFTER_MS) {
          fs.rmSync(LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        // Lock disappeared between the failed open and this stat — loop and retry.
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function releaseLock(): void {
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    // Already gone — nothing to clean up.
  }
}

/** Runs `fn` while holding the system-wide OCR recognition lock. */
export async function withOcrLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}
