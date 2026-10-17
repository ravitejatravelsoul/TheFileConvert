import path from "node:path";
import { test, expect } from "@playwright/test";
import { fx, downloadFrom } from "./helpers/tool";
import { convertToWord, readDocx } from "./helpers/docx";
import { withOcrLock } from "./helpers/ocr-lock";

// PDF → Word for scanned and mixed PDFs. The contract: conversion is not OCR. A scanned form, ID, certificate,
// invoice or signed page keeps its look (the page goes into Word as a picture, nothing is retyped); real-text
// pages become editable; a plain scan of running text is made editable only when the on-device reading is
// extremely reliable. OCR may run inside the converter to judge that last case, so these run in the serialized
// OCR projects.

const FAKE = (name: string) => path.resolve("qa/real-user-fixtures", name);

test.describe("PDF to Word — scanned and mixed PDFs", () => {
  test.setTimeout(240_000);

  for (const [what, file, cls] of [
    ["a scanned application form", "DOCUMENT-02-filled-application.pdf", "FORM"],
    ["a scanned passport page", "DOCUMENT-01-passport-scan.pdf", "OFFICIAL_DOCUMENT"],
    ["a two-page scanned statement", "DOCUMENT-05-bank-statement.pdf", "SCANNED_TABLE"],
  ] as const) {
    test(`${what} keeps its look: each page becomes a picture, nothing is recognised`, async ({ page }) => {
      const requests: { url: string; post: number }[] = [];
      page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
      await page.goto("/pdf-to-word");
      await page.getByTestId("file-input").first().setInputFiles(FAKE(file));
      await expect(page.getByTestId("original-size")).toContainText("Scanned PDF");
      await expect(page.getByTestId("scan-note")).toContainText("keep their original look");
      await page.getByRole("button", { name: "Convert to Word" }).click();
      await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your Word document is ready", { timeout: 200_000 });
      // The decision is shown to the user and to the test, page by page.
      const result = page.getByTestId("result");
      const pages = (await result.getAttribute("data-page-strategies"))!.split(",");
      expect(new Set(pages)).toEqual(new Set(["visual"]));
      expect((await result.getAttribute("data-page-classes"))!.split(",")[0]).toBe(cls);
      await expect(page.getByText(/Recognizing page/)).toHaveCount(0);
      const { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download .docx" }));
      const d = await readDocx(bytes);
      expect(d.sections).toBe(pages.length); // one Word page per PDF page
      expect(d.anchored).toBe(pages.length); // one picture per page …
      expect(d.text).toBe(""); // … and no text: the scan was not retyped
      expect(d.media.length).toBe(pages.length);
      for (const m of d.media) expect(m[0] === 0xff || m[0] === 0x89).toBe(true); // JPEG or PNG
      for (const [w, h] of d.pageSizes) expect([Math.round(w), Math.round(h)]).toEqual([612, 792]); // the source page size
      const origin = new URL(page.url()).origin;
      expect(requests.filter((r) => r.post > 0 || !(r.url.startsWith(origin) || /^(blob|data):/.test(r.url)))).toEqual([]);
    });
  }

  test("a plain scan of running text may become editable text — only when the reading is reliable", async ({ page }) => {
    await withOcrLock(async () => {
      const res = await convertToWord(page, FAKE("DOCUMENT-07-scanned-letter.pdf"), 200_000);
      const d = await readDocx(res.bytes);
      const strategy = await page.getByTestId("result").getAttribute("data-page-strategies");
      if (strategy === "hybrid") {
        for (const s of ["Margaret L. Hollis", "Dear Mr. Reyes,", "planned maintenance of the shared garden"]) expect(d.text).toContain(s);
        expect(d.anchored).toBe(0);
      } else {
        // Not reliable enough: the page keeps its look instead.
        expect(strategy).toBe("visual");
        expect(d.text).toBe("");
        expect(d.anchored).toBe(1);
      }
    });
  });

  test("a mixed PDF keeps its text pages editable and its scanned page as it looks", async ({ page }) => {
    await withOcrLock(async () => {
      await page.goto("/pdf-to-word");
      await page.getByTestId("file-input").first().setInputFiles(fx("word", "PDF-WORD-10-mixed.pdf"));
      await expect(page.getByTestId("original-size")).toContainText("3 pages · Mixed PDF");
      await page.getByRole("button", { name: "Convert to Word" }).click();
      await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your Word document is ready", { timeout: 200_000 });
    });
    const strategies = (await page.getByTestId("result").getAttribute("data-page-strategies"))!.split(",");
    expect(strategies).toHaveLength(3);
    expect(strategies[0]).toBe("editable");
    expect(strategies[2]).toBe("editable");
    const { bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download .docx" }));
    const d = await readDocx(bytes);
    expect(d.sections).toBe(3); // one Word section (page) per PDF page
    expect(d.text).toContain("Chapter 1");
    expect(d.text).toContain("Chapter 2");
    expect(d.text.indexOf("Chapter 1")).toBeLessThan(d.text.indexOf("Chapter 2"));
    if (strategies[1] === "visual") expect(d.anchored).toBe(1); // the scanned page is a picture, in its place
  });
});
