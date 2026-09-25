// V2 production verification against https://thefileconvert.com — read-only (downloads only, no uploads).
//   node qa/scripts/v2-prod-verify.mjs
import { devices } from "@playwright/test";
import { chromium } from "@playwright/test";
import { pdfTexts, pdfPixels, imageInfo, rec, save, fx, fs } from "./lib.mjs";

const BASE = process.env.BASE ?? "https://thefileconvert.com";
const HOST = new URL(BASE).hostname;
const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const OUT = "qa/evidence/out/prod-v2";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

/** A fresh context that records console/page errors, bad responses, non-GET requests and foreign hosts. */
async function session(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  const log = { errors: [], bad: [], nonGet: [], foreign: [] };
  page.on("pageerror", (e) => log.errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) log.errors.push(m.text().slice(0, 200)); });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (/^(blob|data):/.test(u.protocol)) return;
    if (r.method() !== "GET" && r.method() !== "HEAD") log.nonGet.push(`${r.method()} ${r.url()} (${(r.postData() ?? "").length}B)`);
    if (u.hostname !== HOST) log.foreign.push(r.url());
  });
  ctx.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) log.bad.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, log };
}
const guard = async (t, n, fn) => { try { await fn(); } catch (e) { rec(t, n, "FAIL", String(e).slice(0, 260)); } };
const privacyOk = (log) => log.nonGet.length === 0 && log.foreign.length === 0;
const privacyDetail = (log) => `nonGET=[${log.nonGet.join("; ")}] foreign=[${[...new Set(log.foreign.map((u) => new URL(u).hostname))].join(",")}]`;
const allLogs = [];
async function download(page, name, button = page.getByRole("button", { name: "Download", exact: true })) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), button.click()]);
  const out = `${OUT}/${name}`;
  await dl.saveAs(out);
  return out;
}

// ---------------- 8. V2 fingerprint ----------------
await guard("fingerprint", "V2 UI present", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  await page.goto(BASE + "/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles(REAL);
  await page.getByRole("button", { name: /^Compress to under/ }).waitFor({ timeout: 30000 });
  const presets = [];
  for (const p of ["Under 500 KB", "Under 1 MB", "Under 2 MB", "Under 5 MB", "Custom"]) presets.push(`${p}:${(await page.getByRole("button", { name: p, exact: true }).count()) > 0}`);
  const oldUi = await page.locator("input[name=compress-level]").count();
  rec("fingerprint", "PDF Compress shows target-size presets, not the old Lossless/Balanced/Smallest radios", presets.every((p) => p.endsWith("true")) && oldUi === 0 ? "PASS" : "FAIL", `${presets.join(" ")} oldRadios=${oldUi}`);

  await page.goto(BASE + "/image/compress");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-06-small-optimized.jpg"));
  await page.getByRole("button", { name: /^Compress to under/ }).waitFor({ timeout: 30000 });
  const imgPresets = ["Under 100 KB", "Under 250 KB", "Under 500 KB", "Under 1 MB", "Custom"];
  const imgOk = [];
  for (const p of imgPresets) imgOk.push((await page.getByRole("button", { name: p, exact: true }).count()) > 0);
  const oldSlider = await page.locator('main input[type="range"]').count();
  rec("fingerprint", "Image Compress shows target-size presets, no quality slider", imgOk.every(Boolean) && oldSlider === 0 ? "PASS" : "FAIL", `presets=${imgOk} sliders=${oldSlider}`);

  await page.goto(BASE + "/");
  const nav = await page.locator('nav[aria-label="Primary"]').innerText().catch(() => "");
  const heads = await page.getByRole("heading", { level: 2 }).allInnerTexts();
  const navOk = ["Compress", "Convert", "Edit PDF", "PDF Tools"].every((l) => nav.includes(l)) && !/Documents|More tools/.test(nav);
  rec("fingerprint", "Homepage: V2 nav (Compress / Convert / Edit PDF / PDF Tools) and V2 category section", navOk && heads.includes("Start with a category") && heads.includes("Most used") ? "PASS" : "FAIL", `nav="${nav.replace(/\s+/g, " ")}" h2=${heads.join("|")}`);
  await ctx.close();
});

