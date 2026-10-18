import path from "node:path";
import { test } from "@playwright/test";
import { EDITOR_FIXTURES, EVIDENCE, openEditor } from "./helpers/native";

test.skip(({ isMobile }) => isMobile, "desktop");
test("desktop editor screenshot", async ({ page }) => {
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-03-business-letter.pdf"));
  await page.screenshot({ path: path.join(EVIDENCE, "editor-desktop.png") });
});
