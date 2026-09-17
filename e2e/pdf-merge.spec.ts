import path from "node:path";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("PDF merge workflow", () => {
  test("merges two PDFs and produces a valid combined PDF", async ({ page }) => {
    await page.goto("/pdf/merge");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([path.join(FIXTURES, "sample-a.pdf"), path.join(FIXTURES, "sample-b.pdf")]);

    await expect(page.getByText("sample-a.pdf")).toBeVisible();
    await expect(page.getByText("sample-b.pdf")).toBeVisible();

    const mergeButton = page.getByRole("button", { name: /Merge 2 PDFs/i });
    await expect(mergeButton).toBeEnabled();
    await mergeButton.click();

    await expect(page.getByText("Done!")).toBeVisible();
    const downloadButton = page.getByRole("button", { name: "Download", exact: true });
    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);

    expect(download.suggestedFilename()).toBe("merged.pdf");

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(downloadPath!));
    const merged = await PDFDocument.load(bytes);
    // sample-a.pdf has 2 pages, sample-b.pdf has 3 pages.
    expect(merged.getPageCount()).toBe(5);
  });

  test("shows a friendly error state and allows retry when processing fails", async ({ page }) => {
    await page.goto("/pdf/delete-pages");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES, "sample-a.pdf"));

    // sample-a.pdf only has 2 pages, so requesting page 99 should fail gracefully.
    await page.getByPlaceholder("2,4-6").fill("99");
    await page.getByRole("button", { name: "Delete pages" }).click();

    await expect(page.getByText(/none of the pages you entered exist/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