// ---------------- 9. PDF compression (real scan, Under 1 MB) ----------------
await guard("pdf-compress", "real scan under 1 MB", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  const input = fs.statSync(REAL).size;
  await page.goto(BASE + "/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles(REAL);
  await page.getByRole("button", { name: "Under 1 MB", exact: true }).click();
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Compress to under 1 MB/ }).click();
  await page.getByText("Done!").waitFor({ timeout: 120000 });
  const ms = Date.now() - t0;
  const badge = await page.locator("ul li span.rounded-full").last().innerText();
  const exact = await page.getByTestId("exact-bytes").innerText();
  const out = await download(page, "pdf-under-1mb.pdf");
  const size = fs.statSync(out).size;
  const t = await pdfTexts(out);
  const px = await pdfPixels(out, 1, 1);
  const ink = [...px.d].filter((v, i) => i % 4 === 0 && v < 120).length;
  const exactMatches = exact.includes(input.toLocaleString("en-US")) && exact.includes(size.toLocaleString("en-US"));
  rec("pdf-compress", `real scan ${input} B → Under 1 MB → ${size} B (${(((input - size) / input) * 100).toFixed(1)}% smaller) in ${(ms / 1000).toFixed(1)}s`,
    size <= 1024 * 1024 && /Target ✓ under 1 MB/.test(badge) && t.length === 2 && ink > 3000 && exactMatches && privacyOk(log) ? "PASS" : "FAIL",
    `badge="${badge}" ui="${exact}" pages=${t.length} ink=${ink} ${privacyDetail(log)}`);
  globalThis.pdfResult = { input, size };
  await ctx.close();
});

// ---------------- 10. Image compression ----------------
await guard("image-compress", "large JPG under 1 MB", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  const input = fs.statSync(fx("IMAGE-01-photo-large.jpg")).size;
  await page.goto(BASE + "/image/compress");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-01-photo-large.jpg"));
  await page.getByRole("button", { name: "Under 1 MB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under 1 MB/ }).click();
  await page.getByText("Done!").waitFor({ timeout: 120000 });
  const badge = await page.locator("ul li span.rounded-full").last().innerText();
  const out = await download(page, "image-under-1mb.jpg");
  const size = fs.statSync(out).size;
  const i = await imageInfo(out);
  rec("image-compress", `IMAGE-01 ${input} B → Under 1 MB → ${size} B, ${i.w}×${i.h}`, size <= 1024 * 1024 && /Target ✓/.test(badge) && i.w >= 1000 && privacyOk(log) ? "PASS" : "FAIL", `badge="${badge}" ${privacyDetail(log)}`);
  await ctx.close();
});

// ---------------- 11. Converters ----------------
await guard("converters", "smoke", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  const fmt = (f) => { const b = fs.readFileSync(f); if (b[0] === 0x89 && b[1] === 0x50) return "png"; if (b[0] === 0xff && b[1] === 0xd8) return "jpeg"; if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp"; if (b.subarray(0, 4).toString() === "%PDF") return "pdf"; return "?"; };

  await page.goto(BASE + "/convert/jpg-to-png");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-12-portrait.jpg"));
  await page.getByRole("button", { name: /^Convert/ }).click(); await page.getByText("Done!").waitFor({ timeout: 60000 });
  let o = await download(page, "jpg-to-png.png"); let i = await imageInfo(o);
  rec("converters", "JPG → PNG", fmt(o) === "png" && i.w === 1000 && i.h === 1600 ? "PASS" : "FAIL", `${fmt(o)} ${i.w}×${i.h}`);

  await page.goto(BASE + "/convert/png-to-webp");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-04-transparent.png"));
  await page.getByRole("button", { name: /^Convert/ }).click(); await page.getByText("Done!").waitFor({ timeout: 60000 });
  o = await download(page, "png-to-webp.webp"); i = await imageInfo(o);
  rec("converters", "PNG → WebP (alpha kept)", fmt(o) === "webp" && i.w === 2400 && i.d[3] === 0 ? "PASS" : "FAIL", `${fmt(o)} ${i.w}×${i.h} cornerAlpha=${i.d[3]}`);

  await page.goto(BASE + "/pdf/to-images");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-07-rotated.pdf"));
  await page.getByRole("button", { name: /^Convert to images/ }).click(); await page.getByText("Done!").waitFor({ timeout: 60000 });
  o = await download(page, "pdf-to-images.zip", page.getByRole("button", { name: /Download all as ZIP/ }));
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(o));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const p2Path = `${OUT}/p2.png`;
  fs.writeFileSync(p2Path, await zip.files[names.find((n) => /page-2\./.test(n))].async("nodebuffer"));
  const p2 = await imageInfo(p2Path);
  rec("converters", "PDF → Images (6 pages, rotated page 2 comes out landscape)", names.length === 6 && p2.w > p2.h ? "PASS" : "FAIL", `${names.length} images, page-2 ${p2.w}×${p2.h}`);

  await page.goto(BASE + "/pdf/images-to-pdf");
  await page.locator('input[type="file"]').setInputFiles([fx("IMAGE-11-quadrants.png"), fx("IMAGE-12-portrait.jpg")]);
  await page.getByRole("button", { name: /^Create PDF from 2 images/ }).click(); await page.getByText("Done!").waitFor({ timeout: 60000 });
  o = await download(page, "images-to-pdf.pdf");
  const tt = await pdfTexts(o);
  rec("converters", "Images → PDF (2 pages)", fmt(o) === "pdf" && tt.length === 2 ? "PASS" : "FAIL", `pages=${tt.length}`);
  rec("privacy", "converters: no non-GET, no foreign host", privacyOk(log) ? "PASS" : "FAIL", privacyDetail(log));
  await ctx.close();
});

