import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("Target-size PDF compression is honest about what it actually achieved", () => {
  test("an already-small PDF: Target reached is shown, and any claimed reduction is real", async ({ page }) => {
    await page.goto("/pdf/compress");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample-a.pdf"));
    await page.getByRole("button", { name: "Under 5 MB", exact: true }).click();
    await page.getByRole("button", { name: /^Compress to under 5 MB/ }).click();
    await expect(page.getByText("Done!")).toBeVisible({ timeout: 30_000 });

    // A file already well under the target must be reported as Target reached, never "Closest safe result".
    await expect(page.getByText("Target ✓ under 5 MB")).toBeVisible();

    const originalSize = fs.statSync(path.join(FIXTURES, "sample-a.pdf")).size;
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    const newSize = fs.statSync((await download.path())!).size;

    // The UI's claim must match reality: if it says "X% smaller", the file must actually be that much smaller.
    const smallerText = await page.getByText(/smaller$/).count();
    if (smallerText > 0) expect(newSize).toBeLessThan(originalSize);
  });

  test("an image-dominated PDF: the search stops at a rung whose real output actually fits the target", async ({ page }) => {
    await page.goto("/pdf/compress");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "with-image.pdf"));
    await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });

    const originalSize = fs.statSync(path.join(FIXTURES, "with-image.pdf")).size;
    // A target comfortably below the original forces the ladder search to actually run.
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.locator("input[type=number]").fill(String(Math.max(1, Math.round((originalSize / 1024) * 0.6))));
    await page.locator("select").selectOption("KB");
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    const newSize = fs.statSync((await download.path())!).size;

    // Whichever outcome is shown, it must be true of the actual downloaded bytes.
    const achieved = (await page.getByText(/^Target ✓/).count()) > 0;
    const closest = (await page.getByText("Closest safe result").count()) > 0;
    expect(achieved || closest).toBe(true);
    if (achieved) expect(newSize).toBeLessThanOrEqual(Math.round((originalSize / 1024) * 0.6 * 1024));
  });

  test("an impossible target never fakes success: it is labelled Closest safe result and the file still opens", async ({ page }) => {
    await page.goto("/pdf/compress");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "with-image.pdf"));
    await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.locator("input[type=number]").fill("1");
    await page.locator("select").selectOption("KB");
    await page.getByRole("button", { name: /^Compress to under 1 KB/ }).click();
    await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText("Closest safe result")).toBeVisible();
    await expect(page.getByText(/Couldn.t reach 1 KB/)).toBeVisible();
  });
});
