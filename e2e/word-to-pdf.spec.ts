import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addFiles, downloadFrom, expectNoHorizontalOverflow, fx, trackPageErrors } from "./helpers/tool";
import { renderPdfPage } from "./helpers/pdf-render";

// Word → PDF through the real page; every PDF is reopened independently (pdf-lib + pdf.js text + a render).

async function pdfTexts(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : "")).join("").replace(/\s+/g, " "));
  }
  return out;
}

async function convertToPdf(page: Page, docx: string): Promise<{ bytes: Buffer; name: string }> {
  await page.goto("/word-to-pdf");
  await addFiles(page, [docx]);
  await page.getByRole("button", { name: "Convert to PDF" }).click({ timeout: 30_000 });
  await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your PDF is ready", { timeout: 60_000 });
  const { download, bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download PDF" }));
  return { bytes, name: download.suggestedFilename() };
}

test.describe("Word to PDF", () => {
  test("page, honest copy, and a header/footer document with real page numbers", async ({ page }) => {
    const errors = trackPageErrors(page);
    const requests: { url: string; post: number }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
    await page.goto("/word-to-pdf");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Word to PDF");
    await addFiles(page, [fx("docx", "WORD-10-header-footer.docx")]);
    await expect(page.getByTestId("original-size")).toContainText("Word document");
    await expect(page.getByText("Convert Word documents to PDF while preserving common formatting, images, lists and tables.")).toBeVisible();
    await expect(page.getByText("Complex Word layouts may vary slightly from Microsoft Word.", { exact: true })).toBeVisible();
    await expect(page.getByText(/perfect/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    // Primary action is a real touch target.
    const cta = await page.getByRole("button", { name: "Convert to PDF" }).boundingBox();
    expect(cta!.height).toBeGreaterThanOrEqual(44);

    const { bytes, name } = await convertToPdf(page, fx("docx", "WORD-10-header-footer.docx"));
    expect(name).toBe("WORD-10-header-footer.pdf");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    const pages = await pdfTexts(bytes);
    pages.forEach((t, i) => {
      expect(t).toContain("ACME Corporation — Confidential");
      expect(t).toContain(`Page ${i + 1} of 3`);
    });
    // The page is drawn, not blank.
    const r = await renderPdfPage(bytes, 1, 0.5);
    // Every pixel, not a sparse grid: thin text at half scale can fall between grid points when lines move
    // by a fraction of a pixel (a blank page scores 0; this page ~1,100).
    let ink = 0;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) if (r.getPixel(x, y)[0] < 160) ink++;
    expect(ink).toBeGreaterThan(500);
    await expectNoHorizontalOverflow(page);
    // Nothing left the device.
    const origin = new URL(page.url()).origin;
    expect(requests.filter((q) => q.post > 0 || !(q.url.startsWith(origin) || /^(blob|data):/.test(q.url)))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("headings, lists, tables and special characters come through as text", async ({ page }) => {
    const headings = (await pdfTexts((await convertToPdf(page, fx("docx", "WORD-02-headings.docx"))).bytes)).join(" ");
    for (const s of ["Annual Report 2026", "Operations", "Staffing"]) expect(headings).toContain(s);
    const lists = (await pdfTexts((await convertToPdf(page, fx("docx", "WORD-04-lists.docx"))).bytes)).join(" ");
    expect(lists).toMatch(/•\s*Passport and tickets/);
    expect(lists).toMatch(/3\.\s*Order the food/);
    const table = (await pdfTexts((await convertToPdf(page, fx("docx", "WORD-05-table.docx"))).bytes)).join(" ");
    expect(table).toMatch(/Region\s*Q1\s*Q2\s*Q3/);
    const special = (await pdfTexts((await convertToPdf(page, fx("docx", "WORD-08-special-characters.docx"))).bytes)).join(" ");
    for (const s of ["€120.50", "£99.99", "₹1,250", "✓", "“double”", "Łódź", "Ελληνικά", "Русский"]) expect(special).toContain(s);
  });

  test("pictures are embedded and the result offers the next steps", async ({ page }) => {
    await convertToPdf(page, fx("docx", "WORD-06-images.docx"));
    await expect(page.getByTestId("pdf-size")).toContainText("2 pictures");
    await expect(page.getByRole("button", { name: "Compress PDF" })).toBeVisible();
    await expect(page.getByRole("link", { name: "PDF to Word" }).first()).toBeVisible();
    // Continue straight into Compress PDF with the new file — no second pick.
    await page.getByRole("button", { name: "Compress PDF" }).click();
    await expect(page).toHaveURL(/\/compress-pdf$/);
    await expect(page.getByText("WORD-06-images.pdf")).toBeVisible();
  });

  test("damaged, password-protected, fake and empty files are refused; nothing to download", async ({ page }) => {
    const cases: [string, RegExp][] = [
      ["WORD-13-corrupt.docx", /couldn.t be read/],
      ["X-encrypted.docx", /password-protected/],
      ["X-fake.docx", /isn.t a Word document/],
    ];
    for (const [file, message] of cases) {
      await page.goto("/word-to-pdf");
      await addFiles(page, [fx("docx", file)]);
      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Convert to PDF" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
    }
    await page.goto("/word-to-pdf");
    await addFiles(page, [fx("docx", "X-zero-byte.docx")]);
    await expect(page.getByRole("alert").filter({ hasText: "is empty" })).toBeVisible();
    await addFiles(page, [fx("docx", "X-legacy.doc")]);
    await expect(page.getByRole("alert").filter({ hasText: "older Word 97–2003 file" })).toBeVisible();
    await addFiles(page, [fx("sample-a.pdf")]);
    await expect(page.getByRole("alert").filter({ hasText: "Word to PDF takes Word (.docx) files" })).toBeVisible();
  });

  test("a Word file on a PDF tool points to Word to PDF", async ({ page }) => {
    await page.goto("/compress-pdf");
    await addFiles(page, [fx("docx", "WORD-02-headings.docx")]);
    await expect(page.getByRole("alert").filter({ hasText: "use Word to PDF" })).toBeVisible();
  });
});
