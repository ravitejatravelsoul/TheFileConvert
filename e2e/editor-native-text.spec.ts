import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, exportPdf, finishEdit, openEditor, pdfText, replaceWordByTyping } from "./helpers/native";

test.describe("Native text editing — the user's real flow", () => {
  test("fix a spelling mistake in a Chromium PDF: double-click, type, Done, export, reopen", async ({ page }, info) => {
    test.setTimeout(120_000);
    await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
    const editor = await replaceWordByTyping(page, "recieve", "recieve", "receive");
    await expect(editor).toContainText("receive");
    await page.screenshot({ path: info.outputPath("typing.png") });
    await finishEdit(page);
    const out = await exportPdf(page, "fixed.pdf");
    const text = await pdfText(out);
    expect(text).toContain("receive");
    expect(text).not.toContain("recieve");
  });
});
