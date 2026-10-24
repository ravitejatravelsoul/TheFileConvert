import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, EVIDENCE, blockWith, exportPdf, finishEdit, pdfText } from "./helpers/native";

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => !isMobile, "phone layout");

test("on a phone: tap text, Edit text, type, Done, export; controls are touch-sized; no horizontal overflow", async ({ page }) => {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="native-block"]').first()).toBeAttached({ timeout: 30_000 });
  await page.screenshot({ path: path.join(EVIDENCE, "editor-mobile.png") });

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

  // every control in the tool dock and the top bar is at least 44 px tall
  const small: string[] = [];
  for (const b of await page.locator('[role="toolbar"] button, header button, header a').all()) {
    const box = await b.boundingBox();
    if (box && box.height < 43.5) small.push(`${await b.getAttribute("aria-label")} ${Math.round(box.height)}`);
  }
  expect(small).toEqual([]);

  const block = blockWith(page, "recieve");
  await block.scrollIntoViewIfNeeded();
  const text = (await block.getAttribute("data-text")) ?? "";
  await block.tap();
  const chip = page.getByTestId("native-edit-button");
  await expect(chip).toBeVisible();
  await chip.tap();
  const editor = page.getByTestId("native-text-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < text.indexOf("recieve"); i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("receive");
  await page.screenshot({ path: path.join(EVIDENCE, "editor-mobile-typing.png") });
  await finishEdit(page);
  const out = await exportPdf(page, "phone.pdf");
  const t = await pdfText(out);
  expect(t).toContain("receive");
  expect(t).not.toContain("recieve");
});

test("on a phone: the page rail and properties open as sheets, and add-text by tap works", async ({ page }) => {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-03-business-letter.pdf"));
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Pages", exact: true }).tap();
  await expect(page.getByRole("dialog", { name: "Pages" })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).tap();
  await page.getByRole("button", { name: "Properties", exact: true }).tap();
  await expect(page.getByRole("dialog", { name: "Properties" })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).tap();
  await page.getByRole("button", { name: "Add text", exact: true }).tap();
  await page.locator('[data-testid="page-surface"]').first().tap({ position: { x: 60, y: 420 } });
  await page.keyboard.type("Typed on a phone");
  await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(1);
});

test("on a phone: a pre-filled form field shows once, takes a tap and typing, and exports", async ({ page }) => {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "..", "form-fixtures", "FORM-01-given-name.pdf"));
  const f = page.locator('[data-testid="form-field"][data-field-name="given_name"]');
  await expect(f).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await f.scrollIntoViewIfNeeded();
  await f.tap();
  await expect(f).toHaveAttribute("data-state", "editing");
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await expect(f).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
  await expect(f).toHaveValue("Ravitejax");
  const out = await exportPdf(page, "phone-form.pdf");
  const { PDFDocument } = await import("pdf-lib");
  expect((await PDFDocument.load(out)).getForm().getTextField("given_name").getText()).toBe("Ravitejax");
});