// ---------------- 12. PDF Editor ----------------
await guard("pdf-editor", "native", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  await page.goto(BASE + "/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-10-many-pages.pdf"));
  const surf = page.locator('[data-testid="page-surface"]').first(); await surf.waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Fit page" }).click(); await page.waitForTimeout(800);
  const S = await surf.boundingBox(); const k = S.width / 612; const at = (x, y) => [S.x + x * k, S.y + y * k];

  await page.getByRole("button", { name: /^Edit text: Page 1 of 14/ }).first().click();
  const dlg = page.getByRole("dialog", { name: "Edit text" });
  await dlg.locator("input[type=text]").fill("Page 1 PROD EDIT"); await dlg.getByRole("button", { name: "Save correction" }).click(); await dlg.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.mouse.move(...at(62, 118)); await page.mouse.down(); await page.mouse.move(...at(300, 128), { steps: 6 }); await page.mouse.up();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.mouse.move(...at(380, 250)); await page.mouse.down(); await page.mouse.move(...at(460, 200), { steps: 6 }); await page.mouse.move(...at(520, 260), { steps: 6 }); await page.mouse.up();

  // Fast typing immediately after placing a text box — no wait between the click and the keystrokes.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(...at(300, 772));
  await page.keyboard.type("Reviewed by production audit");
  const typed = await page.getByTestId("canvas-text-editor").inputValue();
  await page.keyboard.press("Escape");

  const types = await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.dataset.objectType));
  const out = await download(page, "editor-native.pdf", page.getByRole("button", { name: /Export PDF/ }));
  const t = await pdfTexts(out);
  rec("pdf-editor", "native: edit text, highlight, draw, fast-typed added text, export → reopen",
    typed === "Reviewed by production audit" && /PROD EDIT/.test(t[0].text) && /Reviewed by production audit/.test(t[0].text) && types.includes("annotation") && types.includes("drawing") && t.length === 14 && privacyOk(log) ? "PASS" : "FAIL",
    `typed="${typed}" types=${types.join(",")} pages=${t.length} p1="${t[0].text.slice(0, 40)}…${t[0].text.slice(-40)}" ${privacyDetail(log)}`);
  await ctx.close();
});

