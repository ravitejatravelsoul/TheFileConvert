import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, blockWith, editText, exportPdf, openEditor, pdfText } from "./helpers/native";

test.describe.configure({ timeout: 150_000 });
test.skip(({ isMobile }) => isMobile, "desktop keyboard flow");

const LETTER = path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf");

test("manual-typing stress: type straight after the double-click, fast and long, press Done at once — nothing is lost", async ({ page }) => {
  await openEditor(page, LETTER);
  const block = blockWith(page, "Next steps").or(blockWith(page, "Review the draft"));
  await blockWith(page, "Review the draft").dblclick();
  // no waiting for the box: the user just starts typing
  await page.keyboard.press("Control+A");
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  await page.keyboard.type(words, { delay: 0 });
  await page.getByRole("button", { name: "Apply this text edit" }).click();
  await expect(page.getByTestId("native-text-editor")).toHaveCount(0, { timeout: 30_000 });
  void block;
  const out = await exportPdf(page, "stress.pdf");
  const t = await pdfText(out);
  for (const w of ["word0", "word17", "word39"]) expect(t).toContain(w);
  expect(t).not.toContain("Review the draft");
});

test("a backgrounded tab: no animation frames, window without focus — editing and export still complete on their own", async ({ page }) => {
  await page.addInitScript(() => {
    // a hidden tab never gets animation frames
    window.requestAnimationFrame = () => 0;
    document.hasFocus = () => false;
  });
  await openEditor(page, LETTER);
  await editText(page, { has: "recieve", find: "recieve", replace: "receive" });
  const out = await exportPdf(page, "background.pdf");
  const t = await pdfText(out);
  expect(t).toContain("receive");
  expect(t).not.toContain("recieve");
});

test("privacy: editing text and pictures and exporting sends nothing off the device", async ({ page }) => {
  const seen: { method: string; url: string; body: number }[] = [];
  page.on("request", (r) => seen.push({ method: r.method(), url: r.url(), body: (r.postData() ?? "").length }));
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-08-images.pdf"));
  await editText(page, { has: "teh north", find: "teh", replace: "the" });
  await page.locator('[data-testid="native-image"]').first().click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(1000);
  await exportPdf(page, "privacy.pdf");
  const origin = new URL(page.url()).origin;
  const foreign = seen.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"));
  expect(foreign).toEqual([]);
  expect(seen.filter((r) => r.method !== "GET" && r.method !== "HEAD" && !r.url.startsWith("blob:"))).toEqual([]);
});
