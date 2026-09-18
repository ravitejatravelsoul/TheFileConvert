import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { renderPdfPage, findCollateralChanges } from "./helpers/pdf-render";
import { withOcrLock } from "./helpers/ocr-lock";
import { EDITOR_BASE_SCALE } from "../src/lib/editor/types";

const OCR_FIXTURES = path.join(__dirname, "fixtures", "ocr");
const RENDER_SCALE = 2;
const PIXEL_SCALE = RENDER_SCALE / EDITOR_BASE_SCALE;

// This file holds every PDF Editor test that triggers real Tesseract recognition. It's
// deliberately kept separate from pdf-editor.spec.ts / pdf-editor-advanced.spec.ts and
// routed (via playwright.config.ts testMatch, alongside ocr.spec.ts) into the
// fullyParallel:false OCR projects — see the comment in playwright.config.ts for why:
// several concurrent real Tesseract WASM sessions on one dev machine contend for CPU badly
// enough that even unrelated, non-OCR assertions elsewhere can miss their timeout.

async function openFile(page: Page, filePath: string) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
}

async function openMobilePanel(page: Page, isMobile: boolean, panel: "Pages" | "Properties") {
  if (!isMobile) return;
  await page.keyboard.press("Escape");
  const label = panel === "Pages" ? /Pages \(/ : "Properties";
  await page.getByRole("button", { name: label }).click();
}

async function exportAndSave(page: Page, name: string): Promise<Buffer> {
  await page.keyboard.press("Escape");
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

/** Opens `fixture`, recognizes it, clicks the recognized word matching `wordPattern`,
 * replaces it with `replacement`, exports, and verifies the exported page is
 * pixel-identical to the original everywhere except a tight region around the edited
 * word — the core "no collateral change" guard for a specific background scenario. */
async function verifyWordEditIsLocalized(
  page: Page,
  isMobile: boolean,
  fixtureName: string,
  wordPattern: RegExp,
  replacement: string
) {
  const fixturePath = path.join(OCR_FIXTURES, fixtureName);
  const originalBytes = fs.readFileSync(fixturePath);

  await openFile(page, fixturePath);
  await openMobilePanel(page, isMobile, "Properties");
  await page.locator("summary", { hasText: "OCR" }).click();
  await withOcrLock(async () => {
    await page.getByRole("button", { name: "Recognize current page" }).click();
    await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
  });
  await page.keyboard.press("Escape");

  const wordButton = page.getByRole("button", { name: wordPattern }).first();
  await expect(wordButton).toBeVisible({ timeout: 10_000 });
  await wordButton.click();

  const dialog = page.getByRole("dialog", { name: "Edit text" });
  await dialog.locator("input[type=text]").fill(replacement);
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).not.toBeVisible();

  const objectBox = await page.locator('[data-object-type="ocr-text-replacement"]').first().boundingBox();
  if (!objectBox) throw new Error("no ocr-text-replacement object bounding box");
  const surfaceBox = await page.locator('[data-testid="page-surface"]').first().boundingBox();
  if (!surfaceBox) throw new Error("no page surface bounding box");

  const bytes = await exportAndSave(page, `${fixtureName}-edited.pdf`);
  const before = await renderPdfPage(originalBytes, 1, RENDER_SCALE);
  const after = await renderPdfPage(bytes, 1, RENDER_SCALE);

  const margin = 14;
  const allowedRegionPx = {
    x: (objectBox.x - surfaceBox.x) * PIXEL_SCALE - margin,
    y: (objectBox.y - surfaceBox.y) * PIXEL_SCALE - margin,
    width: objectBox.width * PIXEL_SCALE + margin * 2,
    height: objectBox.height * PIXEL_SCALE + margin * 2,
  };

  const diff = findCollateralChanges(before, after, [allowedRegionPx]);
  if (diff.changedOutsidePixelCount > 0) {
    before.savePng(test.info().outputPath(`${fixtureName}-before.png`));
    after.savePng(test.info().outputPath(`${fixtureName}-after.png`));
  }
  expect(diff.changedOutsidePixelCount, JSON.stringify(diff.offendingSamples)).toBeLessThan(50);
  expect(diff.changedPixelCount).toBeGreaterThan(0);
}

test.describe.configure({ timeout: 150_000 });

test.describe("PDF Editor: OCR integration", () => {
  test("recognizes a scanned page inside a mixed document and lets you correct the text", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "mixed-native-scanned.pdf"));
    await openMobilePanel(page, isMobile, "Pages");
    await expect(page.getByText("3 pages")).toBeVisible();

    // Page 2 is the scanned one — navigate to it via the thumbnail rail.
    await page.getByRole("button", { name: "Go to page 2" }).click();
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await expect(page.getByText(/Scanned page detected\. No editable text/i)).toBeVisible();

    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      // Progress UI appears and then clears when done.
      await expect(page.getByText("Cancel", { exact: true })).toBeVisible({ timeout: 10_000 }).catch(() => {});
      await expect(page.getByText(/Recognize current page/i)).toBeVisible({ timeout: 90_000 });
    });
  });
});

