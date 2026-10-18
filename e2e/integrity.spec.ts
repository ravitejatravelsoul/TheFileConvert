import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addFiles, downloadFrom, fx, trackPageErrors } from "./helpers/tool";
import { verifyPdfBytes } from "../src/lib/pdf/save";
import { withGenerationOneCatalog } from "../src/lib/pdf/test-fixtures";

// Output-integrity regressions. The release blocker: a scanned PDF that had been incrementally updated
// (its catalog at generation 1) came out of Compress PDF "under 1 MB" — and unopenable in Acrobat and
// Windows ("We can't open this file"), because pdf-lib wrote the generation-1 objects back with a broken
// cross-reference table. verifyPdfBytes reads the xref the way those strict viewers do.

const PHOTO = fs.readFileSync(fx("qa", "img-photo-noisy.jpg"));

/** A two-page photo scan, incrementally updated so its catalog is at generation 1. */
async function generationOneScan(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const img = await doc.embedJpg(PHOTO);
    doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  }
  return Buffer.from(await withGenerationOneCatalog(await doc.save({ useObjectStreams: false })));
}

async function customTarget(page: Page, kb: number) {
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom target size").fill(String(kb));
  await page.getByRole("radio", { name: "KB", exact: true }).click();
}

const pdfFile = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });

test.describe("output integrity", () => {
  test.setTimeout(120_000);

  test("A: an incrementally-updated scan compressed under its target is a valid, openable PDF", async ({ page }) => {
    const errors = trackPageErrors(page);
    const input = await generationOneScan();
    expect(await verifyPdfBytes(input, { pages: 2 })).toEqual([]);
    await page.goto("/compress-pdf");
    await addFiles(page, pdfFile("scan.pdf", input));
    const targetKb = Math.floor((input.length / 1000) * 0.5);
    await customTarget(page, targetKb);
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await expect(page.getByTestId("result").getByRole("status")).toContainText("Done", { timeout: 60_000 });
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
    expect(bytes.length).toBeLessThanOrEqual(targetKb * 1000);
    expect(await verifyPdfBytes(new Uint8Array(bytes), { pages: 2 })).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("C: merge, split and organize outputs from the same file pass the strict check", async ({ page }) => {
    const input = await generationOneScan();
    await page.goto("/merge-pdf");
    await addFiles(page, pdfFile("a.pdf", input));
    await addFiles(page, pdfFile("b.pdf", input));
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    let { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download merged PDF" }));
    expect(await verifyPdfBytes(new Uint8Array(bytes), { pages: 4 })).toEqual([]);

    await page.goto("/split-pdf");
    await addFiles(page, pdfFile("scan.pdf", input));
    await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
    await page.getByRole("button", { name: "Extract 1 page" }).click();
    ({ bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" })));
    expect(await verifyPdfBytes(new Uint8Array(bytes), { pages: 1 })).toEqual([]);

    await page.goto("/organize-pdf");
    await addFiles(page, pdfFile("scan.pdf", input));
    await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click();
    await page.getByRole("button", { name: "Save PDF" }).click();
    ({ bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" })));
    expect(await verifyPdfBytes(new Uint8Array(bytes), { pages: 2 })).toEqual([]);
    expect((await PDFDocument.load(bytes)).getPage(0).getRotation().angle).toBe(90);
  });

  test("D: an editor export of the same file is valid", async ({ page }) => {
    await page.goto("/pdf-editor");
    await addFiles(page, pdfFile("scan.pdf", await generationOneScan()));
    await page.getByTestId("page-surface").first().waitFor();
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    const box = (await page.getByTestId("page-surface").first().boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.keyboard.type("Checked");
    await page.keyboard.press("Escape");
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /Export PDF/i }));
    expect(await verifyPdfBytes(new Uint8Array(bytes), { pages: 2 })).toEqual([]);
  });

  test("encrypted PDFs are refused with a clear reason instead of producing a broken file", async ({ page }) => {
    await page.goto("/compress-pdf");
    await addFiles(page, [fx("encrypted-owner-only.pdf")]);
    await expect(page.getByText("protected with a password or encryption")).toBeVisible({ timeout: 20_000 });

    await page.goto("/merge-pdf");
    await addFiles(page, [fx("multi-page.pdf"), fx("encrypted-owner-only.pdf")]);
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await expect(page.getByText("protected with a password or encryption")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("result")).toHaveCount(0);
  });

  test("E: an image that can't be decoded is reported, never converted into an empty file", async ({ page }) => {
    const errors = trackPageErrors(page);
    const broken = { name: "broken.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(fx("qa", "img-photo-large.jpg")).subarray(0, 3000) };
    await page.goto("/convert-image");
    await addFiles(page, broken);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByText(/couldn.t|can.t|damaged/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(0);

    await page.goto("/compress-image");
    await addFiles(page, broken);
    const compress = page.getByRole("button", { name: /^Compress to under/ });
    if (await compress.isVisible().catch(() => false)) await compress.click();
    await expect(page.getByText(/couldn.t|can.t|damaged/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Download/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("E: a JPEG cut off halfway (decodes grey in browsers) is refused by Image to PDF and the converter", async ({ page }) => {
    const full = fs.readFileSync(fx("qa", "img-landscape.jpg"));
    const half = { name: "half.jpg", mimeType: "image/jpeg", buffer: full.subarray(0, Math.floor(full.length / 2)) };
    await page.goto("/image-to-pdf");
    await addFiles(page, half);
    await page.getByRole("button", { name: /^Create PDF/ }).click();
    await expect(page.getByText("“half.jpg” couldn't be read")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

    await page.goto("/convert-image");
    await addFiles(page, half);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await expect(page.getByText(/couldn.t read this image/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(0);
  });
});
