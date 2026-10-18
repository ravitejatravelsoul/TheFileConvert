import path from "node:path";
import fs from "node:fs";
import { test } from "@playwright/test";
import { EDITOR_FIXTURES, openEditor, typeInto, pdfText, exportPdf } from "./helpers/native";

for (const [fx, e] of [
  ["EDITOR-06-mixed-fonts.pdf", { has: "occured", find: "occured", replace: "occurred" }],
  ["EDITOR-01-simple-text.pdf", { has: "Quarterly Update", before: "Quarterly Update", insert: "s" }],
  ["EDITOR-06-mixed-fonts.pdf", { has: "Arial — The quick", find: "Bold", replace: "Strong" }],
] as const) {
  test(`dbg ${fx} ${JSON.stringify(e)}`, async ({ page }) => {
    await openEditor(page, path.join(EDITOR_FIXTURES, fx));
    await typeInto(page, e);
    await page.getByRole("button", { name: "Apply this text edit" }).click();
    await page.waitForTimeout(3000);
    const err = page.getByTestId("text-edit-error");
    console.log("ERR:", (await err.count()) ? await err.innerText() : "(none)");
    console.log("EDITOR OPEN:", await page.getByTestId("native-text-editor").count());
    if (await page.getByTestId("native-text-editor").count() === 0) {
      const out = await exportPdf(page, "o.pdf");
      const t = await pdfText(out);
      console.log("TEXT:", t.slice(0, 400));
    }
  });
}
