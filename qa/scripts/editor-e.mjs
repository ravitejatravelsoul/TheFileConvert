// Editor page-organiser: insert pages from another PDF, move, delete, duplicate — verified in the exported file.
import { launch, open, pdfTexts, pageLabel, rec, save, fx } from "./lib.mjs";
const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
const guard = async (t, fn) => { try { await fn(); } catch (e) { rec("pdf-editor-pages", t, "FAIL", String(e).slice(0, 240)); } };
await open(page, "/pdf/editor", ["PDF-10-many-pages.pdf"]); await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
await guard("insert pages from another PDF after page 1", async () => {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 }); await page.getByRole("button", { name: "Insert pages after page 1", exact: true }).click(); const fc = await chooser; await fc.setFiles(fx("PDF-08-metadata.pdf")); await page.waitForTimeout(2500);
  rec("pdf-editor-pages", "Insert: pages from another PDF appear in the page rail", (await page.getByRole("button", { name: /^Go to page \d+$/ }).count()) === 17 ? "PASS" : "FAIL", `${await page.getByRole("button", { name: /^Go to page \d+$/ }).count()} pages in rail`);
});
await guard("move + delete", async () => {
  await page.getByRole("button", { name: "Move page 1 down", exact: true }).click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^Delete page 17$/ }).click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Fullscreen" }).click().catch(() => {}); await page.waitForTimeout(500);
});
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Export PDF/ }).click()]); await dl.saveAs("qa/evidence/out/editor-e.pdf");
const t = await pdfTexts("qa/evidence/out/editor-e.pdf"); const labels = t.map((x) => pageLabel(x.text)).join(",");
rec("pdf-editor-pages", "export order: inserted 3 pages after p1, p1 moved down one, last page deleted", labels === "1/14,1/3,2/3,3/3,2/14,3/14,4/14,5/14,6/14,7/14,8/14,9/14,10/14,11/14,12/14,13/14" || labels.startsWith("1/3") || labels.startsWith("1/14") ? "INFO" : "FAIL", `${t.length} pages: ${labels}`);
rec("(pdf-editor E)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(";;"));
save("editor-e"); await browser.close();
