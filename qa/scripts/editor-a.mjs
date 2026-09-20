// PDF Editor — one continuous session on a NATIVE-text PDF (PDF-10, 14 pages) covering every toolbar feature.
import { launch, open, pdfTexts, pdfPixels, pxAt, near, pdfLibLoad, rec, save, fx, fs } from "./lib.mjs";

const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 260)); await page.screenshot({ path: `qa/evidence/editor-a-fail-${test.replace(/\W+/g, "_").slice(0, 30)}.png` }).catch(() => {}); } };
const surface = () => page.locator('[data-testid="page-surface"]').first();
const box = async (n = 0) => { const s = page.locator('[data-testid="page-surface"]').nth(n); await s.scrollIntoViewIfNeeded(); return s.boundingBox(); };
const drag = async (x0, y0, x1, y1, steps = 8) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); };
const tool = (name) => page.getByRole("button", { name, exact: true }).click();
const objs = (type) => page.locator(type ? `[data-object-type=${type}]` : "[data-object-type]").count();
const shot = (n) => page.screenshot({ path: `qa/screenshots/editor-${n}.png` });

await open(page, "/pdf/editor", ["PDF-10-many-pages.pdf"]);
await surface().waitFor({ timeout: 20000 }); await page.getByRole("button", { name: "Fit page" }).click(); await page.waitForTimeout(1200);
const S = await box(); // PDF page 612x792 at 100% × EDITOR_BASE_SCALE? measure ratio
const k = S.width / 612; // screen px per pdf pt
rec("pdf-editor", "opens a 14-page native PDF; page surface visible", (await page.locator('[data-testid="page-surface"]').count()) >= 1 ? "PASS" : "FAIL", `surface ${Math.round(S.width)}x${Math.round(S.height)} px (k=${k.toFixed(3)})`);
const at = (ptX, ptY) => [S.x + ptX * k, S.y + ptY * k]; // ptY measured from top of page