await guard("pdf-editor", "scanned", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  await page.goto(BASE + "/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(REAL);
  const surf = page.locator('[data-testid="page-surface"]').first(); await surf.waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Fit page" }).click(); await page.waitForTimeout(800);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Recognize current page" }).click().catch(async () => page.getByRole("button", { name: "Recognize Text" }).first().click());
  const dateBtn = page.getByRole("button", { name: /Edit recognized (word|line): .*12\/20\/2026/ }).first();
  await dateBtn.waitFor({ timeout: 150000 });
  const ocrMs = Date.now() - t0;
  await dateBtn.click();
  const dlg = page.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor();
  const cur = await dlg.locator("input[type=text]").inputValue();
  await dlg.locator("input[type=text]").fill(cur.replace("12/20/2026", "12/20/2028"));
  await dlg.getByRole("button", { name: "Save correction" }).click(); await dlg.waitFor({ state: "hidden" });

  const S = await surf.boundingBox(); const k = S.width / 612; const at = (x, y) => [S.x + x * k, S.y + y * k];
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(...at(330, 380));
  await page.keyboard.type("Verified in production");
  const typed = await page.getByTestId("canvas-text-editor").inputValue();
  await page.keyboard.press("Escape");

  const out = await download(page, "editor-scan.pdf", page.getByRole("button", { name: /Export PDF/ }));
  const t = await pdfTexts(out);
  const a = await pdfPixels(REAL, 1, 1.5), b = await pdfPixels(out, 1, 1.5);
  let changed = 0; for (let i = 0; i < a.d.length; i += 4) if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) > 50) changed++;
  rec("pdf-editor", `scanned: OCR (${(ocrMs / 1000).toFixed(1)}s) → 12/20/2026→12/20/2028 → fast-typed added text → export → reopen`,
    typed === "Verified in production" && /12\/20\/2028/.test(t[0].text) && /Verified in production/.test(t[0].text) && t.length === 2 && changed > 50 && changed < a.w * a.h * 0.05 && privacyOk(log) ? "PASS" : "FAIL",
    `typed="${typed}" text="${t[0].text.slice(0, 120)}" changedPx=${changed}/${a.w * a.h} ${privacyDetail(log)}`);
  await import("node:child_process").then(({ execFileSync }) => execFileSync("node", ["qa/scripts/render-page.mjs", out, "1", "2", "qa/screenshots/prod-v2-date-edit.png", "0", "0.28", "1", "0.14"]));
  await ctx.close();
});

// ---------------- 13. Essential PDF tools ----------------
await guard("pdf-tools", "smoke", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  const label = (s) => (s.match(/Page (\d+) of (\d+)/) ?? []).slice(1).join("/");
  const run = async (btn) => { await page.getByRole("button", { name: btn }).click(); await page.getByText("Done!").waitFor({ timeout: 60000 }); };

  await page.goto(BASE + "/pdf/merge");
  await page.locator('input[type="file"]').setInputFiles([fx("PDF-10-many-pages.pdf"), fx("PDF-08-metadata.pdf")]);
  await run(/^Merge 2 PDFs/); let o = await download(page, "merge.pdf"); let t = await pdfTexts(o);
  rec("pdf-tools", "Merge 14 + 3 → 17 pages in order", t.length === 17 && label(t[0].text) === "1/14" && label(t[14].text) === "1/3" ? "PASS" : "FAIL", `${t.length} pages`);

  await page.goto(BASE + "/pdf/split");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-10-many-pages.pdf"));
  await page.getByLabel("Pages per file").fill("5");
  await run(/^Split PDF/); o = await download(page, "split.zip", page.getByRole("button", { name: /Download all as ZIP/ }));
  const { default: JSZip } = await import("jszip"); const zip = await JSZip.loadAsync(fs.readFileSync(o));
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const counts = []; for (const n of parts) { const f = `${OUT}/${n}`; fs.writeFileSync(f, await zip.files[n].async("nodebuffer")); counts.push((await pdfTexts(f)).length); }
  rec("pdf-tools", "Split 14 pages, 5 per file → 5/5/4", JSON.stringify(counts.sort()) === "[4,5,5]" ? "PASS" : "FAIL", `${parts.join(",")} ${counts}`);

  await page.goto(BASE + "/pdf/reorder");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-10-many-pages.pdf"));
  await page.getByRole("button", { name: "Move page 2 earlier" }).click();
  await run(/^Export reordered PDF/); o = await download(page, "reorder.pdf"); t = await pdfTexts(o);
  rec("pdf-tools", "Reorder: page 2 moved first", label(t[0].text) === "2/14" && label(t[1].text) === "1/14" && t.length === 14 ? "PASS" : "FAIL", t.slice(0, 3).map((x) => label(x.text)).join(","));

  await page.goto(BASE + "/pdf/rotate");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-10-many-pages.pdf"));
  await page.locator("select").selectOption({ label: "180°" }); await page.getByLabel(/Pages \(optional\)/).fill("2,4");
  await run(/^Rotate PDF/); o = await download(page, "rotate.pdf"); t = await pdfTexts(o);
  rec("pdf-tools", "Rotate pages 2,4 by 180°", JSON.stringify(t.slice(0, 5).map((x) => x.rotate)) === "[0,180,0,180,0]" ? "PASS" : "FAIL", `${t.slice(0, 5).map((x) => x.rotate)}`);

  await page.goto(BASE + "/pdf/delete-pages");
  await page.locator('input[type="file"]').setInputFiles(fx("PDF-10-many-pages.pdf"));
  await page.getByLabel(/Pages to delete/).fill("2,4-6");
  await run(/^Delete pages/); o = await download(page, "delete.pdf"); t = await pdfTexts(o);
  rec("pdf-tools", "Delete 2,4-6 → 10 pages left", t.map((x) => label(x.text).split("/")[0]).join(",") === "1,3,7,8,9,10,11,12,13,14" ? "PASS" : "FAIL", t.map((x) => label(x.text).split("/")[0]).join(","));
  rec("privacy", "PDF tools: no non-GET, no foreign host", privacyOk(log) ? "PASS" : "FAIL", privacyDetail(log));
  await ctx.close();
});

