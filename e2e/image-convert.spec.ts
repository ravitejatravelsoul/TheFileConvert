import path from "node:path";
import fs from "node:fs/promises";
import { test, expect } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("Image conversion workflow", () => {
  test("converts a JPG to a valid PNG", async ({ page }) => {
    await page.goto("/convert/jpg-to-png");

    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample.jpg"));
    await expect(page.getByText("sample.jpg")).toBeVisible();

    const convertButton = page.getByRole("button", { name: /Convert 1 file/i });
    await convertButton.click();

    await expect(page.getByText("Done!")).toBeVisible();
    const downloadButton = page.getByRole("button", { name: "Download", exact: true });
    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await fs.readFile(downloadPath!);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  test("rejects a file type the tool doesn't accept", async ({ page }) => {
    await page.goto("/convert/jpg-to-png");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample.csv"));
    await expect(page.getByText(/isn't supported/i)).toBeVisible();
  });
});