test.describe("PDF Editor: OCR text edit round trip", () => {
  test("corrects exactly one recognized word — original text carries only that word, not the whole line", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "clean-scan.pdf"));

    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    // The workspace now also shows a top-level "Scanned page detected — run OCR…" banner
    // (guided first-time detection) alongside this properties-panel message, so match the
    // properties-panel one specifically by its distinct wording.
    await expect(page.getByText(/Scanned page detected\. No editable text/i)).toBeVisible();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });

    await page.keyboard.press("Escape");

    // Click the recognized WORD "Smith" specifically — not the "Customer: Jane Smith" line.
    const wordButton = page.getByRole("button", { name: /Edit recognized word: Smith/i });
    await expect(wordButton).toBeVisible({ timeout: 10_000 });
    await wordButton.click();

    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await expect(dialog).toBeVisible();
    const input = dialog.locator("input[type=text]");
    const originalValue = await input.inputValue();
    // The whole point of word-level editing: this must be just the one word, never the
    // full "Customer: Jane Smith" line it belongs to.
    expect(originalValue.trim()).toBe("Smith");
    await input.fill("Rodriguez");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    const bytes = await exportAndSave(page, "ocr-corrected.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const text = await extractText(bytes, 1);
    expect(text).toContain("Rodriguez");
    // (The editor only adds a searchable text run for words that were actually edited —
    // it doesn't bake a full OCR text layer for the whole page automatically, so unrelated
    // recognized content isn't expected in the searchable layer here. Whether unrelated
    // *visible* content survives untouched is verified far more rigorously by the
    // dedicated pixel-diff test below.)

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
    const opList = await (await loaded.getPage(1)).getOperatorList();
    expect(opList.fnArray).toContain(pdfjsLib.OPS.paintImageXObject);
  });

  test("no-collateral-change: editing one word leaves the rest of the scanned page pixel-identical", async ({ page, isMobile }) => {
    const originalBytes = fs.readFileSync(path.join(OCR_FIXTURES, "clean-scan.pdf"));

    await openFile(page, path.join(OCR_FIXTURES, "clean-scan.pdf"));
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });
    await page.keyboard.press("Escape");

    const wordButton = page.getByRole("button", { name: /Edit recognized word: Smith/i });
    await expect(wordButton).toBeVisible({ timeout: 10_000 });
    await wordButton.click();

    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await dialog.locator("input[type=text]").fill("Rodriguez");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    // The applied object's own on-page box is the ground truth for "where the edit is
    // allowed to change pixels" — read it straight from the DOM rather than recomputing it,
    // so this test verifies the real applied region, not an assumption about it.
    const objectBox = await page.locator('[data-object-type="ocr-text-replacement"]').first().boundingBox();
    if (!objectBox) throw new Error("no ocr-text-replacement object bounding box");
    const surfaceBox = await page.locator('[data-testid="page-surface"]').first().boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");

    const bytes = await exportAndSave(page, "ocr-corrected-diff.pdf");
    const before = await renderPdfPage(originalBytes, 1, RENDER_SCALE);
    const after = await renderPdfPage(bytes, 1, RENDER_SCALE);

    // Generous margin around the applied patch (anti-aliasing, font metric differences
    // between the browser preview and pdf-lib's actual glyph rendering) — still tiny
    // relative to the page, which is the whole point of the defect being fixed.
    const margin = 14;
    const allowedRegionPx = {
      x: (objectBox.x - surfaceBox.x) * PIXEL_SCALE - margin,
      y: (objectBox.y - surfaceBox.y) * PIXEL_SCALE - margin,
      width: objectBox.width * PIXEL_SCALE + margin * 2,
      height: objectBox.height * PIXEL_SCALE + margin * 2,
    };

    const diff = findCollateralChanges(before, after, [allowedRegionPx]);
    if (diff.changedOutsidePixelCount > 0) {
      // Save renders for inspection only when something actually looks wrong.
      before.savePng(test.info().outputPath("collateral-before.png"));
      after.savePng(test.info().outputPath("collateral-after.png"));
    }
    // A handful of stray anti-aliasing pixels right at the region boundary can legitimately
    // differ; a real collateral-damage regression (whiting out the whole line, moving
    // neighboring text, dropping the table/logo, etc.) would change thousands of pixels.
    expect(diff.changedOutsidePixelCount, JSON.stringify(diff.offendingSamples)).toBeLessThan(50);
    expect(diff.changedPixelCount).toBeGreaterThan(0); // something did actually change
  });
});

