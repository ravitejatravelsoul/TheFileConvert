import { test, expect } from "@playwright/test";
import { fx } from "./helpers/tool";
import { convertToWord, readDocx } from "./helpers/docx";
import { withOcrLock } from "./helpers/ocr-lock";

// PDF → Word for scanned and mixed PDFs: real on-device OCR, so these run in the serialized OCR projects.

test.describe("PDF to Word with OCR", () => {
  test.setTimeout(240_000);

  test("a scanned PDF is recognised on the device and becomes editable Word text", async ({ page }) => {
    const requests: { url: string; post: number }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
    await page.goto("/pdf-to-word");
    await page.getByTestId("file-input").first().setInputFiles(fx("word", "PDF-WORD-09-scanned.pdf"));
    await expect(page.getByTestId("original-size")).toContainText("Scanned PDF");
    await expect(page.getByTestId("ocr-note")).toContainText("Scanned pages will be recognized with OCR");
    await withOcrLock(async () => {
      const d = await readDocx((await convertToWord(page, fx("word", "PDF-WORD-09-scanned.pdf"), 200_000)).bytes);
      for (const s of ["Jordan Smith", "12/20/2026", "$1,250.00"]) expect(d.text).toContain(s);
      expect(d.pictures).toBe(0); // the scan becomes text, not a picture of text
    });
    // Nothing left the device: no request carried a body, every request stayed on this origin.
    const origin = new URL(page.url()).origin;
    expect(requests.filter((r) => r.post > 0 || !(r.url.startsWith(origin) || /^(blob|data):/.test(r.url)))).toEqual([]);
  });

  test("a mixed PDF keeps native pages as text and recognises only the scanned page", async ({ page }) => {
    await page.goto("/pdf-to-word");
    await page.getByTestId("file-input").first().setInputFiles(fx("word", "PDF-WORD-10-mixed.pdf"));
    await expect(page.getByTestId("original-size")).toContainText("3 pages · Mixed PDF");
    await withOcrLock(async () => {
      await page.getByRole("button", { name: "Convert to Word" }).click();
      // Only one page is recognised.
      await expect(page.getByText("Recognizing page 1 of 1…")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your Word document is ready", { timeout: 200_000 });
    });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .docx" }).click()]);
    const fs = await import("node:fs");
    const d = await readDocx(fs.readFileSync((await download.path())!));
    expect(d.sections).toBe(3); // one Word section (page) per PDF page
    const text = d.text;
    expect(text.indexOf("Chapter 1")).toBeLessThan(text.indexOf("48213"));
    expect(text.indexOf("48213")).toBeLessThan(text.indexOf("Chapter 2"));
    expect(text).toContain("03/14/2026");
  });
});
