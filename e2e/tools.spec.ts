import fs from "node:fs";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addFiles, downloadFrom, expectNoHorizontalOverflow, fx, pdfPageCount, trackPageErrors } from "./helpers/tool";

test.describe("Compress Image", () => {
  test("reaches a preset target and says so with exact bytes", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/compress-image");
    await addFiles(page, [fx("qa", "img-photo-noisy.jpg")]);
    await page.getByRole("radio", { name: "250 KB", exact: true }).click();
    await page.getByRole("button", { name: "Compress to under 250 KB" }).click();
    await expect(page.getByTestId("result").getByRole("status")).toContainText("Done");
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
    expect(bytes.length).toBeLessThanOrEqual(250_000);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // still a JPG
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("a transparent PNG becomes WebP, keeps transparency and says why", async ({ page }) => {
    await page.goto("/compress-image");
    await addFiles(page, [fx("qa", "img-photo-transparent.png")]);
    await page.getByRole("radio", { name: "Custom", exact: true }).click();
    await page.getByLabel("Custom target size").fill("300");
    await page.getByRole("radio", { name: "KB", exact: true }).click();
    await page.getByRole("button", { name: "Compress to under 300 KB" }).click();
    await expect(page.getByText("Converted to WebP to keep transparency while reaching your target.")).toBeVisible();
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    expect(bytes.length).toBeLessThanOrEqual(300_000);
  });

  test("an image already under the target comes back untouched", async ({ page }) => {
    await page.goto("/compress-image");
    await addFiles(page, [fx("qa", "img-photo-small-optimized.jpg")]);
    await page.getByRole("radio", { name: "100 KB", exact: true }).click();
    await page.getByRole("button", { name: "Compress to under 100 KB" }).click();
    await expect(page.getByTestId("result").getByRole("status")).toHaveText("Already under your target");
  });

  test("an invalid custom size can't be submitted", async ({ page }) => {
    await page.goto("/compress-image");
    await addFiles(page, [fx("sample.jpg")]);
    await page.getByRole("radio", { name: "Custom", exact: true }).click();
    await page.getByLabel("Custom target size").fill("abc");
    await expect(page.getByText(/Enter a size of at least 1 KB/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter a target size" })).toBeDisabled();
  });
});

test.describe("Image converter", () => {
  test("PNG → JPG flattens transparency; SVG → PNG renders at a usable size", async ({ page }) => {
    await page.goto("/convert-image");
    await addFiles(page, [fx("qa", "img-logo-transparent.png")]);
    await page.getByRole("radio", { name: /^JPG/ }).click();
    await page.getByRole("button", { name: "Convert to JPG" }).click();
    const jpg = await downloadFrom(page, page.getByRole("button", { name: "Download JPG" }));
    expect(jpg.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpg.download.suggestedFilename()).toBe("img-logo-transparent.jpg");

    await page.getByRole("button", { name: "New images" }).click();
    await addFiles(page, [fx("qa", "img-vector.svg")]);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByText(/× \d+px/)).toContainText(/1024 × \d+px|\d+ × 1024px/);
  });

  test("a batch downloads as a ZIP and files already in the target format are skipped", async ({ page }) => {
    await page.goto("/convert-image");
    await addFiles(page, [fx("sample.jpg"), fx("qa", "img-photo.webp"), fx("image-2x1.png")]);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByText("Already PNG — skipped")).toBeVisible();
    const zip = await JSZip.loadAsync((await downloadFrom(page, page.getByRole("button", { name: "Download all (ZIP)" }))).bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["img-photo.png", "sample.png"]);
  });
});

test.describe("PDF → Image", () => {
  test("selected pages become PNGs in a ZIP", async ({ page }) => {
    await page.goto("/pdf-to-image");
    await addFiles(page, [fx("multi-page.pdf")]);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
    await page.getByRole("checkbox", { name: "Page 3", exact: true }).click();
    await page.getByRole("radio", { name: "PNG" }).click();
    await page.getByRole("button", { name: "Convert 2 pages" }).click();
    const zip = await JSZip.loadAsync((await downloadFrom(page, page.getByRole("button", { name: "Download all (ZIP)" }))).bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["multi-page-page-2.png", "multi-page-page-3.png"]);
  });
});

test.describe("Images → PDF", () => {
  test("images become pages in the order set with the move buttons", async ({ page }) => {
    await page.goto("/image-to-pdf");
    await addFiles(page, [fx("sample.jpg"), fx("image-2x1.png")]);
    await page.getByRole("button", { name: "Move image-2x1.png earlier" }).click();
    await page.getByRole("button", { name: /^Create PDF/ }).click();
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    // image-2x1.png (300×150 px) was moved first: fit-to-image makes its page 225 × 112.5 pt.
    expect(doc.getPage(0).getWidth()).toBeCloseTo(225);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(112.5);
  });
});

test.describe("Merge PDF", () => {
  test("shows page counts, merges in the chosen order", async ({ page }) => {
    await page.goto("/merge-pdf");
    await addFiles(page, [fx("sample-a.pdf"), fx("sample-b.pdf"), fx("multi-page.pdf")]);
    await expect(page.getByText(/pages in total/)).toBeVisible();
    await page.getByRole("button", { name: "Move multi-page.pdf up" }).click();
    await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download merged PDF" }));
    const a = await pdfPageCount(fs.readFileSync(fx("sample-a.pdf")));
    const b = await pdfPageCount(fs.readFileSync(fx("sample-b.pdf")));
    const m = await pdfPageCount(fs.readFileSync(fx("multi-page.pdf")));
    expect(await pdfPageCount(bytes)).toBe(a + b + m);
  });

  test("needs at least two files", async ({ page }) => {
    await page.goto("/merge-pdf");
    await addFiles(page, [fx("sample-a.pdf")]);
    await expect(page.getByText("Add at least one more PDF to merge.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Merge 1 PDFs" })).toBeDisabled();
  });
});

