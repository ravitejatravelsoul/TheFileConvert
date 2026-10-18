import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

export const EDITOR_FIXTURES = path.join(__dirname, "..", "..", "qa", "editor-fixtures");
export const EVIDENCE = path.join(__dirname, "..", "..", "qa", "review", "pdf-editor");
export const UI_OUT = path.join(__dirname, "..", "..", "qa", "fidelity", "_work", "ui-out");

export async function openEditor(page: Page, filePath: string) {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Actual size (100%)" }).click();
  // the page's own text is read in the background; the hit targets appear when it is
  await expect(page.locator('[data-testid="native-block"], [data-testid="native-image"]').first()).toBeAttached({ timeout: 30_000 });
}

export async function goToPage(page: Page, n: number) {
  if (n === 1) return;
  await page.getByRole("button", { name: `Go to page ${n}`, exact: true }).click();
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="native-block"], [data-testid="native-image"]').first()).toBeAttached({ timeout: 30_000 });
}

/** The hit target of the block of text that contains `fragment`. */
export function blockWith(page: Page, fragment: string) {
  return page.locator(`[data-testid="native-block"][data-text*="${fragment.replace(/"/g, '\\"')}"]`).first();
}

export interface TypedEdit {
  /** A fragment that identifies the paragraph. */
  has: string;
  /** Existing text to select and type over … */
  find?: string;
  /** … with this (empty = just delete it). */
  replace?: string;
  /** … or: put the caret right after this text and type `insert`. */
  before?: string;
  insert?: string;
  /** Which occurrence of `find`/`before` inside the paragraph. */
  occurrence?: number;
  /** Look for `find`/`before` from where this text starts. */
  near?: string;
}

/**
 * The real user route: double-click the paragraph, move the caret with the keyboard to the spot, and type. Returns the paragraph's
 * box (page space) and its text as it was.
 */
export async function typeInto(page: Page, e: TypedEdit) {
  const block = blockWith(page, e.has);
  await expect(block, `a paragraph with "${e.has}"`).toBeVisible();
  const text = (await block.getAttribute("data-text")) ?? "";
  const bbox = JSON.parse((await block.getAttribute("data-bbox")) ?? "{}") as { x: number; y: number; width: number; height: number };
  const anchor = e.find ?? e.before ?? "";
  let at = e.near ? text.indexOf(e.near) - 1 : -1;
  if (e.near) expect(text.indexOf(e.near)).toBeGreaterThanOrEqual(0);
  for (let i = 0; i <= (e.occurrence ?? 0); i++) at = text.indexOf(anchor, at + 1);
  expect(at, `"${anchor}" should be in "${text}"`).toBeGreaterThanOrEqual(0);
  const start = e.before !== undefined ? at + anchor.length : at;
  await block.dblclick();
  const editor = page.getByTestId("native-text-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < start; i++) await page.keyboard.press("ArrowRight");
  if (e.find !== undefined) {
    for (let i = 0; i < e.find.length; i++) await page.keyboard.press("Shift+ArrowRight");
    const typed = e.replace ?? "";
    if (typed === "") await page.keyboard.press("Delete");
    else await page.keyboard.type(typed, { delay: 3 });
  } else if (e.insert) {
    await page.keyboard.type(e.insert, { delay: 3 });
  }
  return { editor, text, bbox };
}

/** The user's whole gesture: type the edit, press Done. */
export async function editText(page: Page, e: TypedEdit) {
  const r = await typeInto(page, e);
  await finishEdit(page);
  return r;
}

export async function finishEdit(page: Page) {
  await page.getByRole("button", { name: "Apply this text edit" }).click();
  await expect(page.getByTestId("native-text-editor")).toHaveCount(0, { timeout: 20_000 });
}

export async function exportPdf(page: Page, name: string): Promise<Buffer> {
  await page.keyboard.press("Escape");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export PDF/i }).click()]);
  const out = test.info().outputPath(name);
  await download.saveAs(out);
  return fs.readFileSync(out);
}

export async function pdfText(bytes: Buffer | Uint8Array, pageNumber = 1): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 }).promise;
  const p = await doc.getPage(pageNumber);
  const tc = await p.getTextContent();
  // the way a viewer's find reads it: chunks of one line run together, a line end is a space
  return tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : "")).join("").replace(/\s+/g, " ");
}

const norm = (t: string) => t.split(/\s+/).join(" ").trim();
const count = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);

/** Checks the exported page's text against the original's: the new words are in, the old ones gone, and nothing else came or went. */
export async function expectTextChanged(orig: Buffer, out: Buffer, pageNumber: number, from: string, to: string) {
  const a = norm(await pdfText(orig, pageNumber));
  const b = norm(await pdfText(out, pageNumber));
  const f = norm(from);
  const t = norm(to);
  const overlap = f.includes(t) || t.includes(f);
  if (!overlap && t) expect(count(b, t), `"${t}" is in the exported text`).toBeGreaterThanOrEqual(count(a, t) + 1);
  if (!overlap && f) expect(count(b, f), `"${f}" is gone from the exported text`).toBe(count(a, f) - 1);
  if (overlap && t) expect(b).toContain(t);
}

/** Saves an export next to its original and a description, for the independent validator (qa/validate/editorcheck.py). */
export function saveForValidator(name: string, orig: Buffer, out: Buffer, meta: { from: string; to: string; page: number; bbox: { x: number; y: number; width: number; height: number } }) {
  fs.mkdirSync(UI_OUT, { recursive: true });
  fs.writeFileSync(path.join(UI_OUT, `${name}.pdf`), out);
  fs.writeFileSync(path.join(UI_OUT, `${name}.orig.pdf`), orig);
  fs.writeFileSync(path.join(UI_OUT, `${name}.json`), JSON.stringify(meta));
}
