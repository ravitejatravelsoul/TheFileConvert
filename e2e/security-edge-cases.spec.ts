import path from "node:path";
import { test, expect } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("Security edge cases fail safely", () => {
  test("a file with the right extension but wrong content fails with a friendly message", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pdf/merge");
    await page.locator('input[type="file"]').setInputFiles([
      path.join(FIXTURES, "fake-extension.pdf"),
      path.join(FIXTURES, "sample-a.pdf"),
    ]);
    await page.getByRole("button", { name: /Merge 2 PDFs/i }).click();
    await expect(page.getByText(/couldn't read this PDF|damaged/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a truncated/corrupted PDF fails with a friendly message", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pdf/compress");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "corrupted.pdf"));
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await expect(page.getByText(/couldn't read this PDF|damaged/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a malformed ZIP fails with a friendly message", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/archive/unzip");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "malformed.zip"));
    await expect(page.getByText(/couldn't read this archive|damaged|not a ZIP/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("an SVG with a script and event handlers never executes", async ({ page }) => {
    const dialogs: string[] = [];
    const errors: string[] = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/image/svg-to-png");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "suspicious.svg"));
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByText("Done!")).toBeVisible();

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a zero-byte file is rejected immediately as empty", async ({ page }) => {
    await page.goto("/pdf/merge");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "zero-byte.pdf"));
    await expect(page.getByText(/empty/i)).toBeVisible();
  });

  test("uploading an unsupported file type shows a friendly error, not a crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pdf/merge");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample.csv"));
    await expect(page.getByText(/isn't supported/i)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
