// PDF Editor forms: fill text/checkbox/dropdown/radio in the sidebar, export, verify with pdf-lib + render.
import { launch, open, pdfTexts, pdfPixels, rec, save, fs } from "./lib.mjs";
import { PDFDocument } from "pdf-lib";
const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
await open(page, "/pdf/editor", ["PDF-09-form.pdf"]); await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
const banner = (await page.locator("body").innerText()).includes("Scanned page detected");
rec("pdf-editor-form", "labelled form page is not mis-flagged as a scanned page", !banner ? "PASS" : "FAIL", banner ? "banner shown" : "no scanned banner");
const nxt = (label, sel) => page.getByText(label, { exact: true }).locator("xpath=following::" + sel + "[1]");
await page.getByText(/^Form fields/).click().catch(() => {}); await page.waitForTimeout(400);
await nxt("full_name", "input").fill("Ada Lovelace"); await nxt("agree", "input").check();
await nxt("plan", "select").selectOption({ label: "pro" }); await nxt("size", "select").selectOption({ label: "large" });
await page.waitForTimeout(500); await page.screenshot({ path: "qa/screenshots/editor-form-filled.png" });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export PDF/ }).click()]); await dl.saveAs("qa/evidence/out/editor-form.pdf");
const d = await PDFDocument.load(fs.readFileSync("qa/evidence/out/editor-form.pdf")); const f = d.getForm();
const vals = { name: f.getTextField("full_name").getText(), agree: f.getCheckBox("agree").isChecked(), plan: f.getDropdown("plan").getSelected(), size: f.getRadioGroup("size").getSelected() };
rec("pdf-editor-form", "text, checkbox, dropdown, radio all saved as real AcroForm values", vals.name === "Ada Lovelace" && vals.agree && vals.plan[0] === "pro" && vals.size === "large" ? "PASS" : "FAIL", JSON.stringify(vals));
// visual: rendered PDF shows the values (independent renderer)
const px = await pdfPixels("qa/evidence/out/editor-form.pdf", 1, 1.5); let ink = 0; for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) if (px.d[(y * px.w + x) * 4] < 100) ink++;
const base = await pdfPixels("qa-fixtures/PDF-09-form.pdf", 1, 1.5); let ink0 = 0; for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) if (base.d[(y * base.w + x) * 4] < 100) ink0++;
rec("pdf-editor-form", "rendered export shows more ink than the blank form (values are visible, not just stored)", ink > ink0 + 300 ? "PASS" : "FAIL", `dark px blank=${ink0} filled=${ink}`);
rec("(pdf-editor C)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(";;"));
save("editor-c"); await browser.close();
