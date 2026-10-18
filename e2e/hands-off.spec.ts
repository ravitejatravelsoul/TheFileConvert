import path from "node:path";
import { test, expect } from "@playwright/test";
import { installHandsOff, pressOnceThenHandsOff, expectNoInteractionAfter } from "./helpers/hands-off";

// Every conversion finishes on its own after ONE click — even when the window is not being painted (a tab behind
// another tab, a covered or minimised window): the browser then delivers no animation frames until the user
// interacts, and anything that waits for one stalls. These tests press the primary action once, touch nothing and
// wait. They fail if a second click (or any other input) is what it takes to finish.

const R = (n: string) => path.resolve("qa/real-user-fixtures", n);

const CASES: { name: string; route: string; files: string[]; setup?: (page: import("@playwright/test").Page) => Promise<void>; button: string | RegExp; done: (page: import("@playwright/test").Page) => import("@playwright/test").Locator }[] = [
  { name: "PDF → Word, a scanned form", route: "/pdf-to-word", files: [R("DOCUMENT-02-filled-application.pdf")], button: "Convert to Word", done: (p) => p.getByTestId("result") },
  { name: "PDF → Word, a passport-like scan", route: "/pdf-to-word", files: [R("DOCUMENT-01-passport-scan.pdf")], button: "Convert to Word", done: (p) => p.getByTestId("result") },
  { name: "PDF → Word, a text PDF", route: "/pdf-to-word", files: [R("DOCUMENT-06-resume-native.pdf")], button: "Convert to Word", done: (p) => p.getByTestId("result") },
  { name: "PDF → Image", route: "/pdf-to-image", files: [R("DOCUMENT-05-bank-statement.pdf")], button: /^Convert (all|page$)/, done: (p) => p.getByTestId("result") },
  { name: "Word → PDF", route: "/word-to-pdf", files: [R("DOCUMENT-16-complex-word-report.docx")], button: "Convert to PDF", done: (p) => p.getByTestId("result") },
  { name: "Image → Word", route: "/image-to-word", files: [R("DOCUMENT-10-filled-form.png")], button: /^Create Word document/, done: (p) => p.getByTestId("result") },
  { name: "Image → PDF", route: "/image-to-pdf", files: [R("DOCUMENT-09-id-card-image.png"), R("DOCUMENT-11-receipt.jpg")], button: /^Create PDF/, done: (p) => p.getByTestId("result") },
  { name: "Image Converter", route: "/convert-image", files: [R("DOCUMENT-10-filled-form.png")], setup: async (p) => { await p.getByRole("radio", { name: /^JPG/ }).click(); }, button: "Convert to JPG", done: (p) => p.getByTestId("result") },
  { name: "Merge PDF", route: "/merge-pdf", files: [R("DOCUMENT-06-resume-native.pdf"), R("DOCUMENT-12-table-report.pdf")], button: "Merge 2 PDFs", done: (p) => p.getByTestId("result") },
  { name: "Organize PDF", route: "/organize-pdf", files: [R("DOCUMENT-08-signed-contract.pdf")], setup: async (p) => { await p.locator("ol > li[data-sort-key]").nth(1).waitFor(); await p.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click(); }, button: "Save PDF", done: (p) => p.getByTestId("result") },
];

test.describe("one click, then hands off", () => {
  test.setTimeout(180_000);
  for (const c of CASES) {
    test(`${c.name}: finishes by itself, even with no animation frames`, async ({ page }) => {
      await installHandsOff(page);
      await page.goto(c.route);
      await page.getByTestId("file-input").first().setInputFiles(c.files);
      await c.setup?.(page);
      await pressOnceThenHandsOff(page, page.getByRole("button", { name: c.button }).first());
      await expect(c.done(page)).toBeVisible({ timeout: 120_000 });
      await expectNoInteractionAfter(page);
    });
  }

  test("Compress PDF and Compress Image finish by themselves", async ({ page }) => {
    for (const [route, file] of [["/compress-pdf", "DOCUMENT-02-filled-application.pdf"], ["/compress-image", "DOCUMENT-10-filled-form.png"]] as const) {
      await installHandsOff(page);
      await page.goto(route);
      await page.getByTestId("file-input").first().setInputFiles(R(file));
      await page.getByText("How small do you need it?").waitFor();
      await page.getByRole("radio", { name: "Custom", exact: true }).click();
      await page.getByLabel("Custom target size").fill("300");
      await page.getByRole("radio", { name: "KB", exact: true }).click();
      await pressOnceThenHandsOff(page, page.getByRole("button", { name: /^Compress to under/ }));
      await expect(page.getByTestId("result")).toBeVisible({ timeout: 120_000 });
      await expectNoInteractionAfter(page);
    }
  });

  test("PDF Editor: Export finishes by itself", async ({ page }) => {
    await installHandsOff(page);
    await page.goto("/pdf-editor");
    await page.getByTestId("file-input").first().setInputFiles(R("DOCUMENT-06-resume-native.pdf"));
    await page.getByTestId("page-surface").waitFor();
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await pressOnceThenHandsOff(page, page.getByRole("button", { name: "Export PDF" }));
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await expectNoInteractionAfter(page);
  });
});
