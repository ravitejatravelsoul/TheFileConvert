import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { withOcrLock } from "./helpers/ocr-lock";

const OCR_FIXTURES = path.join(__dirname, "fixtures", "ocr");
const FIXTURES = path.join(__dirname, "fixtures");

async function openFile(page: Page, filePath: string) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Actual size (100%)" }).click(); // these tests assume 100% (a phone opens fit to width)
}

async function openMobilePanel(page: Page, isMobile: boolean, panel: "Pages" | "Properties") {
  if (!isMobile) return;
  await page.keyboard.press("Escape");
  const label = panel === "Pages" ? /Pages \(/ : "Properties";
  await page.getByRole("button", { name: label }).click();
}

// ==================================================================================
// Large document smoke test
// ==================================================================================

test.describe("PDF Editor: large document smoke test", () => {
  test("handles a 25-page document: thumbnails, navigation, zoom, an annotation, and export", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "large-document.pdf"));
    await openMobilePanel(page, isMobile, "Pages");
    await expect(page.getByText("25 pages")).toBeVisible();

    // Thumbnail rail renders and lets us navigate without crashing/hanging.
    await page.getByRole("button", { name: "Go to page 1", exact: true }).hover();
    await expect(page.getByRole("button", { name: "Go to page 20" })).toBeVisible();
    await page.getByRole("button", { name: "Go to page 20" }).click();
    await page.keyboard.press("Escape"); // close the mobile Pages drawer to reach the toolbar

    // Zoom controls function on a page deep in a long document.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("130%")).toBeVisible();
    await page.getByRole("button", { name: "Fit width" }).click();

    // A basic annotation still works this deep into the document.
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (!box) throw new Error("no page surface bounding box");
    await page.mouse.move(box.x + 40, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 260, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('[data-object-type="shape"]').first()).toBeVisible();

    // Export a 25-page document completes without hanging or erroring.
    await page.keyboard.press("Escape");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("button", { name: /Export PDF/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBeTruthy();
  });
});

// ==================================================================================
// Mobile editing checklist: add text, OCR trigger, edit recognized text, signature,
// page action, export — one consolidated flow, no desktop-only assumptions.
// ==================================================================================

test.describe("PDF Editor: mobile editing checklist", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile-only checklist");
  test.describe.configure({ timeout: 90_000 });

  test("every core editing action works on a mobile viewport", async ({ page, isMobile }) => {
    await openFile(page, path.join(OCR_FIXTURES, "mixed-native-scanned.pdf"));

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);

    // 1. Add text.
    await page.getByRole("button", { name: "Text", exact: true }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.click({ position: { x: 40, y: 300 } });
    await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(1);

    // 2. Navigate to the scanned page and trigger OCR.
    await openMobilePanel(page, isMobile, "Pages");
    await page.getByRole("button", { name: "Go to page 2" }).click();
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });

    // 3. Edit recognized text — a single word, not the whole line.
    await page.keyboard.press("Escape");
    const wordButtons = page.getByRole("button", { name: /Edit recognized word/i });
    await expect(wordButtons.first()).toBeVisible({ timeout: 10_000 });
    await wordButtons.first().click();
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await expect(dialog).toBeVisible();
    await dialog.locator("input[type=text]").fill("Mobile correction");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    // 4. Signature.
    await page.getByRole("button", { name: "Sign", exact: true }).click();
    const sigDialog = page.getByRole("dialog", { name: "Add signature" });
    const sigCanvas = sigDialog.getByRole("img", { name: "Signature drawing area" });
    const sigBox = await sigCanvas.boundingBox();
    if (!sigBox) throw new Error("no signature canvas bounding box");
    await page.mouse.move(sigBox.x + 10, sigBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(sigBox.x + sigBox.width - 10, sigBox.y + sigBox.height - 10, { steps: 5 });
    await page.mouse.up();
    await sigDialog.getByRole("button", { name: "Place signature" }).click();
    await surface.scrollIntoViewIfNeeded();
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");
    await page.mouse.click(surfaceBox.x + 60, surfaceBox.y + 300);
    await expect(page.locator('[data-object-type="signature"]').first()).toBeVisible();

    // 5. A page action (rotate) via the thumbnail rail.
    await openMobilePanel(page, isMobile, "Pages");
    await page.getByRole("button", { name: "Go to page 1" }).hover();
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();

    // 6. Export.
    await page.keyboard.press("Escape"); // close the mobile Pages drawer to reach the toolbar
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export PDF/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBeTruthy();
  });
});

