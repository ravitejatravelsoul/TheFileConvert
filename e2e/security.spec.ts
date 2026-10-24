import { test, expect } from "@playwright/test";
import { addFiles, fx, trackPageErrors } from "./helpers/tool";

test.describe("Bad input fails safely", () => {
  test("a file with a .pdf name but other content can't be merged, and says which one", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/merge-pdf");
    await addFiles(page, [fx("fake-extension.pdf"), fx("sample-a.pdf")]);
    await expect(page.getByText(/One file can't be read/)).toBeVisible();
    await expect(page.getByText(/fake-extension\.pdf/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Merge 2 PDFs" })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("a truncated PDF gives a friendly message", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/compress-pdf");
    await addFiles(page, [fx("corrupted.pdf")]);
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(/couldn't be read/);
    expect(errors).toEqual([]);
  });

  test("the editor explains a PDF it can't open and stays usable", async ({ page }) => {
    await page.goto("/pdf-editor");
    await addFiles(page, [fx("corrupted.pdf")]);
    await expect(page.locator("main").getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Choose PDF" })).toBeVisible();
  });

  test("an SVG with scripts and event handlers never executes when converted", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    const errors = trackPageErrors(page);
    await page.goto("/convert-image");
    await addFiles(page, [fx("suspicious.svg")]);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByTestId("result")).toBeVisible();
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("an empty file is rejected by name", async ({ page }) => {
    await page.goto("/merge-pdf");
    await addFiles(page, [fx("zero-byte.pdf")]);
    await expect(page.locator("main").getByRole("alert")).toContainText("“zero-byte.pdf” is empty.");
  });

  test("an unsupported type is rejected with what the tool accepts", async ({ page }) => {
    await page.goto("/compress-image");
    await addFiles(page, [fx("sample.csv")]);
    await expect(page.locator("main").getByRole("alert")).toContainText("takes JPG, PNG or WebP files");
  });
});
