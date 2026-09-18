import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { renderPdfPage, isBlank } from "./helpers/pdf-render";
import { EDITOR_BASE_SCALE } from "../src/lib/editor/types";

const OCR_FIXTURES = path.join(__dirname, "fixtures", "ocr");
const FIXTURES = path.join(__dirname, "fixtures");

// Our verification renders (via renderPdfPage) use RENDER_SCALE px/pt. The editor's own
// on-screen DOM elements are positioned at EDITOR_BASE_SCALE px/pt (at 100% zoom). Both are
// independent linear scalings of the same underlying PDF-point space, so converting a DOM
// pixel offset to a render pixel offset means going through points: DOM px / EDITOR_BASE_SCALE
// -> PDF pt -> * RENDER_SCALE -> render px. A flat "double it" conversion is only correct by
// coincidence if the two scales happen to have a 2:1 ratio, which they don't (1.3 vs 2).
const RENDER_SCALE = 2;
const PIXEL_SCALE = RENDER_SCALE / EDITOR_BASE_SCALE;

async function openFile(page: Page, filePath: string) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
}

// Below the lg breakpoint, the properties panel (drawing options, form fields, crop,
// watermark/header-footer, etc.) is collapsed into an on-demand drawer — open it first.
async function openPropertiesPanel(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Properties" }).click();
}

async function exportAndSave(page: Page, name: string): Promise<Buffer> {
  await page.keyboard.press("Escape"); // close any open mobile drawer first
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export PDF/i }).click(),
  ]);
  const outPath = test.info().outputPath(name);
  await download.saveAs(outPath);
  return fs.readFileSync(outPath);
}

async function extractText(bytes: Buffer, pageNumber: number): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const pdfPage = await doc.getPage(pageNumber);
  const textContent = await pdfPage.getTextContent();
  return textContent.items.map((it) => ("str" in it ? it.str : "")).join(" ");
}

// ==================================================================================
// The OCR text edit round trip (real Tesseract recognition -> correct -> export ->
// reopen/verify) lives in pdf-editor-ocr.spec.ts, alongside every other test in the suite
// that triggers real recognition — see the comment in playwright.config.ts for why those
// are kept in their own fullyParallel:false projects.
// ==================================================================================
// 2. Signature: draw, place, resize, export, reopen/render, verify at intended location
// ==================================================================================

test.describe("PDF Editor: signature", () => {
  test("draws a signature, places and resizes it, and it renders at the intended location after export", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: "Sign", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add signature" });
    await expect(dialog).toBeVisible();

    const sigCanvas = dialog.getByRole("img", { name: "Signature drawing area" });
    const box = await sigCanvas.boundingBox();
    if (!box) throw new Error("no signature canvas bounding box");
    // Draw a broad zigzag covering most of the pad so the placed image has ink near its
    // center, not just a thin diagonal that might miss a single sample point.
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
    await page.mouse.move(box.x + 10, box.y + box.height - 10, { steps: 8 });
    await page.mouse.move(box.x + box.width - 10, box.y + 10, { steps: 8 });
    await page.mouse.up();

    await dialog.getByRole("button", { name: "Place signature" }).click();
    await expect(dialog).not.toBeVisible();

    // Place it on the lower half of the page (well clear of the page's own text).
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");
    const placeX = surfaceBox.x + 150;
    const placeY = surfaceBox.y + 250;
    await page.mouse.click(placeX, placeY);

    const sigObject = page.locator('[data-object-type="signature"]').first();
    await expect(sigObject).toBeVisible();

    // Resize: drag the bottom-right handle outward to grow the placed signature. The
    // resize handles are rendered right at the object's corners when selected, so a drag
    // starting at the bottom-right corner point hits the "se" handle.
    const beforeResizeBox = await sigObject.boundingBox();
    if (!beforeResizeBox) throw new Error("no signature object bounding box");
    const handleX = beforeResizeBox.x + beforeResizeBox.width;
    const handleY = beforeResizeBox.y + beforeResizeBox.height;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 40, handleY + 30, { steps: 5 });
    await page.mouse.up();

    const afterResizeBox = await sigObject.boundingBox();
    if (!afterResizeBox) throw new Error("no signature object bounding box after resize");
    expect(afterResizeBox.width).toBeGreaterThan(beforeResizeBox.width - 1);

    const bytes = await exportAndSave(page, "signature.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
    const opList = await (await loaded.getPage(1)).getOperatorList();
    expect(opList.fnArray).toContain(pdfjsLib.OPS.paintImageXObject);

    // Render and check ink near where we placed+resized it, and blankness far away from it.
    // Recompute the surface's own position fresh here rather than reusing the box captured
    // before the resize drag — a drag near a scrollable container's edge can trigger the
    // browser to auto-scroll (more likely on a narrow mobile viewport), which would make an
    // earlier boundingBox() stale relative to afterResizeBox's now-current coordinates.
    const finalSurfaceBox = await surface.boundingBox();
    if (!finalSurfaceBox) throw new Error("no page surface bounding box after resize");
    const rendered = await renderPdfPage(bytes, 1, RENDER_SCALE);
    const centerX = Math.round((((afterResizeBox.x - finalSurfaceBox.x) + (afterResizeBox.x + afterResizeBox.width - finalSurfaceBox.x)) / 2) * PIXEL_SCALE);
    const centerY = Math.round((((afterResizeBox.y - finalSurfaceBox.y) + (afterResizeBox.y + afterResizeBox.height - finalSurfaceBox.y)) / 2) * PIXEL_SCALE);
    const inkPixel = rendered.getPixel(centerX, centerY);
    const farPixel = rendered.getPixel(20, 20); // top-left corner, far from the placement
    expect(isBlank(inkPixel)).toBe(false);
    expect(isBlank(farPixel)).toBe(true);
  });
});

