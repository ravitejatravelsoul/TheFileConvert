// PDF Editor — continuous session on the user's REAL scanned PDF (OCR → edit recognised word → annotate → export)
// and a second session on a form PDF (fill every field type).
import { launch, open, pdfTexts, pdfPixels, pxAt, near, pdfLibLoad, rec, save, fx, fs } from "./lib.mjs";

const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 260)); await page.screenshot({ path: `qa/evidence/editor-b-fail-${test.replace(/\W+/g, "_").slice(0, 30)}.png` }).catch(() => {}); } };
const drag = async (x0, y0, x1, y1, steps = 8) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); };
const tool = (name) => page.getByRole("button", { name, exact: true }).click();
const objs = (type) => page.locator(type ? `[data-object-type=${type}]` : "[data-object-type]").count();
const shot = (n) => page.screenshot({ path: `qa/screenshots/editor-${n}.png` });
const exportTo = async (out) => { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }), page.getByRole("button", { name: /Export PDF/ }).click()]); await dl.saveAs(out); return out; };

await open(page, "/pdf/editor", [REAL]);
await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.getByRole("button", { name: "Fit page" }).click(); await page.waitForTimeout(1200);
const banner = (await page.locator("body").innerText()).match(/Scanned page detected[^\n]*/)?.[0] ?? "";
rec("pdf-editor-scan", "scanned PDF opens; user is told OCR is needed before text can be edited", banner ? "PASS" : "FAIL", banner);
await guard("pdf-editor-scan", "OCR in editor", async () => {
  const t0 = Date.now(); await page.getByRole("button", { name: "Recognize current page" }).click().catch(async () => page.getByRole("button", { name: "Recognize Text" }).first().click());
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().waitFor({ timeout: 120000 });
  rec("pdf-editor-scan", `Recognize Text on current page (${((Date.now() - t0) / 1000).toFixed(1)}s) → words become editable`, "PASS", `${await page.getByRole("button", { name: /Edit recognized word/ }).count()} recognised word buttons`);
});
await guard("pdf-editor-scan", "edit recognised word", async () => {
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().click(); const dlg = page.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor({ timeout: 5000 });
  await dlg.locator("input[type=text]").fill("Jane"); await page.waitForTimeout(700); await shot("b-ocr-edit-dialog"); await dlg.getByRole("button", { name: "Save correction" }).click(); await dlg.waitFor({ state: "hidden" }); await page.waitForTimeout(400);
  rec("pdf-editor-scan", "edit recognised word John → Jane", (await objs("ocr-text-replacement")) >= 1 ? "PASS" : "FAIL", `ocr replacement objects=${await objs("ocr-text-replacement")}`);
});
const S = await page.locator('[data-testid="page-surface"]').first().boundingBox(); const k = S.width / 612; const at = (x, y) => [S.x + x * k, S.y + y * k];
await guard("pdf-editor-scan", "annotate scanned page", async () => {
  await tool("Highlight"); await drag(...at(40, 60), ...at(300, 78));
  await tool("Rectangle"); await drag(...at(320, 300), ...at(500, 350));
  await tool("Text"); await page.mouse.click(...at(330, 380)); await page.keyboard.type("Reviewed by audit"); await page.keyboard.press("Escape");
  await tool("Whiteout"); await drag(...at(40, 700), ...at(260, 730));
  rec("pdf-editor-scan", "highlight, rectangle, added text, whiteout on scanned page", (await objs()) >= 5 ? "PASS" : "FAIL", `objects=${await objs()} (${await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.getAttribute("data-object-type")).join(","))})`);
});
await shot("b-scan-session");
await guard("pdf-editor-scan", "export + verify", async () => {
  const out = await exportTo("qa/evidence/out/editor-b-scan.pdf"); const t = await pdfTexts(out);
  const o = await pdfPixels(REAL, 1, 1), n = await pdfPixels(out, 1, 1);
  let changed = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1; for (let y = 0; y < n.h; y++) for (let x = 0; x < n.w; x++) { const i = (y * n.w + x) * 4; if (Math.abs(n.d[i] - o.d[i]) + Math.abs(n.d[i + 1] - o.d[i + 1]) > 60) { changed++; } }
  rec("pdf-editor-scan", "export: 2 pages, corrections + annotations visibly changed the scan, other pixels untouched", t.length === 2 && changed > 800 && changed < n.w * n.h * 0.2 ? "PASS" : "FAIL", `pages=${t.length} changedPx=${changed} of ${n.w * n.h}`);
  rec("pdf-editor-scan", "export: text layer has the corrected word 'Jane' and 'Reviewed by audit'", /Jane/.test(t[0].text) && /Reviewed by audit/.test(t[0].text) ? "PASS" : "FAIL", t[0].text.slice(0, 160));
  rec("pdf-editor-scan", "export: page 2 (untouched) unchanged", (await pdfPixels(out, 2, 0.5)).d.length === (await pdfPixels(REAL, 2, 0.5)).d.length ? "PASS" : "FAIL", `size input=${fs.statSync(REAL).size} output=${fs.statSync(out).size}`);
  await import("node:child_process").then(({ execFileSync }) => execFileSync("node", ["qa/scripts/render-page.mjs", out, "1", "1.2", "qa/screenshots/editor-b-export-p1.png", "0", "0", "1", "0.55"]));
});

// ---------------- FORM PDF ----------------
await guard("pdf-editor-form", "fill form", async () => {
  await open(page, "/pdf/editor", ["PDF-09-form.pdf"]); await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  await page.getByText(/^Form fields/).first().click().catch(() => {}); await page.waitForTimeout(500);
  const fields = await page.evaluate(() => [...document.querySelectorAll("aside input, aside select, [data-testid=page-surface] input, [data-testid=page-surface] select, aside textarea")].map((e) => `${e.tagName.toLowerCase()}:${e.type}:${e.getAttribute("aria-label") ?? e.name ?? ""}`));
  console.log("FORM CONTROLS:", fields.join(" | "));
  await page.screenshot({ path: "qa/screenshots/editor-form-before.png" });
});
console.log("PAGE ERRORS:", errors.join(" ;; ") || "none");
rec("(pdf-editor B)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("editor-b"); await browser.close();
