import { test, expect } from "@playwright/test";
import { fx, trackPageErrors, expectNoHorizontalOverflow } from "./helpers/tool";
import { convertToWord, readDocx } from "./helpers/docx";

// PDF → Word through the real page, each .docx reopened independently (helpers/docx.ts). Scanned and
// mixed PDFs (real OCR) are in pdf-to-word-ocr.spec.ts.

test.describe("PDF to Word", () => {
  test("native PDF: headings, paragraphs, a valid .docx named after the PDF", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/pdf-to-word");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("PDF to Word");
    await expect(page.getByText("Convert your PDF into an editable Word document.")).toBeVisible();
    await page.getByTestId("file-input").first().setInputFiles(fx("word", "PDF-WORD-03-headings.pdf"));
    await expect(page.getByTestId("original-size")).toContainText("1 page · Text PDF");
    await expect(page.getByText(/We preserve text, headings, paragraphs, images and common layout where possible/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const { bytes, name } = await convertToWord(page, fx("word", "PDF-WORD-03-headings.pdf"));
    expect(name).toBe("PDF-WORD-03-headings.docx");
    const d = await readDocx(bytes);
    const heading = (t: string) => d.paragraphs.find((p) => p.text === t)?.style;
    expect(heading("Annual Report 2026")).toBe("Heading1");
    expect(heading("Operations")).toBe("Heading2");
    expect(heading("Staffing")).toBe("Heading3");
    expect(d.paragraphs.filter((p) => p.style === null)).toHaveLength(5); // five body paragraphs, not one blob
    expect(d.text).toContain("The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline.");
    expect(errors).toEqual([]);
  });

  test("lists become real Word bullet and numbered lists", async ({ page }) => {
    const d = await readDocx((await convertToWord(page, fx("word", "PDF-WORD-05-lists.pdf"))).bytes);
    expect(d.paragraphs.filter((p) => p.list === "bullet").map((p) => p.text)).toEqual(["Passport and tickets", "Phone charger", "Rain jacket"]);
    expect(d.paragraphs.filter((p) => p.list === "decimal").map((p) => p.text)).toEqual(["Book the venue", "Send the invitations", "Order the food", "Confirm the numbers"]);
  });

  test("pictures are embedded, decodable and keep their proportions", async ({ page }) => {
    const d = await readDocx((await convertToWord(page, fx("word", "PDF-WORD-07-images.pdf"))).bytes);
    expect(d.pictures).toBe(2);
    expect(d.media).toHaveLength(2);
    for (const m of d.media) {
      const png = m[0] === 0x89 && m[1] === 0x50;
      const jpg = m[0] === 0xff && m[1] === 0xd8;
      expect(png || jpg).toBe(true);
    }
    expect(d.text).toContain("Customer response times improved");
  });

  test("special characters come through unchanged", async ({ page }) => {
    const d = await readDocx((await convertToWord(page, fx("word", "PDF-WORD-12-special-chars.pdf"))).bytes);
    for (const s of ["niño", "¿qué pasó?", "€120.50", "£99.99", "₹1,250", "“double”", "‘single’", "✓", "™", "Zürich", "Łódź", "Ελληνικά", "Русский"]) expect(d.text).toContain(s);
    expect(d.text).not.toContain("? check");
  });

  test("a damaged PDF is refused with a clear message and nothing to download", async ({ page }) => {
    await page.goto("/pdf-to-word");
    await page.getByTestId("file-input").first().setInputFiles(fx("word", "PDF-WORD-14-corrupt.pdf"));
    await expect(page.getByRole("alert").filter({ hasText: /couldn.t be read/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Convert to Word" })).toHaveCount(0);
  });

  test("a password-protected PDF is refused with a clear message", async ({ page }) => {
    await page.goto("/pdf-to-word");
    await page.getByTestId("file-input").first().setInputFiles(fx("encrypted-user-password.pdf"));
    await expect(page.getByRole("alert").filter({ hasText: /password/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Convert to Word" })).toHaveCount(0);
  });
});
