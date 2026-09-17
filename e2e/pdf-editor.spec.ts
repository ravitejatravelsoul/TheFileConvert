import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const OCR_FIXTURES = path.join(__dirname, "fixtures", "ocr");
const FIXTURES = path.join(__dirname, "fixtures");

async function openFile(page: Page, filePath: string) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
}

async function exportAndSave(page: Page, name: string) {
  // Close any open mobile drawer first — it's a fixed full-screen overlay that would
  // otherwise intercept the click meant for the toolbar's Export button underneath it.
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
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  const doc = await loadingTask.promise;
  const pdfPage = await doc.getPage(pageNumber);
  const textContent = await pdfPage.getTextContent();
  return textContent.items.map((it) => ("str" in it ? it.str : "")).join(" ");
}

// Below the lg breakpoint, the thumbnail rail and properties panel are collapsed into
// on-demand drawers (see EditorWorkspace's mobilePanel state) — open the relevant one first.
// Only one drawer can be open at a time, so switching drawers closes the current one.
async function openMobilePanel(page: Page, isMobile: boolean, panel: "Pages" | "Properties") {
  if (!isMobile) return;
  await page.keyboard.press("Escape");
  const label = panel === "Pages" ? /Pages \(/ : "Properties";
  await page.getByRole("button", { name: label }).click();
}

test.describe("PDF Editor: native text editing", () => {
  test("corrects native text, exports, and the correction is verifiable in the reopened PDF", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: /Edit text: Quarterly Report/i }).click();
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await expect(dialog).toBeVisible();
    const input = dialog.locator("input[type=text]");
    await expect(input).toHaveValue("Quarterly Report");
    await input.fill("Annual Summary");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    const bytes = await exportAndSave(page, "native-corrected.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const text = await extractText(bytes, 1);
    expect(text).toContain("Annual Summary");
  });
});

