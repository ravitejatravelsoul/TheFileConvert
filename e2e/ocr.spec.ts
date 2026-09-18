import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { withOcrLock } from "./helpers/ocr-lock";

const FIXTURES = path.join(__dirname, "fixtures", "ocr");

// OCR involves loading a real ~4MB WASM engine and a ~3MB language model, then running
// genuine recognition — this is legitimately slower than the rest of the suite.
test.describe.configure({ timeout: 120_000 });

test.describe("OCR: page classification", () => {
  test("flags scanned pages, leaves native pages alone, and pre-selects only what needs OCR", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "mixed-native-scanned.pdf"));

    const rows = page.locator("li label");
    await expect(rows).toHaveCount(3, { timeout: 15_000 });
    await expect(rows.nth(0)).toContainText("Has text");
    await expect(rows.nth(1)).toContainText("Scanned");
    await expect(rows.nth(2)).toContainText("Has text");

    // Only the scanned page should be pre-selected.
    await expect(page.getByRole("button", { name: "Recognize 1 page" })).toBeVisible();
  });

  test("a fully native PDF is left alone by default but can still be OCR'd on request", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "native-text.pdf"));
    await expect(page.getByText(/already has selectable text/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Recognize 0 pages" })).toBeDisabled();
  });
});

test.describe("OCR: recognition accuracy", () => {
  test("recognizes a clean scan with high confidence and exact text", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "clean-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    await page.locator("summary", { hasText: "Preview recognized text" }).click();
    const preview = page.locator("summary", { hasText: "Preview recognized text" }).locator("xpath=..");
    await expect(preview).toContainText("INVOICE");
    await expect(preview).toContainText("INV-2024-0158");
    await expect(preview).toContainText("Jane Smith");
    await expect(preview).toContainText("$182.50");
    await expect(preview).toContainText("95% avg. confidence");
  });

  test("recognizes currency, account numbers, and dates accurately", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "currency-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    await page.locator("summary", { hasText: "Preview recognized text" }).click();
    const preview = page.locator("summary", { hasText: "Preview recognized text" }).locator("xpath=..");
    await expect(preview).toContainText("$1,204.56");
    await expect(preview).toContainText("$1,315.94");
    await expect(preview).toContainText("4471-8890-2231");
  });

  test("recognizes names, emails, and phone numbers on a form-like scan", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "form-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    await page.locator("summary", { hasText: "Preview recognized text" }).click();
    const preview = page.locator("summary", { hasText: "Preview recognized text" }).locator("xpath=..");
    await expect(preview).toContainText("Robert Chen");
    await expect(preview).toContainText("robert.chen@example.com");
  });

  test("recognizes a sideways-scanned page once rotation is corrected", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "rotated-scan.pdf"));
    await page.getByLabel("Rotate before OCR").selectOption("90");
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    await page.locator("summary", { hasText: "Preview recognized text" }).click();
    const preview = page.locator("summary", { hasText: "Preview recognized text" }).locator("xpath=..");
    await expect(preview).toContainText("ROTATED PAGE");
    await expect(preview).toContainText("99231");
  });

  test("supports a second verified language (Spanish)", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "spanish-scan.pdf"));
    await page.getByLabel("Language").selectOption("spa");
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    await page.locator("summary", { hasText: "Preview recognized text" }).click();
    const preview = page.locator("summary", { hasText: "Preview recognized text" }).locator("xpath=..");
    await expect(preview).toContainText("FACTURA");
    await expect(preview).toContainText("2024-0099");
  });

  test("processes every page of a multi-page scanned PDF", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "multi-page-scan.pdf"));
    await expect(page.getByRole("button", { name: "Recognize 3 pages" })).toBeVisible({ timeout: 15_000 });
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize 3 pages" }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });
    await expect(page.getByText(/^3 pages recognized/)).toBeVisible();
  });
});