// ==================================================================================
// Responsive QA at the required viewport matrix
// ==================================================================================

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
];

test.describe("PDF Editor: responsive QA matrix", () => {
  for (const { width, height } of VIEWPORTS) {
    test(`no horizontal overflow and core controls are reachable at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openFile(page, path.join(OCR_FIXTURES, "native-text.pdf"));

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(hasOverflow).toBe(false);

      // Canvas is centered/visible, toolbar's export control is reachable, page surface
      // itself doesn't overflow the viewport width.
      await expect(page.getByRole("button", { name: /Export PDF/i })).toBeVisible();
      const surfaceBox = await page.locator('[data-testid="page-surface"]').first().boundingBox();
      expect(surfaceBox).not.toBeNull();
      if (surfaceBox) {
        expect(surfaceBox.x).toBeGreaterThanOrEqual(-1);
      }

      // Zoom controls are present and clickable without throwing.
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.getByRole("button", { name: "Zoom out" }).click();
    });
  }
});

// ==================================================================================
// Privacy regression: signature, image insertion, form fill, crop, header/footer.
// (The OCR-specific privacy check lives in pdf-editor-ocr.spec.ts, alongside every other
// real-recognition test.)
// ==================================================================================

test.describe("PDF Editor: privacy regression (signature / image / form / crop / header-footer)", () => {
  test("no document bytes, signature/image contents, or third-party requests leave the browser across these flows", async ({ page, isMobile }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/pdf/editor", { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "acroform.pdf"));
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Actual size (100%)" }).click(); // a phone opens fit to width

    requests.length = 0; // only care about traffic from here on

    // Signature.
    await page.getByRole("button", { name: "Sign", exact: true }).click();
    const sigDialog = page.getByRole("dialog", { name: "Add signature" });
    const sigCanvas = sigDialog.getByRole("img", { name: "Signature drawing area" });
    const sigBox = await sigCanvas.boundingBox();
    if (!sigBox) throw new Error("no signature canvas bounding box");
    await page.mouse.move(sigBox.x + 10, sigBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(sigBox.x + sigBox.width - 10, sigBox.y + sigBox.height - 10, { steps: 5 });
    await page.mouse.up();
    await sigDialog.getByRole("button", { name: "Place signature" }).click();
    const surface = page.locator('[data-testid="page-surface"]').first();
    await surface.scrollIntoViewIfNeeded();
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");
    await page.mouse.click(surfaceBox.x + 60, surfaceBox.y + 250);

    // Image insertion.
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Image", exact: true }).click(),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES, "image-2x1.png"));
    await page.mouse.click(surfaceBox.x + 60, surfaceBox.y + 320);

    // Form fill.
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "Form fields" }).click();
    await page.locator("#field-full_name").fill("Privacy Check");
    await page.locator("#field-subscribe").check();

    // Crop. Recompute the surface's position fresh — several panel-opening clicks have
    // happened since surfaceBox was first captured, any of which could have shifted layout
    // or scroll position and made that earlier box stale.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await surface.scrollIntoViewIfNeeded();
    const cropSurfaceBox = await surface.boundingBox();
    if (!cropSurfaceBox) throw new Error("no page surface bounding box before crop");
    await page.mouse.move(cropSurfaceBox.x + 30, cropSurfaceBox.y + 30);
    await page.mouse.down();
    await page.mouse.move(cropSurfaceBox.x + 200, cropSurfaceBox.y + 200, { steps: 5 });
    await page.mouse.up();
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "Crop" }).click();
    await page.getByRole("button", { name: "Apply crop" }).click();

    // Header/footer.
    await page.locator("summary", { hasText: "Watermark, page numbers" }).click();
    await page.getByPlaceholder(/Header\/footer text/i).fill("Privacy check {page}");
    await page.getByRole("button", { name: "Add header/footer" }).click();
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });

    // Export.
    await page.keyboard.press("Escape");
    await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export PDF/i }).click(),
    ]);

    const baseURL = new URL(page.url()).origin;
    const thirdParty = requests.filter((u) => !u.startsWith(baseURL) && !u.startsWith("blob:"));
    expect(thirdParty).toEqual([]);
  });
});
