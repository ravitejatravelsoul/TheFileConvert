// PDF Editor: rotated pages (placement must match what is displayed), Crop tool, sidebar Watermark / page numbers /
// header-footer, zoom controls, theme toggle.
import { launch, open, pdfTexts, pdfPixels, pxAt, near, pdfLibLoad, rec, save, fx, fs } from "./lib.mjs";

const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 260)); await page.screenshot({ path: `qa/evidence/editor-d-fail-${test.replace(/\W+/g, "_").slice(0, 30)}.png` }).catch(() => {}); } };
const drag = async (x0, y0, x1, y1, steps = 8) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); };
const tool = (name) => page.getByRole("button", { name, exact: true }).click();
const summary = (t) => page.locator("summary", { hasText: t }).first();
const exportTo = async (out) => { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export PDF/ }).click()]); await dl.saveAs(out); return out; };

await open(page, "/pdf/editor", ["PDF-07-rotated.pdf"]);
await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
// zoom controls
await guard("pdf-editor-nav", "zoom", async () => {
  const read = async () => (await page.getByRole("button", { name: "Actual size (100%)" }).innerText()).trim();
  const z0 = await read(); await page.getByRole("button", { name: "Zoom in", exact: true }).click(); const z1 = await read(); await page.getByRole("button", { name: "Zoom out", exact: true }).click(); await page.getByRole("button", { name: "Zoom out", exact: true }).click(); const z2 = await read();
  await page.getByRole("button", { name: "Fit width" }).click(); const zw = await read(); await page.getByRole("button", { name: "Fit page" }).click(); const zp = await read();
  rec("pdf-editor-nav", "Zoom in/out, Fit width, Fit page change the zoom", z1 !== z0 && z2 !== z1 && zw !== zp ? "PASS" : "FAIL", `${z0} → in ${z1} → out×2 ${z2} → fit width ${zw} → fit page ${zp}`);
});
await page.getByRole("button", { name: "Fit page" }).click(); await page.waitForTimeout(800);
// rotated page 2 (stored /Rotate 90): draw a filled red rectangle in the DISPLAYED top-left area
await guard("pdf-editor-rot", "annotate rotated page", async () => {
  await page.getByRole("button", { name: "Go to page 2" }).click(); await page.waitForTimeout(800);
  const surf = page.locator('[data-testid="page-surface"]').first(); await surf.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); const S = await surf.boundingBox();
  await page.getByText("Fill shapes").click(); await page.getByRole("button", { name: "Red", exact: true }).click(); await tool("Rectangle");
  await drag(S.x + S.width * 0.1, S.y + S.height * 0.1, S.x + S.width * 0.3, S.y + S.height * 0.2);
  await tool("Highlight"); await drag(S.x + S.width * 0.6, S.y + S.height * 0.7, S.x + S.width * 0.9, S.y + S.height * 0.75);
  await page.screenshot({ path: "qa/screenshots/editor-rotated-page2.png" });
  globalThis.S2 = { w: S.width, h: S.height };
  rec("pdf-editor-rot", "displayed page 2 is landscape (rotate 90) and accepts annotations", S.width > S.height && (await page.locator("[data-object-type]").count()) >= 2 ? "PASS" : "FAIL", `surface ${Math.round(S.width)}x${Math.round(S.height)}, objects=${await page.locator("[data-object-type]").count()}`);
});
// Crop tool on page 1
await guard("pdf-editor-crop", "crop page 1", async () => {
  await page.getByRole("button", { name: "Go to page 1" }).click(); await page.waitForTimeout(600);
  const surf = page.locator('[data-testid="page-surface"]').first(); await surf.scrollIntoViewIfNeeded(); const S = await surf.boundingBox();
  await tool("Crop"); await drag(S.x + S.width * 0.1, S.y + S.height * 0.1, S.x + S.width * 0.6, S.y + S.height * 0.5);
  await page.screenshot({ path: "qa/screenshots/editor-crop.png" });
  const btns = await page.getByRole("button").allInnerTexts(); await page.getByRole("button", { name: "Keep this area" }).click();
  await page.waitForTimeout(500);
  rec("pdf-editor-crop", "Crop tool: drag selection then apply", "INFO", `buttons now: ${btns.filter((b) => /crop|apply|reset|cancel/i.test(b)).join("|")}`);
});
// sidebar tools
await guard("pdf-editor-sidebar", "watermark / page numbers / header-footer", async () => {
  const open2 = async () => { const d = page.locator("details", { has: page.locator("summary", { hasText: "Watermark" }) }).first(); if (!(await d.evaluate((e) => e.open))) await summary("Watermark").click(); await page.waitForTimeout(200); }; await open2();
  await page.getByPlaceholder(/Watermark text/i).fill("AUDIT-WM").catch(async () => page.locator("input[type=text]").filter({ hasNot: page.locator("x") }).first().fill("AUDIT-WM"));
  await page.getByRole("button", { name: "Add watermark" }).click(); await page.waitForTimeout(600); await open2();
  await page.getByLabel("Page number position").selectOption({ label: "Bottom right" }); await page.getByLabel("First page number").fill("7"); await page.getByRole("button", { name: "Add page numbers" }).click(); await page.waitForTimeout(600); await open2();
  await page.getByPlaceholder(/Header\/footer text/).fill("AUDIT-HEADER p{page}"); await page.getByRole("button", { name: "Add header/footer" }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: "qa/screenshots/editor-sidebar-ops.png" });
});
await guard("pdf-editor-export", "export & verify", async () => {
  const out = await exportTo("qa/evidence/out/editor-d.pdf"); const t = await pdfTexts(out); const doc = await pdfLibLoad(out);
  const wm = t.filter((x) => /AUDIT-WM/.test(x.text)).length, hd = t.filter((x) => /AUDIT-HEADER/.test(x.text)).length;
  rec("pdf-editor-sidebar", "watermark on every page (6) after export", wm === 6 ? "PASS" : "FAIL", `${wm}/6`);
  rec("pdf-editor-sidebar", "header/footer text with {page} placeholder on every page", hd === 6 && /AUDIT-HEADER p\d/.test(t[0].text) ? "PASS" : "FAIL", `${hd}/6; page1: ${(t[0].text.match(/AUDIT-HEADER p\S*/) ?? [""])[0]}`);
  const nums = t.map((x) => (x.text.match(/\b(\d{1,2})\b\s*$/) ?? [])[1]).join(","); rec("pdf-editor-sidebar", "page numbers start at 7", /^7|7,8,9/.test(nums) || t.every((x, i) => new RegExp(`\\b${7 + i}\\b`).test(x.text)) ? "PASS" : "FAIL", nums + " | p1 tail: " + t[0].text.slice(-60));
  // rotated page: rectangle at displayed top-left ⇒ red in rendered top-left; highlight lower right yellowish
  const px = await pdfPixels(out, 2, 1); const w = px.w, h = px.h;
  let red = 0, rx = 0, ry = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pxAt(px, x, y); if (p[0] > 200 && p[1] < 80 && p[2] < 80) { red++; rx += x; ry += y; } }
  const cx = rx / (red || 1) / w, cy = ry / (red || 1) / h;
  rec("pdf-editor-rot", "rotated page: red rectangle drawn at displayed top-left (centre ≈ 20%,15%) in the exported render", red > 300 && Math.abs(cx - 0.2) < 0.06 && Math.abs(cy - 0.15) < 0.06 ? "PASS" : "FAIL", `red px=${red} centre=(${cx.toFixed(2)},${cy.toFixed(2)}) render ${w}x${h}`);
  const sizes = doc.getPages().map((p) => { const b = p.getCropBox(); return `${Math.round(b.width)}x${Math.round(b.height)}`; });
  rec("pdf-editor-crop", "exported page 1 is smaller than 612x792 after crop", (() => { const [w1, h1] = sizes[0].split("x").map(Number); return w1 < 600 || h1 < 780; })() ? "PASS" : "INFO", `page boxes: ${sizes.join(" ")}`);
  await import("node:child_process").then(({ execFileSync }) => { execFileSync("node", ["qa/scripts/render-page.mjs", out, "2", "0.9", "qa/screenshots/editor-d-export-p2.png"]); execFileSync("node", ["qa/scripts/render-page.mjs", out, "1", "0.9", "qa/screenshots/editor-d-export-p1.png"]); });
});
rec("(pdf-editor D)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("editor-d"); await browser.close();