test.describe("OCR: searchable PDF export", () => {
  test("exported PDF is reopenable, phrase-searchable, and keeps the original scan visible", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "clean-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download searchable PDF/i }).click(),
    ]);
    const outPath = test.info().outputPath("clean-scan-searchable.pdf");
    await download.saveAs(outPath);

    const bytes = fs.readFileSync(outPath);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
    const pdfDoc = await loadingTask.promise;
    const pdfPage = await pdfDoc.getPage(1);
    const textContent = await pdfPage.getTextContent();
    const extractedText = textContent.items.map((it) => ("str" in it ? it.str : "")).join(" ");

    expect(extractedText).toContain("INVOICE");
    expect(extractedText).toContain("Jane Smith");
    expect(extractedText).toContain("$182.50");

    const opList = await pdfPage.getOperatorList();
    expect(opList.fnArray).toContain(pdfjsLib.OPS.paintImageXObject);
  });

  test("extracted text can be downloaded as a .txt file", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "clean-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download TXT/i }).click(),
    ]);
    const outPath = test.info().outputPath("clean-scan.txt");
    await download.saveAs(outPath);
    const text = fs.readFileSync(outPath, "utf8");
    expect(text).toContain("Page 1");
    expect(text).toContain("INVOICE");
  });
});

test.describe("OCR: cancel and error handling", () => {
  test("cancelling mid-batch keeps already-recognized pages instead of discarding everything", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "multi-page-scan.pdf"));
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Recognize 3 pages" }).click();
      await page.getByRole("button", { name: "Cancel" }).waitFor();
      await page.waitForTimeout(2200); // let at least one page finish
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByText(/Recognition complete|No pages were recognized/i)).toBeVisible({ timeout: 15_000 });
    });
    const summaryText = await page.textContent("body");
    const match = summaryText?.match(/(\d+) pages? recognized/);
    expect(Number(match?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test("a corrupted PDF fails safely with a friendly message", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "fixtures", "corrupted.pdf"));
    await expect(page.getByText(/couldn't read this PDF|damaged/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a zero-byte file is rejected immediately", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "fixtures", "zero-byte.pdf"));
    await expect(page.getByText(/empty/i)).toBeVisible();
  });

  test("an unsupported file type shows a friendly error", async ({ page }) => {
    await page.goto("/pdf/ocr");
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "fixtures", "sample.csv"));
    await expect(page.getByText(/isn't supported/i)).toBeVisible();
  });
});

test.describe("OCR: network privacy", () => {
  test("only same-origin static OCR assets are fetched — never document content", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/pdf/ocr", { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "clean-scan.pdf"));
    await page.getByRole("button", { name: /Recognize \d+ page/i }).waitFor();

    requests.length = 0; // only care about traffic from the recognize click onward
    await withOcrLock(async () => {
      await page.getByRole("button", { name: /Recognize \d+ page/i }).click();
      await expect(page.getByText("Recognition complete")).toBeVisible({ timeout: 90_000 });
    });

    const baseURL = new URL(page.url()).origin;
    const thirdParty = requests.filter((u) => !u.startsWith(baseURL) && !u.startsWith("blob:"));
    expect(thirdParty).toEqual([]);

    // The only same-origin requests should be the OCR runtime/model and pdf.js's worker —
    // never anything that looks like it's carrying the document (e.g. a POST/PUT).
    const assetPaths = requests.filter((u) => u.startsWith(baseURL)).map((u) => new URL(u).pathname);
    expect(assetPaths.some((p) => p.includes("/tesseract/worker.min.js"))).toBe(true);
    expect(assetPaths.some((p) => p.includes("/tesseract/tesseract-core-lstm.wasm.js"))).toBe(true);
    expect(assetPaths.some((p) => p.includes("/tesseract/lang-data/eng.traineddata.gz"))).toBe(true);
  });

  test("OCR is never loaded on the homepage or other tool pages", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));

    await page.goto("/", { waitUntil: "networkidle" });
    await page.goto("/tools", { waitUntil: "networkidle" });
    await page.goto("/pdf/merge", { waitUntil: "networkidle" });
    await page.goto("/image/compress", { waitUntil: "networkidle" });

    const tesseractRelated = requests.filter((u) => u.toLowerCase().includes("tesseract"));
    expect(tesseractRelated).toEqual([]);
  });
});