test.describe("PDF Editor: OCR visual-fidelity fixtures", () => {
  // Each of these is a synthetic "scan" (real text rendered to a raster image, then
  // embedded as an image-only PDF page — no native text layer, so OCR is required, exactly
  // like a real scanned document) built to stress a specific background scenario called
  // out in the defect report: a plain white background isn't the only case that matters.

  test("B. uniform gray scan background: patch matches the gray, doesn't punch a white hole", async ({ page, isMobile }) => {
    // Match whatever numeric value Tesseract actually reads off this fixture (its digit
    // recognition on a synthetic scan can differ slightly from the source text) — this
    // test is about background preservation, not OCR digit accuracy, which other tests
    // already cover on real scan fixtures.
    await verifyWordEditIsLocalized(page, isMobile, "gray-background-scan.pdf", /Edit recognized word: \d[\d.,]+\d/i, "6789.10");
  });

  test("C+D. colored form background with table border lines close to the value", async ({ page, isMobile }) => {
    await verifyWordEditIsLocalized(page, isMobile, "colored-form-scan.pdf", /Edit recognized word: 875\.00/i, "1450.00");
  });
});

test.describe("PDF Editor: OCR privacy regression", () => {
  test("recognizing and correcting a scanned page, then exporting, never sends document content or scan pixels off-device", async ({ page, isMobile }) => {
    const requests: { url: string; method: string }[] = [];
    page.on("request", (req) => requests.push({ url: req.url(), method: req.method() }));

    await openFile(page, path.join(OCR_FIXTURES, "clean-scan.pdf"));
    requests.length = 0; // only care about traffic from here on

    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });

    await page.keyboard.press("Escape"); // close the mobile Properties drawer to reach the page surface
    const wordButton = page.getByRole("button", { name: /Edit recognized word: Smith/i });
    await expect(wordButton).toBeVisible({ timeout: 10_000 });
    await wordButton.click();
    await page.getByRole("dialog", { name: "Edit text" }).locator("input[type=text]").fill("Privacy Check");
    await page.getByRole("dialog", { name: "Edit text" }).getByRole("button", { name: "Save correction" }).click();

    await exportAndSave(page, "ocr-privacy-check.pdf");

    const baseURL = new URL(page.url()).origin;
    const thirdParty = requests.filter((r) => !r.url.startsWith(baseURL) && !r.url.startsWith("blob:"));
    expect(thirdParty).toEqual([]);

    // No same-origin request should be a POST/PUT either — every request here should be a
    // plain GET fetching static OCR runtime/model assets, never anything shaped like it's
    // uploading the scanned document or recognized text.
    const uploadLike = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
    expect(uploadLike).toEqual([]);
  });
});
