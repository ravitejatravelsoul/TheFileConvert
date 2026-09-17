import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("Archive round-trip integrity", () => {
  test("files zipped then extracted keep their names and exact byte content", async ({ page }) => {
    await page.goto("/archive/zip");
    await page.locator('input[type="file"]').setInputFiles([
      path.join(FIXTURES, "sample.csv"),
      path.join(FIXTURES, "multi-page.pdf"),
    ]);
    await page.getByRole("button", { name: /Create ZIP from 2 files/i }).click();
    await expect(page.getByText("Done!")).toBeVisible();

    const [zipDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    // Use saveAs (not .path()) so the file keeps a real .zip extension on disk — the
    // app validates uploads by filename extension, and Playwright's raw download path
    // often has none, which would otherwise make this a test artifact, not an app bug.
    const zipPath = test.info().outputPath("created.zip");
    await zipDownload.saveAs(zipPath);

    await page.goto("/archive/unzip");
    await page.locator('input[type="file"]').setInputFiles(zipPath);
    await expect(page.getByText(/This archive contains 2 files/i)).toBeVisible();
    await page.getByRole("button", { name: "Extract all files" }).click();
    await expect(page.getByText("Done!")).toBeVisible();

    const [extractedDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download all as ZIP/i }).click(),
    ]);
    const extractedPath = test.info().outputPath("extracted.zip");
    await extractedDownload.saveAs(extractedPath);

    const zip = await JSZip.loadAsync(fs.readFileSync(extractedPath));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["multi-page.pdf", "sample.csv"]);

    const csvOut = await zip.files["sample.csv"].async("nodebuffer");
    const csvOriginal = fs.readFileSync(path.join(FIXTURES, "sample.csv"));
    expect(csvOut.equals(csvOriginal)).toBe(true);

    const pdfOut = await zip.files["multi-page.pdf"].async("nodebuffer");
    const pdfOriginal = fs.readFileSync(path.join(FIXTURES, "multi-page.pdf"));
    expect(pdfOut.equals(pdfOriginal)).toBe(true);
  });
});
