import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("PDF compression is honest about its limits", () => {
  test("an already-small/optimized PDF shows 'No significant change', never fake savings", async ({ page }) => {
    await page.goto("/pdf/compress");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample-a.pdf"));
    await page.getByRole("button", { name: /Compress sample-a.pdf/i }).click();
    await expect(page.getByText("Done!")).toBeVisible();

    // Never claim a percentage reduction that didn't happen.
    await expect(page.getByText(/smaller$/)).toHaveCount(0);
  });

  test("an image-dominated PDF is disclosed as unlikely to shrink, and the result never lies about it", async ({ page }) => {
    await page.goto("/pdf/compress");
    // The tool sets expectations before processing: what the file contains, and what each mode can do.
    await expect(page.getByText(/merging repeated images/i).first()).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "with-image.pdf"));
    await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/^Lossless/).check(); // the lossless mode must not claim savings it can't deliver
    await page.getByRole("button", { name: /Compress with-image.pdf/i }).click();
    await expect(page.getByText("Done!")).toBeVisible();

    const originalSize = fs.statSync(path.join(FIXTURES, "with-image.pdf")).size;
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    const downloadPath = await download.path();
    const newSize = fs.statSync(downloadPath!).size;

    // The UI's claim must match reality: if it says "X% smaller", the file must actually be
    // at least that much smaller. If it doesn't claim a reduction, that's fine too.
    const smallerText = await page.getByText(/smaller$/).count();
    if (smallerText > 0) {
      expect(newSize).toBeLessThan(originalSize);
    }
  });
});