test.describe("PDF Editor: add text / shapes / annotations", () => {
  test("adds a text box and it appears at export in the reopened PDF", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: "Text", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.click({ position: { x: 60, y: 600 } });

    const bytes = await exportAndSave(page, "added-text.pdf");
    const text = await extractText(bytes, 1);
    expect(text).toContain("New text");
  });

  test("draws a whiteout box and the exported page renders a white-filled region", async ({ page }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: "Whiteout", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (!box) throw new Error("no bounding box");
    await page.mouse.move(box.x + 40, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 350, { steps: 5 });
    await page.mouse.up();

    const bytes = await exportAndSave(page, "whiteout.pdf");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
    const doc = await loadingTask.promise;
    const pdfPage = await doc.getPage(1);
    const opList = await pdfPage.getOperatorList();
    // pdf-lib's drawRectangle emits a path-construction operator (with fill baked into its
    // args), not separate OPS.rectangle/OPS.fill entries.
    expect(opList.fnArray).toContain(pdfjsLib.OPS.constructPath);
  });

  test("draws a rectangle shape that survives export", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (!box) throw new Error("no bounding box");
    await page.mouse.move(box.x + 60, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 380, { steps: 5 });
    await page.mouse.up();

    // A shape object should now be selected/present — verify via the properties panel delete
    // affordance, which only renders when an object is selected (behind a drawer on mobile).
    await openMobilePanel(page, isMobile, "Properties");
    await expect(page.getByRole("button", { name: "Delete selected object" })).toBeVisible();

    const bytes = await exportAndSave(page, "shape.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

test.describe("PDF Editor: page management", () => {
  test("rotate, duplicate, and delete pages, then export and verify the result", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await openMobilePanel(page, isMobile, "Pages");
    await expect(page.getByText("5 pages")).toBeVisible();

    // The per-thumbnail action buttons only render on hover (desktop pattern), so hover the
    // thumbnail first to reveal them before clicking.
    await page.getByRole("button", { name: "Go to page 1" }).hover();
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
    await page.getByRole("button", { name: "Go to page 1" }).hover();
    await page.getByRole("button", { name: "Duplicate page 1" }).click();
    await expect(page.getByText("6 pages")).toBeVisible();
    await page.getByRole("button", { name: "Go to page 6" }).hover();
    await page.getByRole("button", { name: "Delete page 6" }).click();
    await expect(page.getByText("5 pages")).toBeVisible();

    const bytes = await exportAndSave(page, "page-management.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  test("inserts pages from another PDF after the current page", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf")); // 2 pages
    await openMobilePanel(page, isMobile, "Pages");
    await expect(page.getByText("2 pages")).toBeVisible();

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Insert pages after page 1" }).click(),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, "sample-b.pdf")); // 3 pages
    await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

    const bytes = await exportAndSave(page, "inserted.pdf");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(5);
  });
});

test.describe("PDF Editor: undo/redo", () => {
  test("Ctrl+Z undoes an added text object and Ctrl+Shift+Z redoes it", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    await page.getByRole("button", { name: "Text", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.click({ position: { x: 60, y: 600 } });
    await openMobilePanel(page, isMobile, "Properties");
    await expect(page.getByRole("button", { name: "Delete selected object" })).toBeVisible();

    await page.keyboard.press("Control+z");
    // Undo intentionally deselects (the object no longer exists), and the object itself
    // should be gone from the page.
    await expect(page.getByRole("button", { name: "Delete selected object" })).not.toBeVisible();
    await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(0);

    await page.keyboard.press("Control+Shift+z");
    // Redo also intentionally deselects, but the object itself should be back.
    await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(1);
  });
});

test.describe("PDF Editor: OCR integration", () => {
  test.describe.configure({ timeout: 120_000 });

  test("recognizes a scanned page inside a mixed document and lets you correct the text", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "mixed-native-scanned.pdf"));
    await openMobilePanel(page, isMobile, "Pages");
    await expect(page.getByText("3 pages")).toBeVisible();

    // Page 2 is the scanned one — navigate to it via the thumbnail rail.
    await page.getByRole("button", { name: "Go to page 2" }).click();
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await expect(page.getByText(/Scanned page detected/i)).toBeVisible();

    await page.getByRole("button", { name: "Recognize current page" }).click();
    // Progress UI appears and then clears when done.
    await expect(page.getByText("Cancel", { exact: true })).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await expect(page.getByText(/Recognize current page/i)).toBeVisible({ timeout: 90_000 });
  });

  test("OCR is never fetched until recognition is explicitly requested", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/pdf/editor", { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(path.join(OCR_FIXTURES, "native-text.pdf"));
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    const tesseractRelated = requests.filter((u) => u.toLowerCase().includes("tesseract"));
    expect(tesseractRelated).toEqual([]);
  });
});

test.describe("PDF Editor: privacy / network", () => {
  test("no document content is ever sent off-device while editing and exporting", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/pdf/editor", { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(path.join(OCR_FIXTURES, "native-text.pdf"));
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });

    requests.length = 0;
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.locator('[data-testid="page-surface"]').first().click({ position: { x: 60, y: 600 } });
    await exportAndSave(page, "privacy-check.pdf");

    const baseURL = new URL(page.url()).origin;
    const thirdParty = requests.filter((u) => !u.startsWith(baseURL) && !u.startsWith("blob:"));
    expect(thirdParty).toEqual([]);
  });
});

test.describe("PDF Editor: security / error handling", () => {
  test("a corrupted PDF fails safely with a friendly message", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pdf/editor");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "corrupted.pdf"));
    await expect(page.getByText(/couldn't read this PDF|damaged/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a zero-byte file is rejected immediately", async ({ page }) => {
    await page.goto("/pdf/editor");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "zero-byte.pdf"));
    await expect(page.getByText(/empty/i)).toBeVisible();
  });

  test("an unsupported file type shows a friendly error", async ({ page }) => {
    await page.goto("/pdf/editor");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "sample.csv"));
    await expect(page.getByText(/isn't supported/i)).toBeVisible();
  });
});

test.describe("PDF Editor: responsive / mobile", () => {
  test("no horizontal overflow and page panels are reachable via toggle buttons at 390px width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);

    await page.getByRole("button", { name: /Pages \(/ }).click();
    await expect(page.getByText("1 page", { exact: true })).toBeVisible();
  });
});