// ---------------- 14. Mobile ----------------
await guard("mobile", "Pixel 7 session", async () => {
  const { ctx, page, log } = await session({ ...devices["Pixel 7"] }); allLogs.push(log);
  const cdp = await ctx.newCDPSession(page);
  const touchDrag = async (x0, y0, x1, y1) => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
  const pointerDrag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 10 }); await page.mouse.up(); };
  const arm = async (label) => { const b = page.getByRole("button", { name: label, exact: true }); for (let i = 0; i < 3; i++) { await b.tap(); if ((await b.getAttribute("aria-pressed")) === "true") return; await page.waitForTimeout(200); } throw new Error(`${label} not armed`); };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE + "/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles(REAL);
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.locator("input[type=number]").fill("700"); await page.locator("select").selectOption("KB");
  await page.getByRole("button", { name: /^Compress to under 700 KB/ }).tap(); await page.getByText("Done!").waitFor({ timeout: 120000 });
  let o = await download(page, "m-pdf.pdf", page.getByRole("button", { name: "Download", exact: true }));
  rec("mobile", "PDF compress custom 700 KB", fs.statSync(o).size <= 700 * 1024 && (await pdfTexts(o)).length === 2 && (await overflow()) <= 1 ? "PASS" : "FAIL", `${fs.statSync(o).size} B`);

  await page.goto(BASE + "/image/compress");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-01-photo-large.jpg"));
  await page.getByRole("button", { name: "Under 500 KB", exact: true }).tap();
  await page.getByRole("button", { name: /^Compress to under 500 KB/ }).tap(); await page.getByText("Done!").waitFor({ timeout: 120000 });
  o = await download(page, "m-img.jpg");
  rec("mobile", "Image compress under 500 KB", fs.statSync(o).size <= 500 * 1024 && (await imageInfo(o)).w > 0 ? "PASS" : "FAIL", `${fs.statSync(o).size} B`);

  await page.goto(BASE + "/convert/png-to-jpg");
  await page.locator('input[type="file"]').setInputFiles(fx("IMAGE-05-flat-logo.png"));
  await page.getByRole("button", { name: /^Convert/ }).tap(); await page.getByText("Done!").waitFor({ timeout: 60000 });
  o = await download(page, "m-conv.jpg"); const ci = await imageInfo(o);
  rec("mobile", "PNG → JPG converter", ci.w === 1000 && ci.h === 700 ? "PASS" : "FAIL", `${ci.w}×${ci.h}`);

  await page.goto(BASE + "/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(REAL);
  const surf = page.locator('[data-testid="page-surface"]').first(); await surf.waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Recognize current page" }).tap().catch(async () => page.getByRole("button", { name: "Recognize Text" }).first().tap());
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().waitFor({ timeout: 150000 });
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().tap();
  const dlg = page.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor();
  await dlg.locator("input[type=text]").fill("Priya"); await dlg.getByRole("button", { name: "Save correction" }).tap(); await dlg.waitFor({ state: "hidden" });
  const S = await surf.boundingBox();
  await arm("Text"); await page.touchscreen.tap(S.x + S.width * 0.3, S.y + S.height * 0.55); await page.waitForTimeout(300);
  await page.keyboard.type("Mobile prod"); await page.keyboard.press("Escape");
  await arm("Highlight"); await page.waitForTimeout(250); await touchDrag(S.x + S.width * 0.1, S.y + S.height * 0.15, S.x + S.width * 0.6, S.y + S.height * 0.18); await page.waitForTimeout(200);
  await arm("Draw"); await page.waitForTimeout(250); await pointerDrag(S.x + S.width * 0.15, S.y + S.height * 0.7, S.x + S.width * 0.5, S.y + S.height * 0.78); await page.waitForTimeout(200);
  await arm("Crop"); await page.waitForTimeout(250); await pointerDrag(S.x + 10, S.y + 10, S.x + S.width * 0.85, S.y + S.height * 0.7); await page.waitForTimeout(200);
  const keep = page.getByRole("button", { name: "Keep this area" }); const cropOk = (await keep.count()) > 0; if (cropOk) await keep.tap();
  await page.waitForTimeout(400);
  const types = await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.dataset.objectType));
  o = await download(page, "m-editor.pdf", page.getByRole("button", { name: /Export PDF/ }));
  const t = await pdfTexts(o);
  rec("mobile", "Editor: OCR, edit word, add text, highlight, draw, crop, export",
    cropOk && ["ocr-text-replacement", "added-text", "annotation", "drawing"].every((x) => types.includes(x)) && /Priya/.test(t[0].text) && /Mobile prod/.test(t[0].text) && (await overflow()) <= 1 ? "PASS" : "FAIL",
    `types=${types.join(",")} crop=${cropOk} text="${t[0].text.slice(0, 60)}"`);
  rec("privacy", "mobile session: no non-GET, no foreign host", privacyOk(log) ? "PASS" : "FAIL", privacyDetail(log));
  await ctx.close();
});