// ==================================================================================
// 3. Image placement: real PNG fixture, place, resize, export, verify aspect ratio
// ==================================================================================

test.describe("PDF Editor: image placement", () => {
  test("inserts a real PNG image, preserves aspect ratio, and it renders at the placed location", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Image", exact: true }).click(),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, "image-2x1.png")); // 300x150 solid teal, 2:1 aspect ratio

    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");
    const placeX = surfaceBox.x + 150;
    const placeY = surfaceBox.y + 400;
    await page.mouse.click(placeX, placeY);

    const imageObject = page.locator('[data-object-type="image"]').first();
    await expect(imageObject).toBeVisible();
    const placedBox = await imageObject.boundingBox();
    if (!placedBox) throw new Error("no image object bounding box");
    expect(placedBox.width / placedBox.height).toBeCloseTo(2, 1); // source is 300x150 = 2:1

    const bytes = await exportAndSave(page, "image-placed.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const rendered = await renderPdfPage(bytes, 1, RENDER_SCALE);
    const centerX = Math.round((((placedBox.x - surfaceBox.x) + (placedBox.x + placedBox.width - surfaceBox.x)) / 2) * PIXEL_SCALE);
    const centerY = Math.round((((placedBox.y - surfaceBox.y) + (placedBox.y + placedBox.height - surfaceBox.y)) / 2) * PIXEL_SCALE);
    const pixel = rendered.getPixel(centerX, centerY);
    // Solid teal fixture: rgb(20, 160, 170).
    expect(pixel[0]).toBeLessThan(80);
    expect(pixel[1]).toBeGreaterThan(100);
    expect(pixel[2]).toBeGreaterThan(100);

    const farPixel = rendered.getPixel(20, 20);
    expect(isBlank(farPixel)).toBe(true);
  });
});

// ==================================================================================
// 4. Highlight / underline / strikethrough — independent, concrete visual assertions
// ==================================================================================

async function dragAnnotationRect(page: Page, tool: "Highlight" | "Underline" | "Strike") {
  await page.getByRole("button", { name: tool, exact: true }).click();
  const surface = page.locator('[data-testid="page-surface"]').first();
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error("no page surface bounding box");
  const x0 = box.x + 60;
  const y0 = box.y + 400;
  const x1 = box.x + 300;
  const y1 = box.y + 440;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
  return { box, x0: x0 - box.x, y0: y0 - box.y, x1: x1 - box.x, y1: y1 - box.y };
}

test.describe("PDF Editor: annotations", () => {
  test("highlight fills the selected region with a translucent color", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));
    // Pick a bright, unmistakable color before drawing.
    await openPropertiesPanel(page, isMobile);
    await page.getByRole("button", { name: "Yellow", exact: true }).click();
    await page.keyboard.press("Escape"); // close the mobile drawer so the page surface is reachable
    const rect = await dragAnnotationRect(page, "Highlight");

    const bytes = await exportAndSave(page, "highlight.pdf");
    const rendered = await renderPdfPage(bytes, 1, RENDER_SCALE);
    const midX = Math.round(((rect.x0 + rect.x1) / 2) * PIXEL_SCALE);
    const midY = Math.round(((rect.y0 + rect.y1) / 2) * PIXEL_SCALE);
    const pixel = rendered.getPixel(midX, midY);
    // A yellow highlight at ~35% opacity over white should read as high R/G, lower B, and
    // clearly not pure white.
    expect(isBlank(pixel, 3)).toBe(false);
    expect(pixel[2]).toBeLessThan(pixel[0]); // less blue than red — a yellow-ish tint
  });

  test("underline draws a thin line at the bottom of the region, not a fill", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));
    const rect = await dragAnnotationRect(page, "Underline");

    const bytes = await exportAndSave(page, "underline.pdf");
    const rendered = await renderPdfPage(bytes, 1, RENDER_SCALE);
    // Underline is drawn at the object's own y (bottom edge in PDF space == bottom of the
    // screen rect, i.e. the larger of y0/y1 in viewport coordinates since y grows downward).
    const bottomY = Math.round(Math.max(rect.y0, rect.y1) * PIXEL_SCALE) - 1;
    const midY = Math.round(((rect.y0 + rect.y1) / 2) * PIXEL_SCALE);
    const midX = Math.round(((rect.x0 + rect.x1) / 2) * PIXEL_SCALE);
    const linePixel = rendered.getPixel(midX, bottomY);
    const middlePixel = rendered.getPixel(midX, midY);
    expect(isBlank(linePixel)).toBe(false); // ink at the underline
    expect(isBlank(middlePixel)).toBe(true); // no fill in the middle of the region
  });

  test("strikethrough draws a thin line through the middle of the region", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));
    const rect = await dragAnnotationRect(page, "Strike");

    const bytes = await exportAndSave(page, "strikethrough.pdf");
    const rendered = await renderPdfPage(bytes, 1, RENDER_SCALE);
    const midX = Math.round(((rect.x0 + rect.x1) / 2) * PIXEL_SCALE);
    const midY = Math.round(((rect.y0 + rect.y1) / 2) * PIXEL_SCALE);
    const topY = Math.round(Math.min(rect.y0, rect.y1) * PIXEL_SCALE) + 2;
    const midPixel = rendered.getPixel(midX, midY);
    const topPixel = rendered.getPixel(midX, topY);
    expect(isBlank(midPixel)).toBe(false); // ink through the middle
    expect(isBlank(topPixel)).toBe(true); // no ink near the top edge
  });
});