// 1. ADD TEXT
await guard("pdf-editor", "add text", async () => {
  await tool("Text"); const [x, y] = at(300, 772); await page.mouse.click(x, y); await page.waitForTimeout(300);
  await page.keyboard.type("AUDIT-ADDED-TEXT"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  rec("pdf-editor", "Text tool: click page, type, commit → text object created", (await objs("added-text")) >= 1 ? "PASS" : "FAIL", `added-text objects=${await objs("added-text")} all=${await objs()}`);
});
// 2. EDIT EXISTING NATIVE TEXT
await guard("pdf-editor", "edit existing text", async () => {
  await tool("Select"); const reg = page.getByRole("button", { name: /^Edit text: Page 1 of 14/ }).first(); await reg.waitFor({ timeout: 8000 });
  await reg.click(); const dlg = page.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor({ timeout: 5000 });
  await dlg.locator("input[type=text]").fill("Page 1 EDITED-BY-AUDIT"); await dlg.getByRole("button", { name: "Save correction" }).click(); await dlg.waitFor({ state: "hidden" });
  await page.waitForTimeout(300); await shot("a-after-edit-text");
});
// 3. HIGHLIGHT / UNDERLINE / STRIKE over body lines (text lines at y≈ 780-700=... pdf y=700 => top offset 92pt)
await guard("pdf-editor", "highlight underline strike", async () => {
  for (const [name, y] of [["Highlight", 118], ["Underline", 133], ["Strike", 148]]) { await tool(name); const [x0, y0] = at(62, y); const [x1, y1] = at(300, y + 10); await drag(x0, y0, x1, y1); }
  const n = await objs("annotation"); rec("pdf-editor", "Highlight + Underline + Strike drags create 3 annotations", n >= 3 ? "PASS" : "FAIL", `annotations=${n}`);
});
await guard("pdf-editor", "draw", async () => {
  await tool("Draw"); const pts = [at(380, 250), at(420, 200), at(460, 260), at(500, 210)]; await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 6 }); await page.mouse.up();
  rec("pdf-editor", "Draw: freehand stroke", (await objs("drawing")) + (await objs("stroke")) + (await page.locator("[data-object-type*=draw],[data-object-type*=ink]").count()) > 0 ? "PASS" : "INFO", `types=${await page.locator("[data-object-type]").evaluateAll((e) => [...new Set(e.map((x) => x.getAttribute("data-object-type")))].join(","))}`);
});
await guard("pdf-editor", "shapes", async () => {
  for (const [name, a, b] of [["Rectangle", [60, 300], [200, 360]], ["Ellipse", [230, 300], [360, 360]], ["Line", [400, 300], [540, 360]], ["Arrow", [400, 400], [540, 460]]]) { await tool(name); const [x0, y0] = at(...a), [x1, y1] = at(...b); await drag(x0, y0, x1, y1); }
  rec("pdf-editor", "Rectangle, Ellipse, Line, Arrow drags create 4 shapes", (await objs("shape")) >= 4 ? "PASS" : "FAIL", `shapes=${await objs("shape")}`);
});
await guard("pdf-editor", "whiteout", async () => {
  await tool("Whiteout"); const [x0, y0] = at(60, 490); const [x1, y1] = at(330, 520); await drag(x0, y0, x1, y1);
  rec("pdf-editor", "Whiteout region created", (await objs()) >= 9 ? "PASS" : "INFO", `objects=${await objs()}`);
});
await shot("a-page1-annotated");
await guard("pdf-editor", "image", async () => {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 }); await tool("Image"); const fc = await chooser; await fc.setFiles(fx("IMAGE-11-quadrants.png")); await page.waitForTimeout(600);
  const [x0, y0] = at(380, 520); const [x1, y1] = at(500, 600); await drag(x0, y0, x1, y1).catch(() => {}); await page.waitForTimeout(500);
  rec("pdf-editor", "Image: choose PNG, place on page", (await objs("image")) >= 1 ? "PASS" : "FAIL", `image objects=${await objs("image")}`);
});
await guard("pdf-editor", "sign", async () => {
  await tool("Sign"); const pad = page.getByLabel("Signature drawing area"); await pad.waitFor({ timeout: 5000 }); const pb = await pad.boundingBox();
  await page.mouse.move(pb.x + 20, pb.y + pb.height / 2); await page.mouse.down(); await page.mouse.move(pb.x + 80, pb.y + 20, { steps: 8 }); await page.mouse.move(pb.x + 140, pb.y + pb.height - 20, { steps: 8 }); await page.mouse.move(pb.x + 220, pb.y + 30, { steps: 8 }); await page.mouse.up();
  await page.getByRole("button", { name: /^(Use|Add|Apply|Done|Place|Save)/ }).first().click(); await page.waitForTimeout(500);
  const [x0, y0] = at(60, 640); await page.mouse.click(x0 + 20, y0 + 10).catch(() => {}); await page.waitForTimeout(500);
  rec("pdf-editor", "Sign: draw signature, place on page", (await objs("signature")) + (await objs("image")) >= 2 ? "PASS" : "FAIL", `objects by type=${await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.getAttribute("data-object-type")).join(","))}`);
});
await shot("a-all-tools");
// undo / redo
await guard("pdf-editor", "undo redo", async () => {
  const before = await objs(); await page.getByRole("button", { name: "Undo", exact: true }).click(); const afterUndo = await objs(); await page.getByRole("button", { name: "Redo", exact: true }).click(); const afterRedo = await objs();
  rec("pdf-editor", "Undo removes the last object, Redo restores it", afterUndo === before - 1 && afterRedo === before ? "PASS" : "FAIL", `${before} → ${afterUndo} → ${afterRedo}`);
});
// search
await guard("pdf-editor", "search", async () => {
  await page.getByText("Search", { exact: true }).first().click().catch(() => {}); const inp = page.getByLabel("Search document text"); await inp.fill("ipsum"); await page.keyboard.press("Enter"); await page.waitForTimeout(1000);
  const txt = await page.locator("aside, body").last().innerText(); const m = txt.match(/(\d+)\s*(of|matches|result)/i); rec("pdf-editor", "Search 'ipsum' finds matches across pages", /\d+ (match|result)|\d+ of \d+/i.test(txt) ? "PASS" : "INFO", (txt.match(/[^\n]*(match|result)[^\n]*/i) ?? [""])[0]);
});
// page ops
await guard("pdf-editor", "page operations", async () => {
  await page.getByRole("button", { name: "Rotate page 3 clockwise" }).click(); await page.getByRole("button", { name: "Duplicate page 2" }).click(); await page.waitForTimeout(300);
  const nAfterDup = await page.getByRole("button", { name: /^Go to page \d+$/ }).count();
  await page.getByRole("button", { name: /^Delete page 15$/ }).click().catch(async () => { await page.getByRole("button", { name: /^Delete page \d+$/ }).last().click(); });
  await page.waitForTimeout(300); await page.getByRole("button", { name: "+ Blank page" }).click(); await page.waitForTimeout(300);
  rec("pdf-editor", "rotate p3, duplicate p2, delete last, add blank page → thumbnails", "INFO", `after dup ${nAfterDup}, now ${await page.getByRole("button", { name: /^Go to page \d+$/ }).count()}`);
});
// export
await guard("pdf-editor", "export", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export PDF/ }).click()]); const out = "qa/evidence/out/editor-a.pdf"; await dl.saveAs(out);
  const t = await pdfTexts(out); const p1 = t[0].text; const all = t.map((x) => x.text);
  rec("pdf-editor", "export: added text present in text layer", /AUDIT-ADDED-TEXT/.test(p1) ? "PASS" : "FAIL", p1.slice(-80));
  rec("pdf-editor", "export: edited native text — new text visible & searchable once; old text stays underneath (disclosed limitation)", (p1.match(/EDITED-BY-AUDIT/g) ?? []).length === 1 ? "LIMITED" : "FAIL", `new text occurrences in text layer=${(p1.match(/EDITED-BY-AUDIT/g) ?? []).length}; old "Page 1 of 14" still extractable=${/Page 1 of 14/.test(p1)} — FAQ/Properties panel say corrections cover, not remove`);
  const whiteoutedGone = !/lorem ipsum dolor sit amet/.test(p1.split("Page 1")[1] ?? "") ; rec("pdf-editor", "export: whiteout — is the covered text still extractable?", "INFO", `text under whiteout still in text layer: ${/(consectetur|adipiscing)/.test(p1)} (whiteout is visual cover; check UI wording)`);
  const px = await pdfPixels(out, 1, 1); const c = (ptX, ptY) => pxAt(px, ptX, ptY);
  rec("pdf-editor", "export: shapes/annotations painted (rect edge, ellipse, whiteout white)", (() => { let dark = 0; for (let x = 60; x < 200; x++) { const p = c(x, 300); if (p[0] < 120 || p[1] < 120 || p[2] < 120 || p[0] > 200 && p[2] < 100) dark++; } return dark > 3; })() ? "PASS" : "INFO", "checked scan line y=300");
  const doc = await pdfLibLoad(out); rec("pdf-editor", "export: page count after ops (14 +1 dup −1 del +1 blank = 15)", doc.getPageCount() === 15 ? "PASS" : "FAIL", `${doc.getPageCount()} pages; rotations p1-4=${[0, 1, 2, 3].map((i) => doc.getPage(i).getRotation().angle)}`);
  rec("pdf-editor", "export: page 3 rotated 90 (after duplicate p2 → old p3 is p4)", "INFO", `angles: ${doc.getPages().map((p) => p.getRotation().angle).join(",")}`);
  fs.writeFileSync("qa/evidence/editor-a-pagelabels.txt", all.map((x) => x.slice(0, 40)).join("\n"));
});
rec("(pdf-editor A)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("editor-a"); await browser.close();
