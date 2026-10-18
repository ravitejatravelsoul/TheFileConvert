import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, EVIDENCE, exportPdf, finishEdit, openEditor, pdfText, typeInto } from "./helpers/native";

test.describe("Native text editing — the user's real flow", () => {
  test("fix a spelling mistake in a Chromium PDF: double-click, type, Done, export, reopen", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard flow; the phone has its own spec");
    test.setTimeout(120_000);
    await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(EVIDENCE, "native-text-before.png") });
    const { editor } = await typeInto(page, { has: "recieve", find: "recieve", replace: "receive" });
    await expect(editor).toContainText("receive");
    await page.screenshot({ path: path.join(EVIDENCE, "native-text-typing.png") });
    await finishEdit(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(EVIDENCE, "native-text-after.png") });
    const out = await exportPdf(page, "fixed.pdf");
    const text = await pdfText(out);
    expect(text).toContain("receive");
    expect(text).not.toContain("recieve");
  });
});
