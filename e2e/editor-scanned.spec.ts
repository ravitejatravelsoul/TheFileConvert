import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { EDITOR_FIXTURES, exportPdf } from "./helpers/native";
import { pickTool } from "./helpers/editor";

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => isMobile, "desktop pointer flow");

for (const name of ["EDITOR-12-scanned-form.pdf", "EDITOR-13-scanned-letter.pdf"]) {
  test(`${name}: a scan says so, does not pretend to be editable text, and still takes everything that works on a picture`, async ({ page }, info) => {
    await page.goto("/pdf-editor");
    await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, name));
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Actual size (100%)" }).click();
    await expect(page.getByText("Scanned page.", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Recognize text" }).first()).toBeVisible();
    await expect(page.locator('[data-testid="native-block"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit recognized word/ })).toHaveCount(0);
    // the scan itself is the page: it is not a picture to grab and drag away
    await expect(page.locator('[data-testid="native-image"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("scanned.png") });

    const surface = page.locator('[data-testid="page-surface"]').first();
    const sb = (await surface.boundingBox())!;
    // add text
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await surface.click({ position: { x: 120, y: 200 } });
    await page.keyboard.type("Added on a scan");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // whiteout, highlight, draw
    for (const tool of ["Whiteout", "Highlight", "Draw"]) {
      await pickTool(page, tool);
      await page.mouse.move(sb.x + 100, sb.y + 300);
      await page.mouse.down();
      await page.mouse.move(sb.x + 260, sb.y + 340, { steps: 5 });
      await page.mouse.up();
    }
    await page.keyboard.press("Escape");
    const out = await exportPdf(page, "scan-out.pdf");
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe((await PDFDocument.load(fs.readFileSync(path.join(EDITOR_FIXTURES, name)))).getPageCount());
    // the scan's picture is still in the file, untouched
    expect(out.byteLength).toBeGreaterThan(fs.statSync(path.join(EDITOR_FIXTURES, name)).size * 0.8);
  });
}
