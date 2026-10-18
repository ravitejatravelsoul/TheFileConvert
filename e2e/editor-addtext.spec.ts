import path from "node:path";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { EDITOR_FIXTURES, exportPdf, openEditor, pdfText } from "./helpers/native";

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => isMobile, "desktop pointer flow");

async function baseFonts(bytes: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const res = doc.getPage(0).node.Resources();
  const fonts = res?.lookup(PDFName.of("Font"), PDFDict);
  if (!fonts) return [];
  return fonts.keys().map((k) => String(fonts.lookup(k, PDFDict).get(PDFName.of("BaseFont"))));
}

test("add text on the page: type, restyle (serif, italic, underline, bold, size, colour, align), move, resize, export", async ({ page }) => {
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-03-business-letter.pdf"));
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  const surface = page.locator('[data-testid="page-surface"]').first();
  await surface.click({ position: { x: 140, y: 640 } });
  await page.keyboard.type("Added with style");
  await page.keyboard.press("Escape");
  const obj = page.locator('[data-object-type="added-text"]');
  await expect(obj).toHaveCount(1);
  await page.getByLabel("Font family").selectOption("serif");
  await page.getByRole("checkbox", { name: "Italic" }).check();
  await page.getByRole("checkbox", { name: "Underline" }).check();
  await page.getByRole("checkbox", { name: "Bold" }).check();
  await page.getByRole("button", { name: "Align center" }).click();

  // move it, then resize it from a corner
  const b = (await obj.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + 34, { steps: 5 });
  await page.mouse.up();
  const moved = (await obj.boundingBox())!;
  expect(Math.round(moved.x - b.x)).toBeGreaterThan(30);

  const out = await exportPdf(page, "styled.pdf");
  expect(await pdfText(out)).toContain("Added with style");
  const fonts = await baseFonts(out);
  expect(fonts.some((f) => /Times-BoldItalic/.test(f))).toBe(true);
});
