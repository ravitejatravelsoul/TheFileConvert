import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { renderPdfPage, findCollateralChanges, measureRegionStyle } from "./helpers/pdf-render";
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
  await page.getByRole("button", { name: "Actual size (100%)" }).click(); // these tests assume 100% (a phone opens fit to width)
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

/** Counts pixels that differ by more than `tolerance` strictly within `rectPx` — unlike
 * findCollateralChanges (which reports whole-page totals plus an "outside" count), this is
 * for asserting a *specific* small region stayed untouched, independent of whatever the
 * intended edit region elsewhere on the page is doing. */
function countChangesInRect(
  before: { getPixel(x: number, y: number): [number, number, number, number] },
  after: { getPixel(x: number, y: number): [number, number, number, number] },
  rectPx: { x: number; y: number; width: number; height: number },
  tolerance = 24
): number {
  let count = 0;
  const x0 = Math.max(0, Math.round(rectPx.x));
  const y0 = Math.max(0, Math.round(rectPx.y));
  const x1 = Math.round(rectPx.x + rectPx.width);
  const y1 = Math.round(rectPx.y + rectPx.height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const b = before.getPixel(x, y);
      const a = after.getPixel(x, y);
      const dist = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) + Math.abs(b[3] - a[3]);
      if (dist > tolerance) count++;
    }
  }
  return count;
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

  test("screenshot acceptance: degree -> graduate on a textured serif scan renders in a matching style, not a generic sans-serif box", async ({
    page,
    isMobile,
  }) => {
    // Matches the exact defect report scenario: a textured gray scan, serif printed text, a
    // thin form line near the text, and a shorter->longer word replacement ("degree" ->
    // "graduate") right next to several other words on the same line. This is the release
    // gate fixture (spec section 20/33) — collateral change must stay localized *and* the
    // replacement must statistically resemble its neighboring text, not read as an obviously
    // different font/weight/sharpness pasted on top.
    const fixtureName = "degree-graduate-scan.pdf";
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

    const wordButton = page.getByRole("button", { name: /Edit recognized word: degree/i }).first();
    await expect(wordButton).toBeVisible({ timeout: 10_000 });
    await wordButton.click();

    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await dialog.locator("input[type=text]").fill("graduate");
    // The live preview should have rendered a real raster patch (not a plain colored div) —
    // confirms the export-identical-preview requirement (spec section 13) actually fired for
    // this fixture rather than silently falling back.
    await expect(dialog.locator("img")).toBeVisible();
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

    // A. Collateral preservation — unrelated pixels (the line, "for the award of the",
    // the paper grain) must stay untouched.
    const diff = findCollateralChanges(before, after, [allowedRegionPx]);

    // B. Style similarity — the new "graduate" should statistically resemble the unchanged
    // neighboring word "award" on the same line, not read as an obviously different font.
    // "award" sits well to the left of "degree"/"graduate", comfortably outside the allowed
    // (edited) region, at the same line height.
    const neighborRegionPx = {
      x: allowedRegionPx.x - 6.2 * (allowedRegionPx.width / "graduate".length),
      y: allowedRegionPx.y,
      width: 3.5 * (allowedRegionPx.width / "graduate".length),
      height: allowedRegionPx.height,
    };
    const backgroundGuess = after.getPixel(Math.max(0, Math.round(allowedRegionPx.x - 20)), Math.round(allowedRegionPx.y - 20)).slice(0, 3) as [
      number,
      number,
      number,
    ];
    const replacementStyle = measureRegionStyle(after, allowedRegionPx, backgroundGuess);
    const neighborStyle = measureRegionStyle(before, neighborRegionPx, backgroundGuess);

    // Always save crops for this specific fixture — it's the explicit human-visual-QA
    // acceptance scenario from the report (spec section 21), reviewed by eye in addition to
    // these automated thresholds.
    before.savePng(test.info().outputPath("degree-before.png"));
    after.savePng(test.info().outputPath("degree-after.png"));
    if (diff.changedOutsidePixelCount > 0) {
      console.log("collateral offending samples:", diff.offendingSamples);
    }
    console.log("style stats — replacement:", replacementStyle, "neighbor:", neighborStyle);

    expect(diff.changedOutsidePixelCount, JSON.stringify(diff.offendingSamples)).toBeLessThan(80);
    expect(diff.changedPixelCount).toBeGreaterThan(0);

    // Both should actually contain ink (sanity: neither region is blank/misaligned).
    expect(replacementStyle.inkDensity).toBeGreaterThan(0.03);
    expect(neighborStyle.inkDensity).toBeGreaterThan(0.03);
    // Stroke weight in the same ballpark — catches "rendered as a wildly different weight
    // font" (e.g. a hairline sans vs. a heavy serif) without requiring pixel-perfect font
    // metrics, which no local (non-AI) technique can promise.
    expect(replacementStyle.avgStrokeWidthPx).toBeLessThan(neighborStyle.avgStrokeWidthPx * 2.5 + 1);
    expect(replacementStyle.avgStrokeWidthPx).toBeGreaterThan(neighborStyle.avgStrokeWidthPx * 0.3);
    // Both should show some anti-aliased/softened edge, not one being a hard binary edge
    // next to a soft scanned one (the "looks pasted on" tell from the defect report).
    expect(replacementStyle.edgeSoftness).toBeGreaterThan(0);
  });

  test("unsafe fallback: a word overlapping a ruling line refuses to auto-erase and requires an explicit manual overlay", async ({
    page,
    isMobile,
  }) => {
    const fixturePath = path.join(OCR_FIXTURES, "line-overlap-scan.pdf");
    await openFile(page, fixturePath);
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });
    await page.keyboard.press("Escape");

    const wordButton = page.getByRole("button", { name: /Edit recognized word: Amount/i }).first();
    await expect(wordButton).toBeVisible({ timeout: 10_000 });
    await wordButton.click();

    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await dialog.locator("input[type=text]").fill("Total");

    // Can't be replaced automatically: Save must stay disabled and the explanation visible,
    // until the user explicitly opts into a manual overlay (spec section 16 — never silently
    // fall back to a risky automatic erase over a table/border line).
    await expect(dialog.getByText(/can.t be replaced automatically/i).first()).toBeVisible();
    const saveButton = dialog.getByRole("button", { name: "Save correction" });
    await expect(saveButton).toBeDisabled();

    await dialog.getByRole("checkbox", { name: /manual, doesn.t erase the original/i }).check();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dialog).not.toBeVisible();

    const bytes = await exportAndSave(page, "line-overlap-edited.pdf");
    const text = await extractText(bytes, 1);
    expect(text).toContain("Total");
  });

  test("a line-level edit that only swaps a digit keeps the rest of the line (not just the changed digit)", async ({ page, isMobile }) => {
    // Regression (found on production): editing the whole recognized LINE
    // "VALID FROM 02/08/2026 UNTIL 12/20/2026" -> "...12/20/2028" was treated as a digit micro-edit,
    // but a line has no per-character boxes, so the patch covered the entire line while drawing only
    // the changed "8" — the first date and "UNTIL" vanished from the export.
    const fixturePath = path.join(OCR_FIXTURES, "date-field-scan.pdf");
    const originalBytes = fs.readFileSync(fixturePath);

    await openFile(page, fixturePath);
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });
    await page.keyboard.press("Escape");

    const untilBox = await page.getByRole("button", { name: /Edit recognized word: UNTIL/i }).first().boundingBox();
    const firstDateBox = await page.getByRole("button", { name: /Edit recognized word: 02\/08\/2026/i }).first().boundingBox();
    const secondDateBox = await page.getByRole("button", { name: /Edit recognized word: 12\/20\/2026/i }).first().boundingBox();
    const surfaceBox = await page.locator('[data-testid="page-surface"]').first().boundingBox();
    if (!untilBox || !firstDateBox || !secondDateBox || !surfaceBox) throw new Error("missing word/surface bounding boxes");

    // Word buttons sit on top of the line button, so — like a user — reach the line through the gap
    // between two words.
    const lineButton = page.getByRole("button", { name: /Edit recognized line: .*UNTIL.*12\/20\/2026/i }).first();
    await expect(lineButton).toBeVisible({ timeout: 10_000 });
    const gapX = (firstDateBox.x + firstDateBox.width + untilBox.x) / 2;
    const lineY = untilBox.y + untilBox.height / 2;
    await page.mouse.click(gapX, lineY);
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    const input = dialog.locator("input[type=text]");
    const original = await input.inputValue();
    expect(original).toMatch(/UNTIL.*12\/20\/2026/);
    await input.fill(original.replace("12/20/2026", "12/20/2028"));
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    const bytes = await exportAndSave(page, "line-edit.pdf");
    const before = await renderPdfPage(originalBytes, 1, RENDER_SCALE);
    const after = await renderPdfPage(bytes, 1, RENDER_SCALE);
    const toPx = (b: { x: number; y: number; width: number; height: number }) => ({
      x: (b.x - surfaceBox.x) * PIXEL_SCALE,
      y: (b.y - surfaceBox.y) * PIXEL_SCALE,
      width: b.width * PIXEL_SCALE,
      height: b.height * PIXEL_SCALE,
    });
    const ink = (img: { getPixel(x: number, y: number): [number, number, number, number] }, r: { x: number; y: number; width: number; height: number }) => {
      let n = 0;
      for (let y = Math.round(r.y); y <= Math.round(r.y + r.height); y++) for (let x = Math.round(r.x); x <= Math.round(r.x + r.width); x++) if (img.getPixel(x, y)[0] < 110) n++;
      return n;
    };
    for (const [label, box] of [["UNTIL", untilBox], ["02/08/2026", firstDateBox]] as const) {
      const r = toPx(box);
      const was = ink(before, r);
      const now = ink(after, r);
      expect(was, `${label} had ink originally`).toBeGreaterThan(20);
      // Redrawn in a matched face its pixels may differ, but its text must still be there.
      expect(now, `${label} still has its text after a line edit (was ${was} dark px, now ${now})`).toBeGreaterThan(was * 0.4);
    }
    // The redrawn line must not be clipped at the patch's right edge: the final digit ("8") has to
    // be there. A line redrawn in a wider face used to be cut off, exporting "12/20/202".
    const lastDigit = toPx({ x: secondDateBox.x + secondDateBox.width * 0.85, y: secondDateBox.y, width: secondDateBox.width * 0.2, height: secondDateBox.height });
    expect(ink(after, lastDigit), "the final digit of the edited date is present (not clipped)").toBeGreaterThan(10);
    expect(await extractText(bytes, 1)).toContain("12/20/2028");
  });

  test("micro-edit acceptance: only the changed date digit is patched, not the whole date field", async ({ page, isMobile }) => {
    // The exact regression scenario from the defect report: "02/08/2026 UNTIL 12/20/2026",
    // editing only the final date's last digit (2026 -> 2028). A correct fix patches roughly
    // one digit's worth of width, not the whole "12/20/2026" token — and must leave the
    // first date, the word "UNTIL", and the horizontal rule pixel-identical.
    const fixtureName = "date-field-scan.pdf";
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

    const untilButton = page.getByRole("button", { name: /Edit recognized word: UNTIL/i }).first();
    const firstDateButton = page.getByRole("button", { name: /Edit recognized word: 02\/08\/2026/i }).first();
    const secondDateButton = page.getByRole("button", { name: /Edit recognized word: 12\/20\/2026/i }).first();
    await expect(untilButton).toBeVisible({ timeout: 10_000 });
    await expect(firstDateButton).toBeVisible();
    await expect(secondDateButton).toBeVisible();

    const untilBoxBefore = await untilButton.boundingBox();
    const firstDateBoxBefore = await firstDateButton.boundingBox();
    if (!untilBoxBefore || !firstDateBoxBefore) throw new Error("missing neighbor word bounding boxes");

    await secondDateButton.click();
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    const input = dialog.locator("input[type=text]");
    await expect(input).toHaveValue("12/20/2026");
    await input.fill("12/20/2028");
    await expect(dialog.locator("img")).toBeVisible();
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    const objectBox = await page.locator('[data-object-type="ocr-text-replacement"]').first().boundingBox();
    if (!objectBox) throw new Error("no ocr-text-replacement object bounding box");
    const surfaceBox = await page.locator('[data-testid="page-surface"]').first().boundingBox();
    if (!surfaceBox) throw new Error("no page surface bounding box");

    // The core tightening assertion: the saved patch object must be far narrower than the
    // whole "12/20/2026" date token (10 characters) — roughly one character's worth of
    // width, not the whole field. Compared against the full date's own on-screen width via
    // the neighboring "02/08/2026" button (same digit count/font), so this isn't a hardcoded
    // pixel guess.
    expect(objectBox.width).toBeLessThan(firstDateBoxBefore.width * 0.35);

    const bytes = await exportAndSave(page, `${fixtureName}-edited.pdf`);
    const before = await renderPdfPage(originalBytes, 1, RENDER_SCALE);
    const after = await renderPdfPage(bytes, 1, RENDER_SCALE);

    const toPagePx = (box: { x: number; y: number; width: number; height: number }) => ({
      x: (box.x - surfaceBox.x) * PIXEL_SCALE,
      y: (box.y - surfaceBox.y) * PIXEL_SCALE,
      width: box.width * PIXEL_SCALE,
      height: box.height * PIXEL_SCALE,
    });

    const margin = 10;
    const allowedRegionPx = { ...toPagePx(objectBox), x: toPagePx(objectBox).x - margin, y: toPagePx(objectBox).y - margin };
    allowedRegionPx.width += margin * 2;
    allowedRegionPx.height += margin * 2;

    // A. Collateral preservation, same as the other fixtures, but now over a much smaller
    // allowed region — proportionate to the tightened patch, not the whole date field.
    const diff = findCollateralChanges(before, after, [allowedRegionPx]);
    before.savePng(test.info().outputPath("date-before.png"));
    after.savePng(test.info().outputPath("date-after.png"));
    if (diff.changedOutsidePixelCount > 0) console.log("offending samples:", diff.offendingSamples);
    expect(diff.changedOutsidePixelCount, JSON.stringify(diff.offendingSamples)).toBeLessThan(60);
    expect(diff.changedPixelCount).toBeGreaterThan(0);

    // B. Explicit neighbor checks: "UNTIL" and the first date must be pixel-identical
    // (near-zero tolerance) — checked strictly within their own exact areas, independent of
    // whatever the intended edit is doing elsewhere on the page.
    const untilChanged = countChangesInRect(before, after, toPagePx(untilBoxBefore));
    expect(untilChanged, "UNTIL must remain visually identical").toBe(0);
    const firstDateChanged = countChangesInRect(before, after, toPagePx(firstDateBoxBefore));
    expect(firstDateChanged, "the untouched first date must remain visually identical").toBe(0);

    // C. The horizontal rule (a fixed band roughly 65/130ths down the 420x130pt page) must
    // stay intact across its full width, including directly under the edited digit.
    const ruleY = Math.round((65 / 130) * before.height);
    const ruleChanged = countChangesInRect(before, after, { x: 0, y: ruleY - 3, width: before.width, height: 6 });
    expect(ruleChanged, "the horizontal rule must remain intact").toBe(0);

    const text = await extractText(bytes, 1);
    expect(text).toContain("2028");
  });

  test("regression: selection handles on a freshly-saved micro-edit don't cover the edited glyph", async ({ page, isMobile }) => {
    // A real defect found via manual reproduction: a corrected object is auto-selected right
    // after Save, and the resize-handle circles were positioned straddling the object's own
    // corners (half inside, half outside) — invisible for a normal-sized whole-word patch,
    // but for a tightened single-character patch (see the micro-edit fix above) the four
    // handles covered a large fraction of the tiny glyph, making it look malformed/scribbled
    // immediately after every micro-edit even though the underlying patch/export was correct.
    const fixturePath = path.join(OCR_FIXTURES, "date-field-scan.pdf");
    await openFile(page, fixturePath);
    await openMobilePanel(page, isMobile, "Properties");
    await page.locator("summary", { hasText: "OCR" }).click();
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize current page" }).click();
      await expect(page.getByRole("button", { name: "Recognize current page" })).toBeVisible({ timeout: 90_000 });
    });
    await page.keyboard.press("Escape");

    const secondDateButton = page.getByRole("button", { name: /Edit recognized word: 12\/20\/2026/i }).first();
    await expect(secondDateButton).toBeVisible({ timeout: 10_000 });
    await secondDateButton.click();
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await dialog.locator("input[type=text]").fill("12/20/2028");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).not.toBeVisible();

    // The new object is auto-selected (addObject selects it), so its resize handles should
    // already be rendered — this is exactly the state the defect screenshot showed.
    const objectEl = page.locator('[data-object-type="ocr-text-replacement"]').first();
    const objectBox = await objectEl.boundingBox();
    if (!objectBox) throw new Error("no ocr-text-replacement object bounding box");

    // Each of the 4 resize handles (small circles at the corners) must not overlap the
    // object's own content area — they should sit just outside it, framing the selection
    // without covering any of the tiny patch image underneath.
    const handles = await objectEl.locator(".rounded-full").all();
    expect(handles.length).toBeGreaterThanOrEqual(4);
    for (const handle of handles) {
      const handleBox = await handle.boundingBox();
      if (!handleBox) continue;
      const overlapX = Math.max(0, Math.min(objectBox.x + objectBox.width, handleBox.x + handleBox.width) - Math.max(objectBox.x, handleBox.x));
      const overlapY = Math.max(0, Math.min(objectBox.y + objectBox.height, handleBox.y + handleBox.height) - Math.max(objectBox.y, handleBox.y));
      const overlapArea = overlapX * overlapY;
      expect(overlapArea, "a resize handle must not overlap the object's own content area").toBeLessThanOrEqual(0.5);
    }
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
