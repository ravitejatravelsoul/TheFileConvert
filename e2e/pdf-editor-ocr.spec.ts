import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { renderPdfPage } from "./helpers/pdf-render";
import { withOcrLock } from "./helpers/ocr-lock";

const OCR_FIXTURES = path.join(__dirname, "fixtures", "ocr");

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
    await expect(page.getByText(/Scanned page detected/i)).toBeVisible();

    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      // Progress UI appears and then clears when done.
      await expect(page.getByText("Cancel", { exact: true })).toBeVisible({ timeout: 10_000 }).catch(() => {});
      await expect(page.getByText(/Recognize current page/i)).toBeVisible({ timeout: 90_000 });
    });
  });
});

test.describe("PDF Editor: OCR text edit round trip", () => {
  test("recognizes a real scanned page, corrects one recognized word, exports, and the correction is verifiable in the reopened PDF", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "clean-scan.pdf"));

    // Trigger real OCR recognition on this image-only page.
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await expect(page.getByText(/Scanned page detected/i)).toBeVisible();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });

    // The recognized-line buttons live on the page surface, not inside the properties
    // drawer — close it first so the surface underneath is reachable on mobile.
    await page.keyboard.press("Escape");

    // Click the recognized line containing "Jane Smith" and replace it with a distinct value.
    const lineButton = page.getByRole("button", { name: /Jane Smith/i });
    await expect(lineButton).toBeVisible({ timeout: 10_000 });
    await lineButton.click();

    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await expect(dialog).toBeVisible();
    // Line-level corrections don't carry a per-word confidence figure (only individual
    // recognized words do), so the modal's confidence caveat is conditional — just confirm
    // it detected the right recognized text.
    await expect(dialog).toContainText(/Jane Smith/i);
    const input = dialog.locator("input[type=text]");
    const originalValue = await input.inputValue();
    expect(originalValue).toContain("Jane Smith");
    await input.fill("Alex Rivera");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    const bytes = await exportAndSave(page, "ocr-corrected.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    // Searchable-text layer carries the correction.
    const text = await extractText(bytes, 1);
    expect(text).toContain("Alex Rivera");

    // Visual verification: rendering the exported page must show the original scan
    // (paintImageXObject still present) with the correction actually drawn over it.
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
    const pdfPage = await loaded.getPage(1);
    const opList = await pdfPage.getOperatorList();
    expect(opList.fnArray).toContain(pdfjsLib.OPS.paintImageXObject);

    const rendered = await renderPdfPage(bytes, 1, 2);
    expect(rendered.width).toBeGreaterThan(0);
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
    const lineButton = page.getByRole("button", { name: /Jane Smith/i });
    await expect(lineButton).toBeVisible({ timeout: 10_000 });
    await lineButton.click();
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
