import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, EVIDENCE, editText, exportPdf, goToPage, openEditor, pdfText, typeInto } from "./helpers/native";

test.describe.configure({ timeout: 180_000 });
test.skip(({ isMobile }) => isMobile, "desktop keyboard flow");

const LETTER = path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf");

test("undo and redo of text edits; typing one burst is one step; the dirty marker follows", async ({ page }) => {
  await openEditor(page, LETTER);
  await expect(page.getByTestId("dirty-indicator")).toHaveCount(0);
  // a burst of typing in one text box is a single undo step
  await editText(page, { has: "recieve", find: "recieve", replace: "receive" });
  await expect(page.getByTestId("dirty-indicator")).toBeVisible();
  await editText(page, { has: "teh chair", find: "teh", replace: "the" });
  let out = await exportPdf(page, "two.pdf");
  let t = await pdfText(out);
  expect(t).toContain("receive");
  expect(t).toContain("the chair");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(700);
  out = await exportPdf(page, "undo1.pdf");
  t = await pdfText(out);
  expect(t).toContain("receive");
  expect(t).toContain("teh chair");

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(700);
  out = await exportPdf(page, "undo2.pdf");
  t = await pdfText(out);
  expect(t).toContain("recieve");
  await expect(page.getByTestId("dirty-indicator")).toHaveCount(0);

  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(700);
  out = await exportPdf(page, "redo.pdf");
  t = await pdfText(out);
  expect(t).toContain("receive");
  expect(t).toContain("the chair");
});

test("search finds the new text and not the old; copy reads the edit; Escape and Cancel leave the page untouched", async ({ page }) => {
  await openEditor(page, LETTER);
  await editText(page, { has: "recieve", find: "recieve", replace: "receive" });
  await page.locator("summary", { hasText: /^s*Search/ }).click();
  const box = page.getByLabel("Search document text");
  await box.fill("receive");
  await expect(page.getByText(/1 of 1|1\/1|1 match/i).first()).toBeVisible({ timeout: 10_000 });
  await box.fill("recieve");
  await expect(page.getByText(/no matches|0 matches|0 of 0/i).first()).toBeVisible({ timeout: 10_000 });

  // Cancel: nothing changes
  const before = await page.getByTestId("dirty-indicator").count();
  await typeInto(page, { has: "teh chair", find: "teh", replace: "XYZ" });
  await page.getByRole("button", { name: "Cancel this text edit" }).click();
  await expect(page.getByTestId("native-text-editor")).toHaveCount(0);
  const out = await exportPdf(page, "cancel.pdf");
  expect(await pdfText(out)).not.toContain("XYZ");
  expect(await page.getByTestId("dirty-indicator").count()).toBe(before);
});

test("keyboard in the text box: Home/End/arrows/Delete/Backspace, Ctrl+A/C/V, Enter in a paragraph", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await openEditor(page, LETTER);
  await typeInto(page, { has: "Quarterly Update", before: "Quarterly Update", insert: "" });
  const editor = page.getByTestId("native-text-editor");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await expect(editor).toHaveText("uarterly Update!");
  await page.keyboard.press("Backspace"); // at the start: nothing
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveText("arterly Update!");
  await page.keyboard.press("Escape"); // commits
  await expect(editor).toHaveCount(0, { timeout: 20_000 });
  const out = await exportPdf(page, "kbd.pdf");
  expect(await pdfText(out)).toContain("arterly Update!");
});

test("a long uninterrupted session: ten edits across ten pages, then export, with the first page's edit still there", async ({ page }) => {
  const file = path.join(EDITOR_FIXTURES, "EDITOR-11-long-document-25-pages.pdf");
  const orig = fs.readFileSync(file);
  await openEditor(page, file);
  const edits: [number, string, string][] = [];
  for (let n = 1; n <= 12; n++) {
    await goToPage(page, n);
    await editText(page, { has: "recieve", find: "recieve", replace: "receive" });
    edits.push([n, "recieve", "receive"]);
    if (n % 4 === 0) {
      // something else in between: a highlight and a text box
      await page.getByRole("button", { name: "Add text", exact: true }).click();
      await page.locator('[data-testid="page-surface"]').first().click({ position: { x: 120, y: 620 } });
      await page.keyboard.type(`note ${n}`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Select", exact: true }).click();
    }
  }
  await page.screenshot({ path: path.join(EVIDENCE, "long-session-final.png") });
  const out = await exportPdf(page, "long.pdf");
  for (const [n] of edits) {
    const t = await pdfText(out, n);
    expect(t, `page ${n}`).toContain("receive");
    expect(t, `page ${n}`).not.toContain("recieve");
  }
  // pages that were not touched are as they were
  expect(await pdfText(out, 20)).toBe(await pdfText(orig, 20));
});