test.describe("Split PDF", () => {
  test("extracts the clicked pages; split-every-page gives a ZIP of single pages", async ({ page }) => {
    await page.goto("/split-pdf");
    await addFiles(page, [fx("multi-page.pdf")]);
    await page.getByRole("checkbox", { name: "Page 1", exact: true }).click();
    await page.getByRole("checkbox", { name: "Page 3", exact: true }).click();
    await page.getByRole("button", { name: "Extract 2 pages" }).click();
    const extracted = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" }));
    expect(await pdfPageCount(extracted.bytes)).toBe(2);

    await page.getByRole("button", { name: "Back to pages" }).click();
    await page.getByRole("radio", { name: /Split every page/ }).click();
    await page.getByRole("button", { name: /^Split into \d+ PDFs$/ }).click();
    const zip = await JSZip.loadAsync((await downloadFrom(page, page.getByRole("button", { name: "Download all (ZIP)" }))).bytes);
    const names = Object.keys(zip.files);
    expect(names.length).toBeGreaterThan(1);
    for (const n of names) expect(await pdfPageCount(Buffer.from(await zip.files[n].async("uint8array")))).toBe(1);
  });

  test("a typed range outside the document is refused with a clear message", async ({ page }) => {
    await page.goto("/split-pdf");
    await addFiles(page, [fx("multi-page.pdf")]);
    await page.getByLabel("Or type pages").fill("2-99");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByText(/This PDF has pages 1 to \d+\./)).toBeVisible();
  });
});

test.describe("Organize PDF", () => {
  test("rotate, delete (with restore) and duplicate pages, then save", async ({ page }) => {
    await page.goto("/organize-pdf");
    await addFiles(page, [fx("multi-page.pdf")]);
    const count = await pdfPageCount(fs.readFileSync(fx("multi-page.pdf")));
    await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click();
    await page.getByRole("button", { name: "Delete Page 2", exact: true }).click();
    await page.getByRole("button", { name: "Restore Page 2", exact: true }).click();
    await page.getByRole("button", { name: "Delete Page 2", exact: true }).click();
    await page.getByRole("button", { name: "Duplicate Page 1", exact: true }).click();
    await page.getByRole("button", { name: "Save PDF" }).click();
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(count); // -1 deleted, +1 duplicate
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(90); // the duplicate keeps its rotation
  });
});
