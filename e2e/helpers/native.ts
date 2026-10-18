import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

export const EDITOR_FIXTURES = path.join(__dirname, "..", "..", "qa", "editor-fixtures");

export async function openEditor(page: Page, filePath: string) {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Actual size (100%)" }).click();
  // the page's own text is read in the background; the hit targets appear when it is
  await expect(page.locator('[data-testid="native-block"], [data-testid="native-image"]').first()).toBeAttached({ timeout: 20_000 });
}

/** The hit target of the block of text that contains `fragment`. */
export function blockWith(page: Page, fragment: string) {
  return page.locator(`[data-testid="native-block"][data-text*="${fragment.replace(/"/g, '\\"')}"]`).first();
}

/**
 * The real user route: double-click the paragraph, then move the caret with the keyboard to the word, select it and type over it.
 * `occurrence` picks which one when a word appears more than once in the paragraph.
 */
export async function replaceWordByTyping(page: Page, paragraphHas: string, from: string, to: string, occurrence = 0) {
  const block = blockWith(page, paragraphHas);
  await expect(block).toBeVisible();
  const text = (await block.getAttribute("data-text")) ?? "";
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = text.indexOf(from, at + 1);
  expect(at, `"${from}" should be in "${text}"`).toBeGreaterThanOrEqual(0);
  await block.dblclick();
  const editor = page.getByTestId("native-text-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < at; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < from.length; i++) await page.keyboard.press("Shift+ArrowRight");
  if (to === "") await page.keyboard.press("Delete");
  else await page.keyboard.type(to, { delay: 5 });
  return editor;
}

export async function finishEdit(page: Page) {
  await page.getByRole("button", { name: "Apply this text edit" }).click();
  await expect(page.getByTestId("native-text-editor")).toHaveCount(0, { timeout: 15_000 });
}

export async function exportPdf(page: Page, name: string): Promise<Buffer> {
  await page.keyboard.press("Escape");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export PDF/i }).click()]);
  const out = test.info().outputPath(name);
  await download.saveAs(out);
  return fs.readFileSync(out);
}

export async function pdfText(bytes: Buffer, pageNumber = 1): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const p = await doc.getPage(pageNumber);
  const tc = await p.getTextContent();
  return tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ");
}