// ==================================================================================
// 5. AcroForm fill: text field, checkbox, radio group — open, edit, export, verify
// ==================================================================================

test.describe("PDF Editor: form fill", () => {
  test("detects AcroForm fields, edits them, and the values persist in the exported PDF", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "acroform.pdf"));
    await openPropertiesPanel(page, isMobile);

    const formSection = page.locator("summary", { hasText: "Form fields" });
    await expect(formSection).toBeVisible();
    await formSection.click();

    await page.locator("#field-full_name").fill("Ada Lovelace");
    await page.locator("#field-subscribe").check();
    await page.locator("#field-plan").fill("pro");

    const bytes = await exportAndSave(page, "form-filled.pdf");
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();

    expect(form.getTextField("full_name").getText()).toBe("Ada Lovelace");
    expect(form.getCheckBox("subscribe").isChecked()).toBe(true);
    expect(form.getRadioGroup("plan").getSelected()).toBe("pro");
  });
});

// ==================================================================================
// 6. Crop: apply, export, verify page box/dimensions
// ==================================================================================

test.describe("PDF Editor: crop", () => {
  test("applies a crop box to the current page and it's reflected in the exported PDF's page box", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "multi-page.pdf")); // 5 pages, 400x500pt each

    await page.getByRole("button", { name: "Crop", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (!box) throw new Error("no page surface bounding box");

    await page.mouse.move(box.x + 50, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 400, { steps: 5 });
    await page.mouse.up();

    await openPropertiesPanel(page, isMobile);
    await page.locator("summary", { hasText: "Crop" }).click();
    await expect(page.getByText(/Crop area selected/i)).toBeVisible();
    await page.getByRole("button", { name: "Apply crop" }).click();

    const bytes = await exportAndSave(page, "cropped.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(5);

    const croppedPage = doc.getPage(0);
    const cropBox = croppedPage.getCropBox();
    const mediaBox = croppedPage.getMediaBox();
    // The crop box must be strictly smaller than the full media box (a real crop happened)
    // and must sit within it.
    expect(cropBox.width).toBeLessThan(mediaBox.width);
    expect(cropBox.height).toBeLessThan(mediaBox.height);
    expect(cropBox.x).toBeGreaterThanOrEqual(mediaBox.x - 0.01);
    expect(cropBox.y).toBeGreaterThanOrEqual(mediaBox.y - 0.01);

    // Untouched pages keep their full-size box.
    const untouchedPage = doc.getPage(2);
    const untouchedCrop = untouchedPage.getCropBox();
    expect(untouchedCrop.width).toBeCloseTo(untouchedPage.getMediaBox().width, 1);
  });
});

// ==================================================================================
// 7. Header/Footer: apply, export, verify text on intended pages
// ==================================================================================

test.describe("PDF Editor: header/footer", () => {
  test("stamps header/footer text with a page-number token onto every page", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "multi-page.pdf")); // 5 pages

    await openPropertiesPanel(page, isMobile);
    await page.locator("summary", { hasText: "Watermark, page numbers" }).click();
    await page.getByPlaceholder(/Header\/footer text/i).fill("Confidential — page {page}");
    await page.getByRole("button", { name: "Add header/footer" }).click();

    // bakeThenReload re-opens the document — wait for the workspace to be ready again.
    // (Final page count is verified below via the exported PDF itself, which is
    // authoritative regardless of which mobile drawer happens to be open afterward.)
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });

    const bytes = await exportAndSave(page, "header-footer.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(5);

    const page1Text = await extractText(bytes, 1);
    const page3Text = await extractText(bytes, 3);
    expect(page1Text).toContain("Confidential — page 1");
    expect(page3Text).toContain("Confidential — page 3");
  });
});