// ---------------- 16. Domain + SEO ----------------
await guard("seo", "canonical/og/sitemap/robots", async () => {
  const { ctx, page, log } = await session(); allLogs.push(log);
  const bad = [];
  for (const p of ["/", "/pdf/compress", "/image/compress", "/pdf/editor", "/convert/jpg-to-png", "/pdf/merge", "/about", "/privacy", "/terms"]) {
    await page.goto(BASE + p);
    const m = await page.evaluate(() => ({ canon: document.querySelector('link[rel=canonical]')?.href, ogUrl: document.querySelector('meta[property="og:url"]')?.content, ogTitle: document.querySelector('meta[property="og:title"]')?.content }));
    if (!m.canon?.startsWith("https://thefileconvert.com") || !m.ogTitle || /vercel\.app/.test(JSON.stringify(m))) bad.push(`${p}: ${JSON.stringify(m)}`);
  }
  const sm = await (await fetch(BASE + "/sitemap.xml")).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)/g)].map((x) => x[1]);
  const rb = await (await fetch(BASE + "/robots.txt")).text();
  const non200 = []; for (const l of locs) { const r = await fetch(l, { redirect: "manual" }); if (r.status !== 200) non200.push(`${r.status} ${l}`); }
  rec("seo", `canonical + OpenGraph on 9 pages; sitemap ${locs.length} URLs all apex + 200; robots → sitemap`, bad.length === 0 && locs.length > 0 && locs.every((l) => l.startsWith("https://thefileconvert.com")) && non200.length === 0 && /Sitemap: https:\/\/thefileconvert\.com\/sitemap\.xml/.test(rb) ? "PASS" : "FAIL", `${bad.join(" || ")} ${non200.join(";")}`);
  const r404 = await page.goto(BASE + "/definitely-not-a-page");
  rec("seo", "unknown URL → 404 page", r404.status() === 404 ? "PASS" : "FAIL", `${r404.status()}`);
  await ctx.close();
});

// ---------------- 17. Console / network across every session ----------------
const errs = allLogs.flatMap((l) => l.errors);
const bads = allLogs.flatMap((l) => l.bad).filter((b) => !/definitely-not-a-page/.test(b));
rec("console", "no uncaught/console errors across all sessions", errs.length === 0 ? "PASS" : "FAIL", errs.slice(0, 5).join(" ;; "));
rec("console", "no 4xx/5xx responses (excluding the intentional 404 probe)", bads.length === 0 ? "PASS" : "FAIL", bads.slice(0, 5).join(" ; "));
const nonGets = allLogs.flatMap((l) => l.nonGet), foreign = allLogs.flatMap((l) => l.foreign);
rec("privacy", "no non-GET requests and no third-party hosts anywhere in the run", nonGets.length === 0 && foreign.length === 0 ? "PASS" : "FAIL", `nonGET=${nonGets.length} foreign=${[...new Set(foreign.map((u) => new URL(u).hostname))].join(",")}`);

save("prod-v2");
await browser.close();
